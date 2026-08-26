import { inspectInstalledPackage } from './package-integrity';

type LoggerLike = { warn: (m: string) => void; info?: (m: string) => void };

type ExtensionsServiceLike = {
	updateOne: (id: string, data: { meta: { enabled: boolean } }) => Promise<unknown>;
};

export type QuarantinedPackage = {
	id: string;
	folder: string;
	name: string;
	missing: string[];
};

let running = false;

/**
 * Disable enabled Marketplace installs whose entry files are missing on disk.
 * Directus bundles ALL enabled App extensions in one Rollup; one missing dist
 * file drops every Studio module (including this updater). API hooks still run,
 * so we can quarantine here and trigger a reload via ExtensionsService.updateOne.
 */
export async function quarantineCorruptRegistryExtensions(options: {
	database: { (table: string): any };
	env: Record<string, unknown>;
	extensionsService?: ExtensionsServiceLike | null;
	logger?: LoggerLike;
}): Promise<QuarantinedPackage[]> {
	if (running) return [];
	running = true;
	try {
		const rows = await options.database('directus_extensions')
			.select('id', 'folder', 'enabled', 'source', 'bundle')
			.where({ source: 'registry' })
			.whereNull('bundle')
			.where({ enabled: true });

		const broken: QuarantinedPackage[] = [];
		for (const row of rows || []) {
			const folder = String(row.folder || '');
			if (!folder) continue;
			const inspected = inspectInstalledPackage(options.env, folder);
			if (!inspected.missing.length) continue;
			broken.push({
				id: String(row.id),
				folder,
				name: inspected.name || String(row.id),
				missing: inspected.missing,
			});
		}

		if (!broken.length) return [];

		for (const item of broken) {
			options.logger?.warn(
				`[extension-updates] Corrupt Marketplace package ${item.name} (${item.folder}) is missing ${item.missing.join(', ')}. Disabling it so Studio App extensions can load.`,
			);
			if (options.extensionsService) {
				try {
					await options.extensionsService.updateOne(item.id, { meta: { enabled: false } });
					continue;
				} catch {
					// fall through to a direct row update
				}
			}
			await options.database('directus_extensions').where({ id: item.id }).update({ enabled: false });
		}

		return broken;
	} finally {
		running = false;
	}
}
