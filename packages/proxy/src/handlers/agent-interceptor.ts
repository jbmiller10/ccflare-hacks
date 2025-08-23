import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { agentRegistry } from "@ccflare/agents";
import type { DatabaseOperations } from "@ccflare/database";
import { Logger } from "@ccflare/logger";
import type { Agent } from "@ccflare/types";

const log = new Logger("AgentInterceptor");

export interface AgentInterceptResult {
	modifiedBody: ArrayBuffer | null;
	agentUsed: string | null;
	originalModel: string | null;
	appliedModel: string | null;
	systemPromptModified?: boolean;
	toolsRemoved?: boolean;
}

/**
 * Detects agent usage, modifies the request body to use the preferred model,
 * and applies system prompt interception if configured
 * @param requestBodyBuffer - The buffered request body
 * @param dbOps - Database operations instance
 * @returns Modified request body and agent/system prompt modification information
 */
export async function interceptAndModifyRequest(
	requestBodyBuffer: ArrayBuffer | null,
	dbOps: DatabaseOperations,
): Promise<AgentInterceptResult> {
	// If no body, nothing to intercept
	if (!requestBodyBuffer) {
		return {
			modifiedBody: null,
			agentUsed: null,
			originalModel: null,
			appliedModel: null,
		};
	}

	try {
		// Parse the request body
		const bodyText = new TextDecoder().decode(requestBodyBuffer);
		const requestBody = JSON.parse(bodyText);

		// Extract original model
		const originalModel = requestBody.model || null;

		// Extract system prompt to detect agent usage
		const systemPrompt = extractSystemPrompt(requestBody);
		if (!systemPrompt) {
			// No system prompt, no agent detection possible
			log.info("No system prompt found in request");
			return {
				modifiedBody: requestBodyBuffer,
				agentUsed: null,
				originalModel,
				appliedModel: originalModel,
			};
		}

		// Register additional agent directories from system prompt
		log.info(`System prompt length: ${systemPrompt.length} chars`);
		if (systemPrompt.includes("CLAUDE.md")) {
			log.info("System prompt contains CLAUDE.md reference");

			// Look specifically for the Contents pattern
			if (systemPrompt.includes("Contents of")) {
				const contentsIndex = systemPrompt.indexOf("Contents of");
				const start = contentsIndex;
				const end = Math.min(systemPrompt.length, contentsIndex + 200);
				const sample = systemPrompt.substring(start, end);
				log.info(`Found 'Contents of' pattern: ${sample}`);
			} else {
				log.info("System prompt does NOT contain 'Contents of' pattern");
				// Show a sample of what we do have
				const claudeIndex = systemPrompt.indexOf("CLAUDE.md");
				const start = Math.max(0, claudeIndex - 50);
				const end = Math.min(systemPrompt.length, claudeIndex + 50);
				const sample = systemPrompt.substring(start, end);
				log.info(`Sample around CLAUDE.md: ...${sample}...`);
			}

			// Count all CLAUDE.md occurrences
			const matches = systemPrompt.match(/CLAUDE\.md/g);
			log.info(`Total CLAUDE.md occurrences: ${matches ? matches.length : 0}`);
		}

		const extraDirs = extractAgentDirectories(systemPrompt);
		log.info(
			`Found ${extraDirs.length} potential agent directories in system prompt`,
		);

		for (const dir of extraDirs) {
			log.info(`Checking potential workspace from agents directory: ${dir}`);
			// Extract workspace path from agents directory
			// Convert /path/to/project/.claude/agents to /path/to/project
			const workspacePath = dir.replace(/\/.claude\/agents$/, "");

			// Only register if the workspace exists
			if (existsSync(workspacePath)) {
				await agentRegistry.registerWorkspace(workspacePath);
				log.info(`Registered workspace: ${workspacePath}`);
			} else {
				log.info(`Workspace path does not exist: ${workspacePath}`);
			}
		}

		// Detect agent usage
		const agents = await agentRegistry.getAgents();
		const detectedAgent = agents.find((agent: Agent) =>
			systemPrompt.includes(agent.systemPrompt.trim()),
		);

		if (!detectedAgent) {
			// No agent detected, but still apply system prompt interception
			const systemPromptResult = applySystemPromptInterception(
				requestBody,
				dbOps,
			);

			// If system prompt was modified, create new buffer
			if (systemPromptResult.modified || systemPromptResult.toolsRemoved) {
				const modifiedBodyText = JSON.stringify(requestBody);
				const encodedData = new TextEncoder().encode(modifiedBodyText);
				const modifiedBody = new ArrayBuffer(encodedData.byteLength);
				new Uint8Array(modifiedBody).set(encodedData);

				return {
					modifiedBody,
					agentUsed: null,
					originalModel,
					appliedModel: originalModel,
					systemPromptModified: systemPromptResult.modified,
					toolsRemoved: systemPromptResult.toolsRemoved,
				};
			}

			return {
				modifiedBody: requestBodyBuffer,
				agentUsed: null,
				originalModel,
				appliedModel: originalModel,
			};
		}

		log.info(
			`Detected agent usage: ${detectedAgent.name} (${detectedAgent.id})`,
		);

		// Look up model preference
		const preference = dbOps.getAgentPreference(detectedAgent.id);
		const preferredModel = preference?.model || detectedAgent.model;

		// If the preferred model is the same as original, still check system prompt interception
		if (preferredModel === originalModel) {
			const systemPromptResult = applySystemPromptInterception(
				requestBody,
				dbOps,
			);

			// If system prompt was modified, create new buffer
			if (systemPromptResult.modified || systemPromptResult.toolsRemoved) {
				const modifiedBodyText = JSON.stringify(requestBody);
				const encodedData = new TextEncoder().encode(modifiedBodyText);
				const modifiedBody = new ArrayBuffer(encodedData.byteLength);
				new Uint8Array(modifiedBody).set(encodedData);

				return {
					modifiedBody,
					agentUsed: detectedAgent.id,
					originalModel,
					appliedModel: originalModel,
					systemPromptModified: systemPromptResult.modified,
					toolsRemoved: systemPromptResult.toolsRemoved,
				};
			}

			return {
				modifiedBody: requestBodyBuffer,
				agentUsed: detectedAgent.id,
				originalModel,
				appliedModel: originalModel,
			};
		}

		// Modify the request body with the preferred model
		log.info(`Modifying model from ${originalModel} to ${preferredModel}`);
		requestBody.model = preferredModel;

		// Apply system prompt interception
		const systemPromptResult = applySystemPromptInterception(
			requestBody,
			dbOps,
		);

		// Convert back to buffer
		const modifiedBodyText = JSON.stringify(requestBody);
		const encodedData = new TextEncoder().encode(modifiedBodyText);
		// Create a new ArrayBuffer to ensure compatibility
		const modifiedBody = new ArrayBuffer(encodedData.byteLength);
		new Uint8Array(modifiedBody).set(encodedData);

		return {
			modifiedBody,
			agentUsed: detectedAgent.id,
			originalModel,
			appliedModel: preferredModel,
			systemPromptModified: systemPromptResult.modified,
			toolsRemoved: systemPromptResult.toolsRemoved,
		};
	} catch (error) {
		log.error("Failed to intercept/modify request:", error);
		// On error, return original body unmodified
		return {
			modifiedBody: requestBodyBuffer,
			agentUsed: null,
			originalModel: null,
			appliedModel: null,
		};
	}
}

