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

			// Return default configuration if none exists
			if (!config) {
				// Try to get the last-seen system prompt as the default target
				const lastSeenPrompt = dbOps.getSystemKV("last_seen_system_prompt");
				const DEFAULT_TARGET_PROMPT =
					"You are Claude Code, Anthropic's official CLI for Claude.";
				const defaultTemplate =
					"You are a helpful assistant.\n\n---\n\n{{env_block}}\n\n{{git_status_block}}";

				return jsonResponse({
					isEnabled: false,
					targetPrompt: lastSeenPrompt || DEFAULT_TARGET_PROMPT,
					replacementPrompt: defaultTemplate,
					toolsEnabled: true,
				});
			}

			return jsonResponse({
				isEnabled: config.isEnabled,
				targetPrompt: config.config.targetPrompt,
				replacementPrompt: config.config.replacementPrompt,
				toolsEnabled: config.config.toolsEnabled,
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

				if (body.targetPrompt === undefined || body.targetPrompt === null) {
					return errorResponse(BadRequest("targetPrompt is required"));
				}
				if (typeof body.targetPrompt !== "string") {
					return errorResponse(BadRequest("targetPrompt must be a string"));
				}
				if (body.targetPrompt.trim() === "") {
					return errorResponse(BadRequest("targetPrompt cannot be empty"));
				}

				if (
					body.replacementPrompt === undefined ||
					body.replacementPrompt === null
				) {
					return errorResponse(BadRequest("replacementPrompt is required"));
				}
				if (typeof body.replacementPrompt !== "string") {
					return errorResponse(
						BadRequest("replacementPrompt must be a string"),
					);
				}
				// Note: Empty strings are intentionally allowed for replacementPrompt
				// This enables users to effectively disable prompt replacement

				if (body.toolsEnabled === undefined || body.toolsEnabled === null) {
					return errorResponse(BadRequest("toolsEnabled is required"));
				}
				if (typeof body.toolsEnabled !== "boolean") {
					return errorResponse(BadRequest("toolsEnabled must be a boolean"));
				}

				// Save configuration to database
				dbOps.setInterceptorConfig("system_prompt", body.isEnabled, {
					targetPrompt: body.targetPrompt,
					replacementPrompt: body.replacementPrompt,
					toolsEnabled: body.toolsEnabled,
				});

				return jsonResponse({
					success: true,
					isEnabled: body.isEnabled,
					targetPrompt: body.targetPrompt,
					replacementPrompt: body.replacementPrompt,
					toolsEnabled: body.toolsEnabled,
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
