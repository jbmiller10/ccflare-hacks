import { useEffect, useState } from "react";
import {
	useResetSystemPromptOverride,
	useSetSystemPromptOverride,
	useSystemPromptOverride,
} from "../../hooks/queries";
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

export function SystemPromptInterceptorCard() {
	const { data, isLoading } = useSystemPromptOverride();
	const { mutate, isPending, isSuccess } = useSetSystemPromptOverride();
	const { mutate: resetMutate } = useResetSystemPromptOverride();

	// Local form state
	const [isEnabled, setIsEnabled] = useState(false);
	const [targetPrompt, setTargetPrompt] = useState("");
	const [replacementPrompt, setReplacementPrompt] = useState("");
	const [toolsEnabled, setToolsEnabled] = useState(true);

	// Sync server data to local state
	useEffect(() => {
		if (data) {
			setIsEnabled(data.isEnabled);
			setTargetPrompt(data.targetPrompt);
			setReplacementPrompt(data.replacementPrompt);
			setToolsEnabled(data.toolsEnabled);
		}
	}, [data]);

	const handleSave = () => {
		mutate({
			isEnabled,
			targetPrompt,
			replacementPrompt,
			toolsEnabled,
		});
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

				<div className="flex items-center justify-between">
					<div className="space-y-0.5">
						<Label htmlFor="enable-tools">Enable Tools</Label>
						<p className="text-sm text-muted-foreground">
							Allow Claude to use tools when this interceptor is active
						</p>
					</div>
					<Switch
						id="enable-tools"
						checked={toolsEnabled}
						onCheckedChange={setToolsEnabled}
					/>
				</div>
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