interface MessageContent {
	type?: string;
	text?: string;
}

interface Message {
	role?: string;
	content?: string | MessageContent[];
}

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
	messages?: Message[];
	model?: string;
	system?: string | SystemMessage[];
	tools?: Tool[];
}

/**
 * Extracts system prompt from request body
 * This will extract system messages and user messages that contain system-like content
 * @param requestBody - Parsed request body
 * @returns System prompt string or null
 */
function extractSystemPrompt(requestBody: RequestBody): string | null {
	const extractLog = new Logger("ExtractSystemPrompt");
	const allSystemContent: string[] = [];

	// First check for system field at root level (Claude Code pattern)
	if (requestBody.system) {
		extractLog.info("Found system field at root level");
		if (typeof requestBody.system === "string") {
			extractLog.info(
				`System field is string, length: ${requestBody.system.length}`,
			);
			allSystemContent.push(requestBody.system);
		}
		if (Array.isArray(requestBody.system)) {
			extractLog.info(
				`System field is array with ${requestBody.system.length} items`,
			);
			// Concatenate all text from system messages
			const systemText = requestBody.system
				.filter(
					(item): item is SystemMessage => item.type === "text" && !!item.text,
				)
				.map((item) => item.text)
				.join("\n");
			extractLog.info(`Extracted system text length: ${systemText.length}`);
			if (systemText) {
				allSystemContent.push(systemText);
			}
		}
	}

	// Then check messages array
	if (requestBody.messages && Array.isArray(requestBody.messages)) {
		extractLog.info(
			`Checking messages array with ${requestBody.messages.length} messages`,
		);

		// Look for system messages
		const systemMessage = requestBody.messages.find(
			(msg) => msg.role === "system",
		);

		if (systemMessage) {
			extractLog.info("Found system role message");
			if (typeof systemMessage.content === "string") {
				extractLog.info(
					`System message content is string, length: ${systemMessage.content.length}`,
				);
				allSystemContent.push(systemMessage.content);
			}
			if (Array.isArray(systemMessage.content)) {
				extractLog.info(
					`System message content is array with ${systemMessage.content.length} items`,
				);
				const systemText = systemMessage.content
					.filter(
						(item): item is MessageContent & { text: string } =>
							item.type === "text" && !!item.text,
					)
					.map((item) => item.text)
					.join("\n");
				extractLog.info(
					`Extracted system message text length: ${systemText.length}`,
				);
				if (systemText) {
					allSystemContent.push(systemText);
				}
			}
		} else {
			extractLog.info("No system role message found, checking user messages");
		}

		// Also check for system prompt in user messages
		const userMessage = requestBody.messages.find((msg) => msg.role === "user");

		if (userMessage && Array.isArray(userMessage.content)) {
			// Concatenate all text content from the user message
			const textContents = userMessage.content.filter(
				(item): item is MessageContent & { text: string } =>
					item.type === "text" && !!item.text,
			);

			extractLog.info(
				`Found ${textContents.length} text content items in user message`,
			);

			const allUserText = textContents.map((item) => item.text).join("\n");

			if (
				allUserText.includes("Contents of") &&
				allUserText.includes("CLAUDE.md")
			) {
				extractLog.info(
					"User message contains 'Contents of' and 'CLAUDE.md' - including in system prompt",
				);
				allSystemContent.push(allUserText);
			}
		} else if (userMessage && typeof userMessage.content === "string") {
			if (
				userMessage.content.includes("Contents of") &&
				userMessage.content.includes("CLAUDE.md")
			) {
				extractLog.info(
					"User message string contains 'Contents of' and 'CLAUDE.md' - including in system prompt",
				);
				allSystemContent.push(userMessage.content);
			}
		}
	}

	// Combine all system content
	if (allSystemContent.length > 0) {
		const combined = allSystemContent.join("\n\n");
		extractLog.info(
			`Combined system prompt length: ${combined.length} from ${allSystemContent.length} sources`,
		);
		return combined;
	}

	return null;
}

