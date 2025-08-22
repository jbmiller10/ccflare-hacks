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
				return jsonResponse({
					isEnabled: false,
					promptTemplate: "Your custom prompt here.\n\n{{env_block}}",
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

				// Validate required fields
				if (typeof body.isEnabled !== "boolean") {
					return errorResponse(BadRequest("isEnabled must be a boolean"));
				}

				if (typeof body.promptTemplate !== "string") {
					return errorResponse(BadRequest("promptTemplate must be a string"));
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
	};
}
