import type { ApiOutput, ExtensionSettings } from '@directus/types';
import { EXTENSION_MARKETPLACE_UID, EXTENSION_PACKAGE_NAME } from '../shared/extension-meta';
import { compareSemver, normalizeVersion, versionSatisfies } from '../shared/semver';
import type { ExtensionUpdateItem, UpdateCheckResponse } from '../shared/types';
import { assertMarketplacePackageIntegrity, inspectInstalledPackage } from './package-integrity';
import { describeExtension, readHostVersion, resolveRegistryBase } from './registry';

type ExtensionsServiceLike = {
	readOne: (id: string) => Promise<ApiOutput>;
	extensionsItemService?: {
		readByQuery: (query: Record<string, unknown>) => Promise<ExtensionSettings[]>;
	};
};

async function listRegistryRoots(
	service: ExtensionsServiceLike,
	database: { (table: string): any },
): Promise<ApiOutput[]> {
	let rows: ExtensionSettings[] = [];

	try {
		const queried = await service.extensionsItemService?.readByQuery({
			filter: {
				_and: [{ source: { _eq: 'registry' } }, { bundle: { _null: true } }],
			},
			limit: -1,
		});
		if (Array.isArray(queried)) rows = queried;
	} catch {
		rows = [];
	}

	if (!rows.length) {
		try {
			rows = await database('directus_extensions')
				.select('id', 'source', 'enabled', 'bundle', 'folder')
				.where({ source: 'registry' })
				.whereNull('bundle');
		} catch {
			rows = [];
		}
	}

	const output: ApiOutput[] = [];
	for (const row of rows) {
		try {
			output.push(await service.readOne(row.id));
		} catch {
			output.push({
				id: row.id,
				bundle: row.bundle,
				meta: row,
				schema: null,
			});
		}
	}
	return output;
}

const listCache = new Map<string, { expiresAt: number; data: UpdateCheckResponse }>();
const LIST_TTL_MS = 30 * 60 * 1000;

function schemaName(entry: ApiOutput): string {
	const schema = entry.schema as { name?: string } | null;
	return schema?.name ? String(schema.name) : entry.id;
}

function schemaVersion(entry: ApiOutput): string {
	const schema = entry.schema as { version?: string } | null;
	return schema?.version ? normalizeVersion(schema.version) : 'unknown';
}

function schemaType(entry: ApiOutput): string | null {
	const schema = entry.schema as { type?: string } | null;
	return schema?.type ? String(schema.type) : null;
}

function isSelf(entry: ApiOutput): boolean {
	if (EXTENSION_MARKETPLACE_UID && entry.id === EXTENSION_MARKETPLACE_UID) return true;
	return schemaName(entry) === EXTENSION_PACKAGE_NAME;
}

function sortItems(items: ExtensionUpdateItem[]): ExtensionUpdateItem[] {
	const rank = (item: ExtensionUpdateItem) => {
		if (item.has_update && item.is_self) return 1;
		if (item.has_update) return 0;
		if (item.installed_blocked_reason) return 2;
		if (item.error) return 3;
		return 4;
	};
	return [...items].sort((a, b) => {
		const diff = rank(a) - rank(b);
		if (diff !== 0) return diff;
		return a.name.localeCompare(b.name);
	});
}

async function mapPool<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const index = next++;
			results[index] = await mapper(items[index]!);
		}
	}
	const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => worker());
	await Promise.all(workers);
	return results;
}

