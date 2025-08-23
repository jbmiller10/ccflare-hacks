import type { DatabaseOperations } from "@ccflare/database";
import { Logger } from "@ccflare/logger";

const interceptLog = new Logger("SystemPromptInterceptor");
const updateLog = new Logger("UpdateLastSeenPrompt");
const updateToolsLog = new Logger("UpdateLastSeenTools");

// Type definitions
interface SystemMessage {
	type: string;
	text: string;
	cache_control?: {
		type: string;
	};
}

// Tool definition based on Anthropic API specification
interface Tool {
	type: string;
	name: string;
	description?: string;
	input_schema?: {
		type: string;
		properties?: Record<string, unknown>;
		required?: string[];
	};
}

interface RequestBody {
	messages?: unknown[];
	model?: string;
	system?: string | SystemMessage[];
	tools?: Tool[];
}

/**
 * Type guard to check if a system array element is a SystemMessage with text
 */
function isSystemMessageWithText(
	item: unknown,
): item is SystemMessage & { text: string } {
	return (
		typeof item === "object" &&
		item !== null &&
		"type" in item &&
		"text" in item &&
		typeof (item as SystemMessage).text === "string"
	);
}

/**
 * Applies system prompt interception if configured.
 *
 * This function provides template-based system prompt replacement for the main
 * Claude Code agent. It allows users to customize the instructional portion of
 * the system prompt while preserving dynamic environment data.
 *
 * @param requestBodyBuffer - The buffered request body
 * @param dbOps - Database operations instance
 * @returns Modified request body buffer if changes were made, null otherwise
 */
export async function applySystemPromptInterception(
	requestBodyBuffer: ArrayBuffer | null,
	dbOps: DatabaseOperations,
): Promise<ArrayBuffer | null> {
	// If no body, nothing to intercept
	if (!requestBodyBuffer) {
		return null;
	}

	try {
		// Parse the request body
		const bodyText = new TextDecoder().decode(requestBodyBuffer);
		const requestBody = JSON.parse(bodyText) as RequestBody;

		// Early check: Fetch interceptor configuration before any processing
		const interceptorConfig = dbOps.getInterceptorConfig("system_prompt");

		// If not enabled or config missing, return unchanged
		if (!interceptorConfig || !interceptorConfig.isEnabled) {
			interceptLog.info("System prompt interceptor is not enabled");
			return null;
		}

		interceptLog.info("System prompt interceptor is enabled");

		// Check if this is a main agent request
		if (!Array.isArray(requestBody.system)) {
			interceptLog.info("System field is not an array, skipping interception");
			return null;
		}

		// Check first system message for main agent identification with type guard
		const firstSystemMessage = requestBody.system[0];
		if (!isSystemMessageWithText(firstSystemMessage)) {
			interceptLog.info(
				"First system message is not in expected format, skipping interception",
			);
			return null;
		}
		const firstSystemText = firstSystemMessage.text;

		// Check if it's the main Claude Code agent (not a subagent)
		const isMainAgent = firstSystemText.includes(
			"You are Claude Code, Anthropic's official CLI for Claude.",
		);
		const isSubAgent = firstSystemText.includes(
			"You are an agent for Claude Code",
		);

		if (!isMainAgent || isSubAgent) {
			interceptLog.info(
				`Not a main agent request (isMainAgent: ${isMainAgent}, isSubAgent: ${isSubAgent}), skipping interception`,
			);
			return null;
		}

		interceptLog.info(
			"Detected main agent request, applying system prompt interception",
		);

		// Capture and save tools array for main agent requests
		if (requestBody.tools && Array.isArray(requestBody.tools)) {
			// Update last-seen tools in next tick (truly non-blocking)
			setImmediate(() => {
				_updateLastSeenTools(requestBody.tools as Tool[], dbOps);
			});
		}

		// Extract the second system message (contains env block and other dynamic content)
		const secondSystemMessage = requestBody.system[1];
		if (!isSystemMessageWithText(secondSystemMessage)) {
			interceptLog.info(
				"Second system message is not in expected format, skipping interception",
			);
			return null;
		}

		// Capture the original system prompt before any modifications
		const originalPrompt = secondSystemMessage.text;

		// Update last-seen prompt in next tick (truly non-blocking)
		setImmediate(() => {
			_updateLastSeenPrompt(originalPrompt, dbOps);
		});

		// Extract the <env> block(s) from the original system prompt
		// Using global regex to find all env blocks
		const envBlockRegex = /<env>([\s\S]*?)<\/env>/g;
		const envBlocks = secondSystemMessage.text.match(envBlockRegex) || [];

		let envBlock = "";
		if (envBlocks.length === 0) {
			interceptLog.warn(
				"No env block found in system prompt, using empty string",
			);
		} else if (envBlocks.length === 1) {
			envBlock = envBlocks[0];
			interceptLog.info(`Extracted env block (${envBlock.length} chars)`);
		} else {
			// Multiple env blocks found - concatenate them
			envBlock = envBlocks.join("\n");
			interceptLog.warn(
				`Found ${envBlocks.length} env blocks, concatenating them (${envBlock.length} chars total)`,
			);
		}

		// Extract the git status block from the original system prompt
		// The git status block starts with "gitStatus:" and continues to the end
		const gitStatusIndex = secondSystemMessage.text.indexOf("gitStatus:");
		let gitStatusBlock = "";
		if (gitStatusIndex !== -1) {
			gitStatusBlock = secondSystemMessage.text.substring(gitStatusIndex);
			interceptLog.info(
				`Extracted git status block (${gitStatusBlock.length} chars)`,
			);
		} else {
			interceptLog.info("No git status block found in system prompt");
		}

		// Validate and apply the template
		const { replacementPrompt, toolsEnabled } = interceptorConfig.config;

		// Validate replacementPrompt is a non-empty string
		if (!replacementPrompt || typeof replacementPrompt !== "string") {
			interceptLog.error(
				"Invalid replacementPrompt in config, skipping interception",
			);
			return null;
		}

		// Check if the current prompt matches the target (simplified check - could be enhanced)
		// For now, we'll always apply the replacement if the interceptor is enabled
		// Future enhancement: actually compare originalPrompt with targetPrompt

		// Validate template has the placeholder
		if (!replacementPrompt.includes("{{env_block}}")) {
			interceptLog.warn(
				"Replacement prompt missing {{env_block}} placeholder, env data may be lost",
			);
		}

		// Apply template with all occurrences replaced
		let newPrompt = replacementPrompt.replace(/\{\{env_block\}\}/g, envBlock);
		newPrompt = newPrompt.replace(/\{\{git_status_block\}\}/g, gitStatusBlock);

		// Verify replacement actually happened
		if (newPrompt === replacementPrompt && envBlock) {
			interceptLog.warn(
				"Template replacement may have failed - prompt unchanged despite env block present",
			);
		}

		// Update the second system message
		secondSystemMessage.text = newPrompt;

		interceptLog.info(
			`Applied replacement prompt, new prompt length: ${newPrompt.length} chars`,
		);

		// Handle tools toggle
		let _toolsRemoved = false;
		if (!toolsEnabled && requestBody.tools !== undefined) {
			const toolCount = requestBody.tools.length;
			delete requestBody.tools;
			_toolsRemoved = true;
			interceptLog.info(
				`Removed ${toolCount} tools from request as per configuration`,
			);
		}

		// Convert back to buffer if modifications were made
		const modifiedBodyText = JSON.stringify(requestBody);
		const encodedData = new TextEncoder().encode(modifiedBodyText);
		const modifiedBody = new ArrayBuffer(encodedData.byteLength);
		new Uint8Array(modifiedBody).set(encodedData);

		return modifiedBody;
	} catch (error) {
		interceptLog.error("Failed to apply system prompt interception:", error);
		return null;
	}
}

