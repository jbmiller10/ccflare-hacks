import { BaseRepository } from "./base.repository";

interface SystemKVRow {
	key: string;
	value: string;
}

export class SystemKVRepository extends BaseRepository<SystemKVRow> {
	getValue(key: string): string | null {
		const row = super.get<SystemKVRow>(
			"SELECT value FROM system_kv_store WHERE key = ?",
			[key],
		);

		return row?.value ?? null;
	}

	setValue(key: string, value: string): void {
		this.run(
			"INSERT OR REPLACE INTO system_kv_store (key, value) VALUES (?, ?)",
			[key, value],
		);
	}
}