export async function checkMarketplaceUpdates(options: {
	extensionsService: ExtensionsServiceLike;
	database: { (table: string): any };
	env: Record<string, unknown>;
	hostVersion?: string | null;
	force?: boolean;
}): Promise<UpdateCheckResponse> {
	const registry = resolveRegistryBase(options.env);
	const hostVersion = readHostVersion(options.env, options.hostVersion || undefined);
	const cacheKey = `${registry}:${hostVersion || 'unknown'}`;

	if (!options.force) {
		const cached = listCache.get(cacheKey);
		if (cached && Date.now() < cached.expiresAt) return cached.data;
	}

	// Avoid ExtensionsService.readAll() — Directus 11.17 throws when a bundle
	// child exists but the parent schema has no `entries` array.
	const registryRoots = await listRegistryRoots(options.extensionsService, options.database);

	const items = await mapPool(registryRoots, 6, async (entry): Promise<ExtensionUpdateItem> => {
		const currentVersionId = String(entry.meta?.folder || '');
		let currentVersion = schemaVersion(entry);
		const base: ExtensionUpdateItem = {
			id: entry.id,
			name: schemaName(entry),
			type: schemaType(entry),
			enabled: Boolean(entry.meta?.enabled),
			current_version: currentVersion,
			current_version_id: currentVersionId,
			latest_version: null,
			latest_version_id: null,
			host_version: null,
			has_update: false,
			host_mismatch: false,
			is_self: isSelf(entry),
			marketplace_path: `/settings/marketplace/extension/${entry.id}`,
		};

		if (currentVersionId) {
			const inspected = inspectInstalledPackage(options.env, currentVersionId);
			if (inspected.error === 'missing package.json' || inspected.error === 'invalid package.json') {
				base.files_missing = true;
				base.installed_blocked_reason = 'Installed files are missing';
			} else if (inspected.missing.length) {
				base.installed_blocked_reason = `Installed package is missing ${inspected.missing.join(', ')}`;
			}
		}

		try {
			const described = await describeExtension(entry.id, registry, Boolean(options.force));
			const versions = Array.isArray(described.versions) ? described.versions : [];
			base.name = described.name || base.name;
			base.type = described.type || base.type;

			const installedRelease = versions.find((version) => version.id === currentVersionId);
			if (installedRelease?.version) currentVersion = installedRelease.version;
			base.current_version = currentVersion;

			// Always target the newest Marketplace release. Declared host_version ranges are
			// often outdated and must not block updates.
			const latest = versions[0] || null;
			if (latest) {
				base.latest_version = latest.version;
				base.latest_version_id = latest.id;
				base.host_version = latest.host_version || null;
				if (currentVersion !== 'unknown') {
					base.has_update = compareSemver(latest.version, currentVersion) > 0;
				} else {
					base.has_update = latest.id !== currentVersionId;
				}
				if (hostVersion && latest.host_version) {
					base.host_mismatch = !versionSatisfies(hostVersion, latest.host_version);
				}

				// Block Update All / Update when the latest tarball is missing entrypoints.
				// Keep this as an advisory — do not mark the row as Error if the install itself is fine.
				if (base.has_update && base.latest_version_id) {
					try {
						await assertMarketplacePackageIntegrity(registry, base.latest_version_id);
					} catch (integrityError: any) {
						base.has_update = false;
						base.latest_blocked_reason =
							integrityError?.message ||
							`Latest ${base.latest_version} is corrupt/incomplete and was blocked`;
					}
				}
			}
		} catch (error: any) {
			base.error = error?.message || 'Marketplace lookup failed';
		}

		return base;
	});

	const sorted = sortItems(items);
	const corruptItems = sorted.filter((item) => item.installed_blocked_reason && !item.files_missing);
	const data: UpdateCheckResponse = {
		host_version: hostVersion,
		checked_at: new Date().toISOString(),
		update_count: sorted.filter((item) => item.has_update).length,
		host_mismatch_count: sorted.filter((item) => item.has_update && item.host_mismatch).length,
		corrupt_count: corruptItems.length,
		corrupt_names: corruptItems.map((item) => item.name),
		items: sorted,
	};

	listCache.set(cacheKey, { data, expiresAt: Date.now() + LIST_TTL_MS });
	return data;
}

export function invalidateUpdateCache(): void {
	listCache.clear();
}
