import { requestEvents, ServiceUnavailableError } from "@ccflare/core";
import { Logger } from "@ccflare/logger";
import {
	applySystemPromptInterception,
	createRequestMetadata,
	ERROR_MESSAGES,
	interceptAndModifyRequest,
	type ProxyContext,
	prepareRequestBody,
	proxyUnauthenticated,
	proxyWithAccount,
	selectAccountsForRequest,
	TIMING,
	validateProviderPath,
} from "./handlers";
import type { ControlMessage, OutgoingWorkerMessage } from "./worker-messages";

export type { ProxyContext } from "./handlers";

const log = new Logger("Proxy");

// ===== WORKER MANAGEMENT =====

// Create usage worker instance
let usageWorkerInstance: Worker | null = null;

/**
 * Gets or creates the usage worker instance
 * @returns The usage worker instance
 */
export function getUsageWorker(): Worker {
	if (!usageWorkerInstance) {
		usageWorkerInstance = new Worker(
			new URL("./post-processor.worker.ts", import.meta.url).href,
			{ smol: true },
		);
		// Bun extends Worker with unref method
		if (
			"unref" in usageWorkerInstance &&
			typeof usageWorkerInstance.unref === "function"
		) {
			usageWorkerInstance.unref(); // Don't keep process alive
		}

		// Listen for summary messages from worker
		usageWorkerInstance.onmessage = (ev) => {
			const data = ev.data as OutgoingWorkerMessage;
			if (data.type === "summary") {
				requestEvents.emit("event", { type: "summary", payload: data.summary });
			} else if (data.type === "payload") {
				requestEvents.emit("event", { type: "payload", payload: data.payload });
			}
		};
	}
	return usageWorkerInstance;
}

/**
 * Gracefully terminates the usage worker
 */
export function terminateUsageWorker(): void {
	if (usageWorkerInstance) {
		// Send shutdown message to allow worker to flush
		const shutdownMsg: ControlMessage = { type: "shutdown" };
		usageWorkerInstance.postMessage(shutdownMsg);
		// Give worker time to flush before terminating
		setTimeout(() => {
			if (usageWorkerInstance) {
				usageWorkerInstance.terminate();
				usageWorkerInstance = null;
			}
		}, TIMING.WORKER_SHUTDOWN_DELAY);
	}
}

// ===== MAIN HANDLER =====

/**
 * Main proxy handler - orchestrates the entire proxy flow
 *
 * This function coordinates the proxy process by:
 * 1. Creating request metadata for tracking
 * 2. Validating the provider can handle the path
 * 3. Preparing the request body for reuse
 * 4. Selecting accounts based on load balancing strategy
 * 5. Attempting to proxy with each account in order
 * 6. Falling back to unauthenticated proxy if no accounts available
 *
 * @param req - The incoming request
 * @param url - The parsed URL
 * @param ctx - The proxy context containing strategy, database, and provider
 * @returns Promise resolving to the proxied response
 * @throws {ValidationError} If the provider cannot handle the path
 * @throws {ServiceUnavailableError} If all accounts fail to proxy the request
 * @throws {ProviderError} If unauthenticated proxy fails
 */
export async function handleProxy(
	req: Request,
	url: URL,
	ctx: ProxyContext,
): Promise<Response> {
	// 1. Validate provider can handle path
	validateProviderPath(ctx.provider, url.pathname);

	// 2. Prepare request body
	const { buffer: requestBodyBuffer } = await prepareRequestBody(req);

	// 3. Apply system prompt interception first
	const promptInterceptedBody = await applySystemPromptInterception(
		requestBodyBuffer,
		ctx.dbOps,
	);

	// 4. Then perform agent interception on the potentially modified body
	const { modifiedBody, agentUsed, originalModel, appliedModel } =
		await interceptAndModifyRequest(
			promptInterceptedBody || requestBodyBuffer,
			ctx.dbOps,
		);

	// Use the final modified body (from agent interceptor) or fall back to earlier versions
	const finalBodyBuffer =
		modifiedBody || promptInterceptedBody || requestBodyBuffer;
	const finalCreateBodyStream = () => {
		if (!finalBodyBuffer) return undefined;
		return new Response(finalBodyBuffer).body ?? undefined;
	};

	if (agentUsed && originalModel !== appliedModel) {
		log.info(
			`Agent ${agentUsed} detected, model changed from ${originalModel} to ${appliedModel}`,
		);
	}

	// 5. Create request metadata with agent info
	const requestMeta = createRequestMetadata(req, url);
	requestMeta.agentUsed = agentUsed;

	// 6. Select accounts
	const accounts = selectAccountsForRequest(requestMeta, ctx);

	// 7. Handle no accounts case
	if (accounts.length === 0) {
		return proxyUnauthenticated(
			req,
			url,
			requestMeta,
			finalBodyBuffer,
			finalCreateBodyStream,
			ctx,
		);
	}

	// 8. Log selected accounts
	log.info(
		`Selected ${accounts.length} accounts: ${accounts.map((a) => a.name).join(", ")}`,
	);
	log.info(`Request: ${req.method} ${url.pathname}`);

	// 9. Try each account
	for (let i = 0; i < accounts.length; i++) {
		const response = await proxyWithAccount(
			req,
			url,
			accounts[i],
			requestMeta,
			finalBodyBuffer,
			finalCreateBodyStream,
			i,
			ctx,
		);

		if (response) {
			return response;
		}
	}

	// 10. All accounts failed
	throw new ServiceUnavailableError(
		`${ERROR_MESSAGES.ALL_ACCOUNTS_FAILED} (${accounts.length} attempted)`,
		ctx.provider.name,
	);
}
