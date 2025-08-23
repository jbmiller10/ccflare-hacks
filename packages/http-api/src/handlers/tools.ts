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
				// Try to get the last-seen system prompt as the default
				const lastSeenPrompt = dbOps.getSystemKV("last_seen_system_prompt");
				const defaultPromptTemplate =
					lastSeenPrompt || "Your custom prompt here.\n\n{{env_block}}";

				return jsonResponse({
					isEnabled: false,
					promptTemplate: defaultPromptTemplate,
					toolsEnabled: true,
				});
			}

			return jsonResponse({
				isEnabled: config.isEnabled,
				promptTemplate: config.config.promptTemplate,
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

				if (body.promptTemplate === undefined || body.promptTemplate === null) {
					return errorResponse(BadRequest("promptTemplate is required"));
				}
				if (typeof body.promptTemplate !== "string") {
					return errorResponse(BadRequest("promptTemplate must be a string"));
				}
				if (body.promptTemplate.trim() === "") {
					return errorResponse(BadRequest("promptTemplate cannot be empty"));
				}

				if (body.toolsEnabled === undefined || body.toolsEnabled === null) {
					return errorResponse(BadRequest("toolsEnabled is required"));
				}
				if (typeof body.toolsEnabled !== "boolean") {
					return errorResponse(BadRequest("toolsEnabled must be a boolean"));
				}

				// Save configuration to database
				dbOps.setInterceptorConfig("system_prompt", body.isEnabled, {
					promptTemplate: body.promptTemplate,
					toolsEnabled: body.toolsEnabled,
				});

				return jsonResponse({
					success: true,
					isEnabled: body.isEnabled,
					promptTemplate: body.promptTemplate,
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
