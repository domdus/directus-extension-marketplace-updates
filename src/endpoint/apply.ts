import type { ApiOutput } from '@directus/types';
import { EXTENSION_MARKETPLACE_UID, EXTENSION_PACKAGE_NAME } from '../shared/extension-meta';
import { compareSemver, normalizeVersion } from '../shared/semver';
import type { UpdateApplyResponse } from '../shared/types';
import { invalidateUpdateCache } from './check';
import {
	assertInstalledPackageOnDisk,
	assertMarketplacePackageIntegrity,
	inspectInstalledPackage,
	invalidateIntegrityCache,
} from './package-integrity';
import { describeExtension, readHostVersion, resolveRegistryBase } from './registry';

type ExtensionsServiceLike = {
	readOne: (id: string) => Promise<ApiOutput>;
	install: (extensionId: string, versionId: string) => Promise<void>;
	uninstall: (id: string) => Promise<void>;
	reinstall?: (id: string) => Promise<void>;
	updateOne: (id: string, data: { meta: { enabled: boolean } }) => Promise<ApiOutput>;
};

type LoggerLike = { error: (message: string) => void; warn?: (message: string) => void };

export type ApplyPlan = {
	extensionsService: ExtensionsServiceLike;
	env: Record<string, unknown>;
	extensionId: string;
	targetId: string;
	previousVersionId: string;
	wasEnabled: boolean;
	reinstallSame: boolean;
	response: UpdateApplyResponse;
};

let applying = false;

function schemaName(entry: ApiOutput): string {
	const schema = entry.schema as { name?: string } | null;
	return schema?.name ? String(schema.name) : entry.id;
}

function schemaVersion(entry: ApiOutput): string {
	const schema = entry.schema as { version?: string } | null;
	return schema?.version ? normalizeVersion(schema.version) : 'unknown';
}

function isSelf(entry: ApiOutput): boolean {
	if (EXTENSION_MARKETPLACE_UID && entry.id === EXTENSION_MARKETPLACE_UID) return true;
	return schemaName(entry) === EXTENSION_PACKAGE_NAME;
}

export function readInstallStatus(
	entry: ApiOutput,
	env?: Record<string, unknown>,
): {
	id: string;
	current_version: string;
	current_version_id: string;
	files_ok: boolean;
} {
	const current_version_id = String(entry.meta?.folder || '');
	const inspected = current_version_id
		? inspectInstalledPackage(env, current_version_id)
		: { missing: ['package.json'], error: 'missing package.json' as const };
	const files_ok = !inspected.error && inspected.missing.length === 0;
	return {
		id: entry.id,
		current_version: schemaVersion(entry),
		current_version_id,
		files_ok,
	};
}

/**
 * Validate and integrity-check only. The native uninstall/install that follows
 * reloads every API extension (~45s+) and would otherwise hold the HTTP request
 * past reverse-proxy timeouts.
 */
export async function prepareMarketplaceUpdate(options: {
	extensionsService: ExtensionsServiceLike;
	env: Record<string, unknown>;
	extensionId: string;
	versionId?: string | null;
	hostVersion?: string | null;
}): Promise<ApplyPlan> {
	if (applying) {
		throw Object.assign(new Error('An update is already in progress'), { status: 409 });
	}

	applying = true;
	try {
		const current = await options.extensionsService.readOne(options.extensionId);
		if (current.meta?.source !== 'registry') {
			throw Object.assign(new Error('Only Marketplace (registry) extensions can be updated this way'), {
				status: 400,
			});
		}
		if (current.bundle != null || current.meta?.bundle != null) {
			throw Object.assign(new Error('Bundle entries cannot be updated separately'), { status: 400 });
		}

		const registry = resolveRegistryBase(options.env);
		readHostVersion(options.env, options.hostVersion || undefined);
		const described = await describeExtension(options.extensionId, registry, true);
		const versions = Array.isArray(described.versions) ? described.versions : [];
		if (!versions.length) {
			throw Object.assign(new Error('No Marketplace versions were found for this extension'), {
				status: 400,
			});
		}

		const requestedId = options.versionId ? String(options.versionId) : null;
		const target = requestedId
			? versions.find((version) => version.id === requestedId) || null
			: versions[0] || null;

		if (!target) {
			throw Object.assign(new Error('Requested Marketplace version was not found'), { status: 400 });
		}

		const fromVersion = schemaVersion(current);
		const previousVersionId = String(current.meta.folder);
		const wasEnabled = Boolean(current.meta.enabled);
		const selfUpdate = isSelf(current);
		const disk = inspectInstalledPackage(options.env, previousVersionId);
		const filesMissing = Boolean(disk.error) || disk.missing.length > 0;
		const reinstallSame = target.id === previousVersionId && filesMissing;

		if (target.id === previousVersionId && !filesMissing) {
			throw Object.assign(new Error(`Version ${target.version} is already installed`), { status: 400 });
		}

		if (!requestedId && !filesMissing && compareSemver(target.version, fromVersion) <= 0) {
			throw Object.assign(new Error('This extension is already up to date'), { status: 400 });
		}

		await assertMarketplacePackageIntegrity(registry, target.id, { force: true });

		return {
			extensionsService: options.extensionsService,
			env: options.env,
			extensionId: options.extensionId,
			targetId: target.id,
			previousVersionId,
			wasEnabled,
			reinstallSame,
			response: {
				id: options.extensionId,
				name: described.name || schemaName(current),
				from_version: fromVersion,
				to_version: target.version,
				reload_required: true,
				self_update: selfUpdate,
				status: 'started',
			},
		};
	} catch (error) {
		applying = false;
		throw error;
	}
}

export async function finalizeMarketplaceUpdate(plan: ApplyPlan, logger?: LoggerLike): Promise<void> {
	try {
		let swapped = false;
		try {
			if (plan.reinstallSame && typeof plan.extensionsService.reinstall === 'function') {
				await plan.extensionsService.reinstall(plan.extensionId);
			} else {
				swapped = true;
				await plan.extensionsService.uninstall(plan.extensionId);
				await plan.extensionsService.install(plan.extensionId, plan.targetId);
			}
			assertInstalledPackageOnDisk(plan.env, plan.targetId);
		} catch (error) {
			if (swapped) {
				try {
					await plan.extensionsService.uninstall(plan.extensionId);
				} catch {
					// already gone, or never created
				}
				try {
					await plan.extensionsService.install(plan.extensionId, plan.previousVersionId);
				} catch {
					// original error is more useful
				}
			}
			throw error;
		}

		if (plan.reinstallSame) {
			try {
				await plan.extensionsService.updateOne(plan.extensionId, { meta: { enabled: true } });
			} catch {
				// reinstall succeeded; enable is best-effort
			}
		} else if (!plan.wasEnabled) {
			try {
				await plan.extensionsService.updateOne(plan.extensionId, { meta: { enabled: false } });
			} catch {
				// install succeeded; enabled-state restore is best-effort
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger?.error(`[extension-updates] Apply failed for ${plan.extensionId}: ${message}`);
		throw error;
	} finally {
		applying = false;
		invalidateUpdateCache();
		invalidateIntegrityCache();
	}
}
