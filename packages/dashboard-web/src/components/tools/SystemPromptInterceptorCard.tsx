import { useEffect, useState } from "react";
import type { Tool } from "../../api";
import {
	useResetSystemPromptOverride,
	useSetSystemPromptOverride,
	useSystemPromptOverride,
} from "../../hooks/queries";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "../ui/accordion";
import { Button } from "../ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "../ui/card";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

interface ToolOverride {
	isEnabled: boolean;
	description: string;
}

export function SystemPromptInterceptorCard() {
	const { data, isLoading } = useSystemPromptOverride();
	const { mutate, isPending, isSuccess } = useSetSystemPromptOverride();
	const { mutate: resetMutate } = useResetSystemPromptOverride();

	// Local form state
	const [isEnabled, setIsEnabled] = useState(false);
	const [targetPrompt, setTargetPrompt] = useState("");
	const [replacementPrompt, setReplacementPrompt] = useState("");
	const [toolOverrides, setToolOverrides] = useState<
		Record<string, ToolOverride>
	>({});

	// Sync server data to local state
	useEffect(() => {
		if (data) {
			setIsEnabled(data.isEnabled);
			setTargetPrompt(data.config.targetPrompt);
			setReplacementPrompt(data.config.replacementPrompt);

			// Build tool overrides state from available tools and saved config
			const overrides: Record<string, ToolOverride> = {};
			for (const tool of data.availableTools || []) {
				const savedOverride = data.config.tools?.[tool.name];
				overrides[tool.name] = {
					isEnabled: savedOverride?.isEnabled ?? true,
					description: savedOverride?.description ?? tool.description ?? "",
				};
			}
			setToolOverrides(overrides);
		}
	}, [data]);

	const handleSave = () => {
		// Build tools config with only modified overrides
		const tools: Record<string, { isEnabled: boolean; description?: string }> =
			{};

		if (data?.availableTools) {
			for (const tool of data.availableTools) {
				const override = toolOverrides[tool.name];
				if (!override) continue;

				// Only include if different from defaults
				const needsOverride =
					!override.isEnabled ||
					(override.description &&
						override.description !== (tool.description ?? ""));

				if (needsOverride) {
					tools[tool.name] = {
						isEnabled: override.isEnabled,
					};
					// Only include description if it was changed
					if (
						override.description &&
						override.description !== (tool.description ?? "")
					) {
						tools[tool.name].description = override.description;
					}
				}
			}
		}

		mutate({
			isEnabled,
			config: {
				targetPrompt,
				replacementPrompt,
				tools,
			},
			availableTools: data?.availableTools || [],
		});
	};

	const handleToolToggle = (toolName: string, checked: boolean) => {
		setToolOverrides((prev) => ({
			...prev,
			[toolName]: {
				...prev[toolName],
				isEnabled: checked,
			},
		}));
	};

	const handleToolDescriptionChange = (toolName: string, value: string) => {
		setToolOverrides((prev) => ({
			...prev,
			[toolName]: {
				...prev[toolName],
				description: value,
			},
		}));
	};

	const handleResetTool = (tool: Tool) => {
		setToolOverrides((prev) => ({
			...prev,
			[tool.name]: {
				isEnabled: true,
				description: tool.description ?? "",
			},
		}));
	};

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>System Prompt Interceptor</CardTitle>
					<CardDescription>Loading configuration...</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>System Prompt Interceptor</CardTitle>
				<CardDescription>
					Configure a custom system prompt to override the default Claude
					behavior
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="flex items-center justify-between">
					<div className="space-y-0.5">
						<Label htmlFor="enable-interceptor">Enable Interceptor</Label>
						<p className="text-sm text-muted-foreground">
							When enabled, your custom prompt will be used
						</p>
					</div>
					<Switch
						id="enable-interceptor"
						checked={isEnabled}
						onCheckedChange={setIsEnabled}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="target-prompt">Target Prompt</Label>
					<Textarea
						id="target-prompt"
						placeholder="The prompt to look for and replace..."
						value={targetPrompt}
						onChange={(e) => setTargetPrompt(e.target.value)}
						className="min-h-[150px]"
						readOnly
					/>
					<p className="text-sm text-muted-foreground">
						This is the prompt that will be detected and replaced. After reset,
						this shows the last-seen system prompt.
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="replacement-prompt">Custom Prompt Template</Label>
					<Textarea
						id="replacement-prompt"
						placeholder="Your custom replacement prompt here..."
						value={replacementPrompt}
						onChange={(e) => setReplacementPrompt(e.target.value)}
						className="min-h-[200px]"
					/>
					<p className="text-sm text-muted-foreground">
						Use{" "}
						<code className="bg-muted px-1 py-0.5 rounded">
							{"{{env_block}}"}
						</code>{" "}
						and{" "}
						<code className="bg-muted px-1 py-0.5 rounded">
							{"{{git_status_block}}"}
						</code>{" "}
						to preserve dynamic content (e.g., environment, git status) from the
						original prompt.
					</p>
				</div>

				{data?.availableTools && data.availableTools.length > 0 && (
					<Accordion type="single" collapsible className="w-full">
						<AccordionItem value="tools">
							<AccordionTrigger>
								<div className="flex items-center gap-2">
									<span>Tool Overrides</span>
									<span className="text-sm text-muted-foreground">
										({data.availableTools.length} tools
										{(() => {
											const modifiedCount = data.availableTools.filter(
												(tool: Tool) => {
													const override = toolOverrides[tool.name];
													if (!override) return false;
													return (
														!override.isEnabled ||
														(override.description &&
															override.description !== (tool.description ?? ""))
													);
												},
											).length;
											return modifiedCount > 0
												? `, ${modifiedCount} modified`
												: "";
										})()})
									</span>
								</div>
							</AccordionTrigger>
							<AccordionContent>
								<div className="space-y-4 pt-4">
									{data.availableTools.map((tool: Tool) => {
										const override = toolOverrides[tool.name];
										if (!override) return null;

										// Check if tool has been modified from defaults
										const isModified =
											!override.isEnabled ||
											(override.description &&
												override.description !== (tool.description ?? ""));

										return (
											<div
												key={tool.name}
												className={`space-y-3 p-4 border rounded-lg ${
													isModified
														? "border-orange-500/50 bg-orange-50/5"
														: ""
												}`}
											>
												<div className="flex items-center justify-between">
													<div className="space-y-0.5 flex-1">
														<div className="flex items-center gap-2">
															<Label htmlFor={`tool-${tool.name}`}>
																{tool.name}
															</Label>
															{isModified && (
																<span className="text-xs text-orange-600 font-medium">
																	(Modified)
																</span>
															)}
														</div>
														<p className="text-sm text-muted-foreground">
															Enable or disable this tool
														</p>
													</div>
													<div className="flex items-center gap-2">
														{isModified && (
															<Button
																variant="ghost"
																size="sm"
																onClick={() => handleResetTool(tool)}
																title="Reset to default settings"
															>
																Reset
															</Button>
														)}
														<Switch
															id={`tool-${tool.name}`}
															checked={override.isEnabled}
															onCheckedChange={(checked) =>
																handleToolToggle(tool.name, checked)
															}
														/>
													</div>
												</div>

												{override.isEnabled && (
													<div className="space-y-2">
														<div className="flex items-center justify-between">
															<Label htmlFor={`tool-desc-${tool.name}`}>
																Custom Description (optional)
															</Label>
															{override.description &&
																override.description !==
																	(tool.description ?? "") && (
																	<span
																		className="text-xs text-muted-foreground"
																		title={
																			tool.description ||
																			"No original description"
																		}
																	>
																		(hover for original)
																	</span>
																)}
														</div>
														<Textarea
															id={`tool-desc-${tool.name}`}
															placeholder={tool.description || "No description"}
															value={override.description}
															onChange={(e) =>
																handleToolDescriptionChange(
																	tool.name,
																	e.target.value,
																)
															}
															className="min-h-[100px]"
														/>
														<p className="text-xs text-muted-foreground">
															Leave unedited to use default
														</p>
													</div>
												)}
											</div>
										);
									})}
								</div>
							</AccordionContent>
						</AccordionItem>
					</Accordion>
				)}
			</CardContent>
			<CardFooter className="flex gap-2">
				<Button onClick={handleSave} disabled={isPending}>
					{isPending ? "Saving..." : isSuccess ? "Saved!" : "Save"}
				</Button>
				<Button variant="outline" onClick={() => resetMutate()}>
					Reset to Default
				</Button>
			</CardFooter>
		</Card>
	);
}