/**
 * Updates the last-seen system prompt in the database if it has changed.
 * This is a non-critical synchronous operation that logs errors but doesn't throw.
 * Should be called via setImmediate to avoid blocking the request.
 *
 * @param prompt - The original system prompt to store
 * @param dbOps - Database operations instance
 */
function _updateLastSeenPrompt(
	prompt: string,
	dbOps: DatabaseOperations,
): void {
	try {
		const lastSeen = dbOps.getSystemKV("last_seen_system_prompt");

		// Only update if the prompt has changed
		if (prompt !== lastSeen) {
			dbOps.setSystemKV("last_seen_system_prompt", prompt);
			updateLog.info("Updated last-seen system prompt in database");
		} else {
			updateLog.info("System prompt unchanged, skipping database update");
		}
	} catch (error) {
		// Log error but don't throw - this is a non-critical background operation
		updateLog.error("Failed to update last-seen system prompt:", error);
	}
}

/**
 * Updates the last-seen tools array in the database.
 * This is a non-critical synchronous operation that logs errors but doesn't throw.
 * Should be called via setImmediate to avoid blocking the request.
 *
 * @param tools - The tools array from the main agent request
 * @param dbOps - Database operations instance
 */
function _updateLastSeenTools(tools: Tool[], dbOps: DatabaseOperations): void {
	try {
		const toolsJson = JSON.stringify(tools);
		const lastSeen = dbOps.getSystemKV("last_seen_tools");

		// Only update if the tools have changed
		if (toolsJson !== lastSeen) {
			dbOps.setSystemKV("last_seen_tools", toolsJson);
			updateToolsLog.info(
				`Updated last-seen tools in database (${tools.length} tools)`,
			);
		} else {
			updateToolsLog.info("Tools unchanged, skipping database update");
		}
	} catch (error) {
		// Log error but don't throw - this is a non-critical background operation
		updateToolsLog.error("Failed to update last-seen tools:", error);
	}
}
