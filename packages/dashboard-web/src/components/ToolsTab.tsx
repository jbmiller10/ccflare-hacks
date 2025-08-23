import { SystemPromptInterceptorCard } from "./tools/SystemPromptInterceptorCard";

export function ToolsTab() {
	return (
		<div className="container mx-auto p-6">
			<div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
				<p className="text-amber-800 text-sm">
					<span className="font-semibold">Note:</span> Frequently modifying the
					system prompt (including tool definitions) reduces cache efficiency,
					leading to higher API costs or faster quota consumption.
				</p>
			</div>
			<SystemPromptInterceptorCard />
		</div>
	);
}
