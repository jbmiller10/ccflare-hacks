import { useEffect, useState } from "react";
import {
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

	// Local form state
	const [isEnabled, setIsEnabled] = useState(false);
	const [promptTemplate, setPromptTemplate] = useState("");
	const [toolsEnabled, setToolsEnabled] = useState(true);

	// Sync server data to local state
	useEffect(() => {
		if (data) {
			setIsEnabled(data.isEnabled);
			setPromptTemplate(data.promptTemplate);
			setToolsEnabled(data.toolsEnabled);
		}
	}, [data]);

	const handleSave = () => {
		mutate({
			isEnabled,
			promptTemplate,
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
					<Label htmlFor="prompt-template">Prompt Template</Label>
					<Textarea
						id="prompt-template"
						placeholder="Your custom prompt here..."
						value={promptTemplate}
						onChange={(e) => setPromptTemplate(e.target.value)}
						className="min-h-[200px]"
					/>
					<p className="text-sm text-muted-foreground">
						Use{" "}
						<code className="bg-muted px-1 py-0.5 rounded">
							{"{{env_block}}"}
						</code>{" "}
						to preserve the dynamic environment details from the original
						prompt.
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
			<CardFooter>
				<Button onClick={handleSave} disabled={isPending}>
					{isPending ? "Saving..." : isSuccess ? "Saved!" : "Save"}
				</Button>
			</CardFooter>
		</Card>
	);
}
