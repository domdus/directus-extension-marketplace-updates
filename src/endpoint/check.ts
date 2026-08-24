import type { ApiOutput, ExtensionSettings } from '@directus/types';
import { EXTENSION_MARKETPLACE_UID, EXTENSION_PACKAGE_NAME } from '../shared/extension-meta';
import { compareSemver, normalizeVersion, versionSatisfies } from '../shared/semver';
import type { ExtensionUpdateItem, UpdateCheckResponse } from '../shared/types';
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
		if (item.incompatible_update) return 2;
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
			latest_compatible_version: null,
			latest_compatible_version_id: null,
			host_version: null,
			has_update: false,
			incompatible_update: false,
			is_self: isSelf(entry),
			marketplace_path: `/settings/marketplace/extension/${entry.id}`,
		};

		try {
			const described = await describeExtension(entry.id, registry, Boolean(options.force));
			const versions = Array.isArray(described.versions) ? described.versions : [];
			base.name = described.name || base.name;
			base.type = described.type || base.type;

			const installedRelease = versions.find((version) => version.id === currentVersionId);
			if (installedRelease?.version) currentVersion = installedRelease.version;
			base.current_version = currentVersion;

			const latest = versions[0] || null;
			if (latest) {
				base.latest_version = latest.version;
				base.latest_version_id = latest.id;
				base.host_version = latest.host_version || null;
			}

			const compatible = versions.find((version) =>
				hostVersion ? versionSatisfies(hostVersion, version.host_version) : true,
			);
			if (compatible) {
				base.latest_compatible_version = compatible.version;
				base.latest_compatible_version_id = compatible.id;
				base.host_version = compatible.host_version || base.host_version;
				if (currentVersion !== 'unknown') {
					base.has_update = compareSemver(compatible.version, currentVersion) > 0;
				} else {
					base.has_update = compatible.id !== currentVersionId;
				}
			}

			if (!base.has_update && latest && currentVersion !== 'unknown' && compareSemver(latest.version, currentVersion) > 0) {
				base.incompatible_update = true;
			}
		} catch (error: any) {
			base.error = error?.message || 'Marketplace lookup failed';
		}

		return base;
	});

	const sorted = sortItems(items);
	const data: UpdateCheckResponse = {
		host_version: hostVersion,
		checked_at: new Date().toISOString(),
		update_count: sorted.filter((item) => item.has_update).length,
		incompatible_count: sorted.filter((item) => item.incompatible_update).length,
		items: sorted,
	};

	listCache.set(cacheKey, { data, expiresAt: Date.now() + LIST_TTL_MS });
	return data;
}

export function invalidateUpdateCache(): void {
	listCache.clear();
}
