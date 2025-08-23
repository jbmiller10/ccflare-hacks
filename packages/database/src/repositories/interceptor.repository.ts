import { BaseRepository } from "./base.repository";

export interface InterceptorConfig {
	targetPrompt: string;
	replacementPrompt: string;
	toolsEnabled: boolean;
}

interface InterceptorRow {
	id: string;
	is_enabled: number;
	config: string;
}

export class InterceptorRepository extends BaseRepository<InterceptorRow> {
	getConfig(
		id: string,
	): { isEnabled: boolean; config: InterceptorConfig } | null {
		const row = super.get<InterceptorRow>(
			"SELECT id, is_enabled, config FROM interceptors WHERE id = ?",
			[id],
		);

		if (!row) {
			return null;
		}

		return {
			isEnabled: row.is_enabled === 1,
			config: JSON.parse(row.config) as InterceptorConfig,
		};
	}

	setConfig(id: string, isEnabled: boolean, config: InterceptorConfig): void {
		const configJson = JSON.stringify(config);
		const isEnabledInt = isEnabled ? 1 : 0;

		this.run(
			"INSERT OR REPLACE INTO interceptors (id, is_enabled, config) VALUES (?, ?, ?)",
			[id, isEnabledInt, configJson],
		);
	}

	/**
	 * Delete an interceptor configuration
	 */
	delete(id: string): boolean {
		const changes = this.runWithChanges(
			"DELETE FROM interceptors WHERE id = ?",
			[id],
		);
		return changes > 0;
	}
}