/**
 * Extracts agent directories from system prompt
 * @param systemPrompt - The system prompt text
 * @returns Array of agent directory paths
 */
function extractAgentDirectories(systemPrompt: string): string[] {
	const extractDirLog = new Logger("ExtractAgentDirs");
	const directories = new Set<string>();

	// Regex #1: Look for explicit /.claude/agents paths
	const agentPathRegex = /([\\/][\w\-. ]*?\/.claude\/agents)(?=[\s"'\]])/g;
	let match: RegExpExecArray | null;

	match = agentPathRegex.exec(systemPrompt);
	while (match !== null) {
		const dir = resolve(match[1]);
		directories.add(dir);
		match = agentPathRegex.exec(systemPrompt);
	}

	// Regex #2: Look for repo root pattern "Contents of (.*?)/CLAUDE.md"
	const repoRootRegex = /Contents of ([^\n]+?)\/CLAUDE\.md/g;

	let matchCount = 0;
	match = repoRootRegex.exec(systemPrompt);
	while (match !== null) {
		matchCount++;
		const repoRoot = match[1];
		extractDirLog.info(
			`Found CLAUDE.md path match ${matchCount}: "${match[0]}"`,
		);
		extractDirLog.info(`Extracted repo root: "${repoRoot}"`);

		// Clean up any escaped slashes
		const cleanedRoot = repoRoot.replace(/\\\//g, "/");
		const agentsDir = join(cleanedRoot, ".claude", "agents");
		const resolvedDir = resolve(agentsDir);

		extractDirLog.info(`Resolved agents dir: "${resolvedDir}"`);
		directories.add(resolvedDir);
		match = repoRootRegex.exec(systemPrompt);
	}

	if (matchCount === 0 && systemPrompt.includes("CLAUDE.md")) {
		extractDirLog.info(
			"No CLAUDE.md path matches found despite CLAUDE.md being in prompt",
		);
	}

	return Array.from(directories);
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
 * This function extends the agent interceptor to provide template-based system prompt
 * replacement. It was implemented here rather than as a separate handler to maintain
 * cleaner architecture and ensure both features work together seamlessly.
 *
 * Note: This function is synchronous as dbOps.getInterceptorConfig is synchronous.
 *
 * @param requestBody - The parsed request body
 * @param dbOps - Database operations instance
 * @returns Object indicating if modifications were made
 */
function applySystemPromptInterception(
	requestBody: RequestBody,
	dbOps: DatabaseOperations,
): { modified: boolean; toolsRemoved: boolean } {
	const interceptLog = new Logger("SystemPromptInterceptor");

	try {
		// Early check: Fetch interceptor configuration before any processing
		const interceptorConfig = dbOps.getInterceptorConfig("system_prompt");

		// If not enabled or config missing, return unchanged
		if (!interceptorConfig || !interceptorConfig.isEnabled) {
			interceptLog.info("System prompt interceptor is not enabled");
			return { modified: false, toolsRemoved: false };
		}

		interceptLog.info("System prompt interceptor is enabled");

		// Check if this is a main agent request
		if (!Array.isArray(requestBody.system)) {
			interceptLog.info("System field is not an array, skipping interception");
			return { modified: false, toolsRemoved: false };
		}

		// Check first system message for main agent identification with type guard
		const firstSystemMessage = requestBody.system[0];
		if (!isSystemMessageWithText(firstSystemMessage)) {
			interceptLog.info(
				"First system message is not in expected format, skipping interception",
			);
			return { modified: false, toolsRemoved: false };
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
			return { modified: false, toolsRemoved: false };
		}

		interceptLog.info(
			"Detected main agent request, applying system prompt interception",
		);

		// Extract the second system message (contains env block and other dynamic content)
		const secondSystemMessage = requestBody.system[1];
		if (!isSystemMessageWithText(secondSystemMessage)) {
			interceptLog.info(
				"Second system message is not in expected format, skipping interception",
			);
			return { modified: false, toolsRemoved: false };
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

		// Validate and apply the template
		const { promptTemplate, toolsEnabled } = interceptorConfig.config;

		// Validate promptTemplate is a non-empty string
		if (!promptTemplate || typeof promptTemplate !== "string") {
			interceptLog.error(
				"Invalid promptTemplate in config, skipping interception",
			);
			return { modified: false, toolsRemoved: false };
		}

		// Validate template has the placeholder
		if (!promptTemplate.includes("{{env_block}}")) {
			interceptLog.warn(
				"Template missing {{env_block}} placeholder, env data may be lost",
			);
		}

		// Apply template with all occurrences replaced
		const newPrompt = promptTemplate.replace(/\{\{env_block\}\}/g, envBlock);

		// Verify replacement actually happened
		if (newPrompt === promptTemplate && envBlock) {
			interceptLog.warn(
				"Template replacement may have failed - prompt unchanged despite env block present",
			);
		}

		// Update the second system message
		secondSystemMessage.text = newPrompt;

		interceptLog.info(
			`Applied prompt template, new prompt length: ${newPrompt.length} chars`,
		);

		// Handle tools toggle
		let toolsRemoved = false;
		if (!toolsEnabled && requestBody.tools !== undefined) {
			const toolCount = requestBody.tools.length;
			delete requestBody.tools;
			toolsRemoved = true;
			interceptLog.info(
				`Removed ${toolCount} tools from request as per configuration`,
			);
		}

		return { modified: true, toolsRemoved };
	} catch (error) {
		interceptLog.error("Failed to apply system prompt interception:", error);
		return { modified: false, toolsRemoved: false };
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
	const updateLog = new Logger("UpdateLastSeenPrompt");

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
