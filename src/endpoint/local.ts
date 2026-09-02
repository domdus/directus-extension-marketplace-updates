import fs from 'node:fs';
import type { ApiOutput, ExtensionSettings } from '@directus/types';
import { EXTENSION_MARKETPLACE_UID, EXTENSION_PACKAGE_NAME } from '../shared/extension-meta';
import { compareSemver, normalizeVersion, versionSatisfies } from '../shared/semver';
import type {
	ExtensionUpdateItem,
	FolderStatus,
	UpdateApplyResponse,
} from '../shared/types';
import { parseExtensionArchive } from './archive';
import { beginApply, endApply } from './apply';
import { invalidateUpdateCache } from './cache';
import {
	assertLocalPackageOnDisk,
	assertMarketplacePackageIntegrity,
	inspectLocalPackage,
	invalidateIntegrityCache,
} from './package-integrity';
import {
	assertSafeFolderName,
	atomicWritePackage,
	backupDir,
	folderFromPackageName,
	inspectPackageDir,
	localPackageDir,
	moveDir,
	registryPackageDir,
} from './fs-local';
import { describeExtension, findMarketplaceByPackageName, readHostVersion, resolveRegistryBase } from './registry';
import { mapPool } from './pool';

type ExtensionReader = {
	readOne: (id: string) => Promise<ApiOutput>;
	extensionsItemService?: {
		readByQuery: (query: Record<string, unknown>) => Promise<ExtensionSettings[]>;
	};
};

type ExtensionsServiceLike = ExtensionReader & {
	readOne: (id: string) => Promise<ApiOutput>;
	install: (extensionId: string, versionId: string) => Promise<void>;
	uninstall: (id: string) => Promise<void>;
	deleteOne?: (id: string) => Promise<void>;
	updateOne?: (id: string, data: { meta: { enabled: boolean } }) => Promise<unknown>;
	extensionsItemService?: {
		readByQuery: (query: Record<string, unknown>) => Promise<ExtensionSettings[]>;
		deleteOne?: (id: string) => Promise<unknown>;
		deleteByQuery?: (query: Record<string, unknown>) => Promise<unknown>;
	};
	extensionsManager?: {
		reload?: (...args: any[]) => Promise<unknown>;
		broadcastReloadNotification?: (...args: any[]) => Promise<unknown>;
		isReloading?: () => Promise<unknown>;
	};
};

type LoggerLike = { error: (message: string) => void; warn?: (message: string) => void };

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

function isSelfName(name: string, entryId?: string): boolean {
	if (EXTENSION_MARKETPLACE_UID && entryId && entryId === EXTENSION_MARKETPLACE_UID) return true;
	return name === EXTENSION_PACKAGE_NAME;
}

