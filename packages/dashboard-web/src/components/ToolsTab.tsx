import { SystemPromptInterceptorCard } from "./tools/SystemPromptInterceptorCard";

export function ToolsTab() {
	return (
		<div className="container mx-auto p-6">
			<div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
				<p className="text-red-700 font-medium">
					<span className="font-bold">Warning:</span> Modifying the system
					prompt (including tool definitions) reduces cache efficiency, leading
					to higher API costs or faster quota consumption.
				</p>
			</div>
			<SystemPromptInterceptorCard />
		</div>
	);
}
