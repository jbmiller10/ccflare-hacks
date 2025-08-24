import type { DatabaseOperations } from "@ccflare/database";
import { BadRequest, errorResponse, jsonResponse } from "@ccflare/http-common";

/**
 * Create system prompt interceptor handlers
 */
export function createSystemPromptInterceptorHandler(
	dbOps: DatabaseOperations,
) {
	return {
		/**
		 * Get system prompt interceptor configuration
		 */
		getSystemPromptConfig: (): Response => {
			const config = dbOps.getInterceptorConfig("system_prompt");

			// Always fetch the last-seen system prompt
			const lastSeenPrompt = dbOps.getSystemKV("last_seen_system_prompt");

			// Fetch the last-seen tools from KV store
			const lastSeenToolsJson = dbOps.getSystemKV("last_seen_tools");
			let availableTools: any[] = [];
			if (lastSeenToolsJson) {
				try {
					availableTools = JSON.parse(lastSeenToolsJson);
				} catch (_error) {
					// If parsing fails, default to empty array
					availableTools = [];
				}
			}

			// Return default configuration if none exists
			if (!config) {
				const DEFAULT_TARGET_PROMPT =
					"You are Claude Code, Anthropic's official CLI for Claude.";
				const defaultTemplate =
					"You are a helpful assistant.\n\n---\n\n{{env_block}}\n\n{{git_status_block}}";

				return jsonResponse({
					isEnabled: false,
					config: {
						targetPrompt: lastSeenPrompt || DEFAULT_TARGET_PROMPT,
						replacementPrompt: defaultTemplate,
						tools: {},
					},
					availableTools,
					lastSeenPrompt,
					hasPromptChanged: false,
				});
			}

			// Ensure backward compatibility by converting old config format
			const configTools = config.config.tools || {};

			// Check if the saved target prompt differs from the last-seen prompt
			const hasPromptChanged = !!(
				lastSeenPrompt && lastSeenPrompt !== config.config.targetPrompt
			);

			return jsonResponse({
				isEnabled: config.isEnabled,
				config: {
					targetPrompt: config.config.targetPrompt,
					replacementPrompt: config.config.replacementPrompt,
					tools: configTools,
				},
				availableTools,
				lastSeenPrompt,
				hasPromptChanged,
			});
		},

		/**
		 * Set system prompt interceptor configuration
		 */
		setSystemPromptConfig: async (req: Request): Promise<Response> => {
			try {
				const body = await req.json();

				// Validate required fields exist and have correct types
				if (body.isEnabled === undefined || body.isEnabled === null) {
					return errorResponse(BadRequest("isEnabled is required"));
				}
				if (typeof body.isEnabled !== "boolean") {
					return errorResponse(BadRequest("isEnabled must be a boolean"));
				}

				// Validate config object exists
				if (!body.config || typeof body.config !== "object") {
					return errorResponse(BadRequest("config object is required"));
				}

				if (
					body.config.targetPrompt === undefined ||
					body.config.targetPrompt === null
				) {
					return errorResponse(BadRequest("config.targetPrompt is required"));
				}
				if (typeof body.config.targetPrompt !== "string") {
					return errorResponse(
						BadRequest("config.targetPrompt must be a string"),
					);
				}
				if (body.config.targetPrompt.trim() === "") {
					return errorResponse(
						BadRequest("config.targetPrompt cannot be empty"),
					);
				}

				if (
					body.config.replacementPrompt === undefined ||
					body.config.replacementPrompt === null
				) {
					return errorResponse(
						BadRequest("config.replacementPrompt is required"),
					);
				}
				if (typeof body.config.replacementPrompt !== "string") {
					return errorResponse(
						BadRequest("config.replacementPrompt must be a string"),
					);
				}
				// Note: Empty strings are intentionally allowed for replacementPrompt
				// This enables users to effectively disable prompt replacement

				// Validate tools object
				if (body.config.tools === undefined || body.config.tools === null) {
					// If tools is not provided, default to empty object
					body.config.tools = {};
				}
				if (
					typeof body.config.tools !== "object" ||
					Array.isArray(body.config.tools)
				) {
					return errorResponse(BadRequest("config.tools must be an object"));
				}

				// Validate each tool override
				for (const [toolName, override] of Object.entries(body.config.tools)) {
					if (typeof override !== "object" || override === null) {
						return errorResponse(
							BadRequest(`config.tools.${toolName} must be an object`),
						);
					}
					const toolOverride = override as any;
					if (typeof toolOverride.isEnabled !== "boolean") {
						return errorResponse(
							BadRequest(
								`config.tools.${toolName}.isEnabled must be a boolean`,
							),
						);
					}
					if (
						toolOverride.description !== undefined &&
						typeof toolOverride.description !== "string"
					) {
						return errorResponse(
							BadRequest(
								`config.tools.${toolName}.description must be a string if provided`,
							),
						);
					}
				}

				// Save configuration to database
				dbOps.setInterceptorConfig("system_prompt", body.isEnabled, {
					targetPrompt: body.config.targetPrompt,
					replacementPrompt: body.config.replacementPrompt,
					tools: body.config.tools,
				});

				return jsonResponse({
					success: true,
					isEnabled: body.isEnabled,
					config: {
						targetPrompt: body.config.targetPrompt,
						replacementPrompt: body.config.replacementPrompt,
						tools: body.config.tools,
					},
				});
			} catch (error) {
				if (error instanceof SyntaxError) {
					return errorResponse(BadRequest("Invalid JSON"));
				}
				throw error;
			}
		},

		/**
		 * Reset system prompt interceptor configuration
		 */
		resetSystemPromptConfig: (): Response => {
			// Delete the interceptor config, which will cause the GET endpoint
			// to return the default state with last-seen prompt
			dbOps.deleteInterceptorConfig("system_prompt");

			// Return 204 No Content to indicate successful deletion
			return new Response(null, { status: 204 });
		},
	};
}