export async function listLocalRoots(
	service: ExtensionReader,
	database: { (table: string): any },
): Promise<ApiOutput[]> {
	let rows: ExtensionSettings[] = [];

	try {
		const queried = await service.extensionsItemService?.readByQuery({
			filter: {
				_and: [{ source: { _eq: 'local' } }, { bundle: { _null: true } }],
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
				.where({ source: 'local' })
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

async function listRegistryPackageNames(
	service: ExtensionReader,
	database: { (table: string): any },
	env: Record<string, unknown>,
): Promise<Set<string>> {
	const names = new Set<string>();
	let rows: { folder?: string }[] = [];
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
				.select('folder')
				.where({ source: 'registry' })
				.whereNull('bundle');
		} catch {
			rows = [];
		}
	}
	for (const row of rows) {
		const folder = String(row.folder || '');
		if (!folder) continue;
		const inspected = inspectPackageDir(registryPackageDir(env, folder));
		if (inspected.name) names.add(inspected.name);
	}
	return names;
}

export async function reloadExtensions(service: ExtensionsServiceLike): Promise<void> {
	const manager = service.extensionsManager;
	if (!manager || typeof manager.reload !== 'function') {
		throw Object.assign(
			new Error('Directus could not reload extensions. Restart the API to load the new files.'),
			{ status: 500 },
		);
	}
	await manager.reload();
	if (typeof manager.isReloading === 'function') {
		try {
			await manager.isReloading();
		} catch {
			// already finished or not loaded
		}
	}
	if (typeof manager.broadcastReloadNotification === 'function') {
		try {
			await manager.broadcastReloadNotification();
		} catch {
			// studio refresh is still requested from the client
		}
	}
}

export function readFolderStatus(env: Record<string, unknown> | undefined, folder: string): FolderStatus {
	const safe = assertSafeFolderName(folder);
	const inspected = inspectLocalPackage(env, safe);
	return {
		folder: safe,
		name: inspected.name,
		current_version: inspected.version ? normalizeVersion(inspected.version) : 'unknown',
		files_ok: !inspected.error && inspected.missing.length === 0,
	};
}

export async function mapLocalUpdates(options: {
	extensionsService: ExtensionReader;
	database: { (table: string): any };
	env: Record<string, unknown>;
	hostVersion?: string | null;
	force?: boolean;
}): Promise<ExtensionUpdateItem[]> {
	const registry = resolveRegistryBase(options.env);
	const hostVersion = readHostVersion(options.env, options.hostVersion || undefined);
	const localRoots = await listLocalRoots(options.extensionsService, options.database);

	return mapPool(localRoots, 6, async (entry): Promise<ExtensionUpdateItem> => {
		const folder = String(entry.meta?.folder || '');
		const disk = folder ? inspectLocalPackage(options.env, folder) : { name: null, version: null, type: null, host: null, missing: ['package.json'], error: 'missing package.json' as const };
		const name = disk.name || schemaName(entry);
		const currentVersion = disk.version ? normalizeVersion(disk.version) : schemaVersion(entry);
		const item: ExtensionUpdateItem = {
			id: entry.id,
			source: 'local',
			name,
			type: disk.type || schemaType(entry),
			enabled: Boolean(entry.meta?.enabled),
			current_version: currentVersion,
			current_version_id: folder,
			folder,
			latest_version: null,
			latest_version_id: null,
			host_version: disk.host,
			has_update: false,
			host_mismatch: false,
			is_self: isSelfName(name, entry.id),
			marketplace_path: '',
		};

		if (!folder || disk.error === 'missing package.json' || disk.error === 'invalid package.json') {
			item.files_missing = true;
			item.installed_blocked_reason = 'Installed files are missing';
			return item;
		}
		if (disk.missing.length) {
			item.installed_blocked_reason = `Installed package is missing ${disk.missing.join(', ')}`;
		}

		if (disk.name) {
			try {
				const match = await findMarketplaceByPackageName(disk.name, registry, Boolean(options.force));
				if (match) {
					const described = await describeExtension(match.id, registry, Boolean(options.force));
					const latest = described.versions[0] || null;
					item.marketplace_id = match.id;
					item.marketplace_path = `/settings/marketplace/extension/${match.id}`;
					item.name = described.name || name;
					if (latest) {
						item.latest_version = latest.version || null;
						item.latest_version_id = latest.id || null;
						if (latest.host_version) item.host_version = latest.host_version;
						if (latest.version && currentVersion !== 'unknown') {
							item.has_update = compareSemver(latest.version, currentVersion) > 0;
							item.marketplace_older = compareSemver(latest.version, currentVersion) < 0;
						}
						if (hostVersion && item.host_version) {
							item.host_mismatch = !versionSatisfies(hostVersion, item.host_version);
						}
						if (item.has_update && latest.id) {
							try {
								await assertMarketplacePackageIntegrity(registry, latest.id);
							} catch (error: any) {
								item.has_update = false;
								item.latest_blocked_reason =
									error?.message || 'Marketplace package failed integrity check';
							}
						}
					}
				}
			} catch (error: any) {
				item.error = error?.message || 'Marketplace lookup failed';
			}
		}

		return item;
	});
}

type SwapPlan = {
	kind: 'swap';
	extensionsService: ExtensionsServiceLike;
	env: Record<string, unknown>;
	localId: string;
	localFolder: string;
	marketplaceId: string;
	targetId: string;
	wasEnabled: boolean;
	response: UpdateApplyResponse;
};

type UploadPlan = {
	kind: 'upload';
	extensionsService: ExtensionsServiceLike;
	env: Record<string, unknown>;
	folder: string;
	files: Map<string, Buffer>;
	replace: boolean;
	response: UpdateApplyResponse;
};

export type LocalPlan = SwapPlan | UploadPlan;

export async function prepareMarketplaceSwap(options: {
	extensionsService: ExtensionsServiceLike;
	database: { (table: string): any };
	env: Record<string, unknown>;
	extensionId: string;
	versionId?: string | null;
}): Promise<SwapPlan> {
	beginApply();
	try {
		const current = await options.extensionsService.readOne(options.extensionId);
		if (current.meta?.source !== 'local') {
			throw Object.assign(new Error('Only local folder extensions can be switched to the Marketplace'), {
				status: 400,
			});
		}
		if (current.bundle != null || current.meta?.bundle != null) {
			throw Object.assign(new Error('Bundle entries cannot be switched separately'), { status: 400 });
		}

		const folder = assertSafeFolderName(String(current.meta.folder || ''));
		const disk = inspectLocalPackage(options.env, folder);
		const name = disk.name || schemaName(current);
		if (!disk.name) {
			throw Object.assign(new Error('This local extension has no package.json name to match on the Marketplace'), {
				status: 400,
			});
		}

		const registry = resolveRegistryBase(options.env);
		const match = await findMarketplaceByPackageName(disk.name, registry, true);
		if (!match) {
			throw Object.assign(new Error('No unique Marketplace listing matches this package name'), { status: 400 });
		}

	try {
		const existing = await options.database('directus_extensions').where({ id: match.id }).first();
		if (existing) {
			throw Object.assign(
				new Error('This package is already installed from the Marketplace. Remove the local copy instead of switching.'),
				{ status: 400 },
			);
		}
	} catch (error: any) {
		if (error?.status === 400) throw error;
	}

		const described = await describeExtension(match.id, registry, true);
		const versions = described.versions || [];
		const requestedId = options.versionId ? String(options.versionId) : null;
		const target = requestedId
			? versions.find((version) => version.id === requestedId) || null
			: versions[0] || null;
		if (!target) {
			throw Object.assign(new Error('Requested Marketplace version was not found'), { status: 400 });
		}

		await assertMarketplacePackageIntegrity(registry, target.id, { force: true });

		return {
			kind: 'swap',
			extensionsService: options.extensionsService,
			env: options.env,
			localId: options.extensionId,
			localFolder: folder,
			marketplaceId: match.id,
			targetId: target.id,
			wasEnabled: Boolean(current.meta.enabled),
			response: {
				id: match.id,
				name: described.name || name,
				from_version: disk.version ? normalizeVersion(disk.version) : schemaVersion(current),
				to_version: target.version,
				reload_required: true,
				self_update: isSelfName(name, current.id),
				status: 'started',
				kind: 'swap',
				folder,
				current_version_id: target.id,
			},
		};
	} catch (error) {
		endApply();
		throw error;
	}
}

export async function prepareUpload(options: {
	extensionsService: ExtensionsServiceLike;
	database: { (table: string): any };
	env: Record<string, unknown>;
	buffer: Buffer;
	filename: string;
	replace: boolean;
}): Promise<UploadPlan> {
	const parsed = parseExtensionArchive(options.buffer, options.filename);
	const name = parsed.manifest.name;
	if (!name) {
		throw Object.assign(new Error('Uploaded package.json is missing name'), { status: 400 });
	}

	const registryNames = await listRegistryPackageNames(options.extensionsService, options.database, options.env);
	if (registryNames.has(name)) {
		throw Object.assign(
			new Error('This extension is already installed from the Marketplace. Update it there instead of uploading a local copy.'),
			{ status: 400 },
		);
	}

	const localRoots = await listLocalRoots(options.extensionsService, options.database);
	const existing = localRoots.find((entry) => {
		const folder = String(entry.meta?.folder || '');
		if (!folder) return false;
		const disk = inspectLocalPackage(options.env, folder);
		return disk.name === name;
	});

	const folder = existing
		? assertSafeFolderName(String(existing.meta.folder))
		: folderFromPackageName(name);
	const dest = localPackageDir(options.env, folder);
	const destExists = fs.existsSync(dest);
	const incomingVersion = parsed.manifest.version ? normalizeVersion(parsed.manifest.version) : '';
	if (!incomingVersion) {
		throw Object.assign(new Error('Uploaded package.json is missing version'), { status: 400 });
	}
	const currentDisk = destExists ? inspectPackageDir(dest) : null;
	const currentVersion = currentDisk?.version ? normalizeVersion(currentDisk.version) : null;

	if ((existing || destExists) && !options.replace) {
		throw Object.assign(
			new Error(
				currentVersion
					? `${name} is already installed locally as ${currentVersion}. Upload again with replace to overwrite it.`
					: `${name} is already installed locally. Upload again with replace to overwrite it.`,
			),
			{
				status: 409,
				extensions: {
					code: 'CONFLICT',
					folder,
					name,
					current_version: currentVersion,
					incoming_version: incomingVersion,
				},
			},
		);
	}

	beginApply();
	try {
		return {
			kind: 'upload',
			extensionsService: options.extensionsService,
			env: options.env,
			folder,
			files: parsed.files,
			replace: Boolean(existing || destExists),
			response: {
				id: existing?.id || folder,
				name,
				from_version: currentVersion || 'none',
				to_version: incomingVersion,
				reload_required: true,
				self_update: isSelfName(name, existing?.id),
				status: 'started',
				kind: 'upload',
				folder,
				current_version_id: folder,
			},
		};
	} catch (error) {
		endApply();
		throw error;
	}
}

async function deleteLocalRows(service: ExtensionsServiceLike, database: { (table: string): any }, id: string): Promise<void> {
	if (typeof service.deleteOne === 'function') {
		await service.deleteOne(id);
		return;
	}
	if (service.extensionsItemService?.deleteByQuery) {
		await service.extensionsItemService.deleteByQuery({ filter: { bundle: { _eq: id } } });
	}
	if (service.extensionsItemService?.deleteOne) {
		await service.extensionsItemService.deleteOne(id);
		return;
	}
	await database('directus_extensions').where({ bundle: id }).del();
	await database('directus_extensions').where({ id }).del();
}

export async function finalizeLocalPlan(
	plan: LocalPlan,
	logger?: LoggerLike,
	database?: { (table: string): any },
): Promise<void> {
	try {
		if (plan.kind === 'upload') {
			const dest = localPackageDir(plan.env, plan.folder);
			atomicWritePackage(dest, plan.files);
			assertLocalPackageOnDisk(plan.env, plan.folder);
			await reloadExtensions(plan.extensionsService);
			return;
		}

		const dest = localPackageDir(plan.env, plan.localFolder);
		let backup: string | null = null;
		let marketplaceInstalled = false;
		try {
			if (fs.existsSync(dest)) backup = backupDir(dest);
			if (database) {
				await deleteLocalRows(plan.extensionsService, database, plan.localId);
			} else if (typeof plan.extensionsService.deleteOne === 'function') {
				await plan.extensionsService.deleteOne(plan.localId);
			} else {
				throw new Error('Could not remove the local extension row');
			}
			await plan.extensionsService.install(plan.marketplaceId, plan.targetId);
			marketplaceInstalled = true;
			if (backup) fs.rmSync(backup, { recursive: true, force: true });
			if (!plan.wasEnabled) {
				try {
					await plan.extensionsService.updateOne?.(plan.marketplaceId, { meta: { enabled: false } });
				} catch {
					// enabled-state restore is best-effort
				}
			}
		} catch (error) {
			if (marketplaceInstalled) {
				try {
					await plan.extensionsService.uninstall(plan.marketplaceId);
				} catch {
					// restore local copy below
				}
			}
			if (backup && !fs.existsSync(dest)) {
				try {
					moveDir(backup, dest);
				} catch (restoreError: any) {
					logger?.error(`[extension-updates] Failed to restore local folder ${plan.localFolder}: ${restoreError?.message || restoreError}`);
				}
			}
			try {
				await reloadExtensions(plan.extensionsService);
			} catch {
				// original error is more useful
			}
			throw error;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger?.error(`[extension-updates] Local apply failed: ${message}`);
		throw error;
	} finally {
		endApply();
		invalidateUpdateCache();
		invalidateIntegrityCache();
	}
}
