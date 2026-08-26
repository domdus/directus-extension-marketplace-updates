import type { ApiOutput } from '@directus/types';
import { EXTENSION_MARKETPLACE_UID, EXTENSION_PACKAGE_NAME } from '../shared/extension-meta';
import { compareSemver, normalizeVersion } from '../shared/semver';
import type { UpdateApplyResponse } from '../shared/types';
import { invalidateUpdateCache } from './check';
import {
	assertInstalledPackageOnDisk,
	assertMarketplacePackageIntegrity,
	invalidateIntegrityCache,
} from './package-integrity';
import { describeExtension, readHostVersion, resolveRegistryBase } from './registry';

type ExtensionsServiceLike = {
	readOne: (id: string) => Promise<ApiOutput>;
	install: (extensionId: string, versionId: string) => Promise<void>;
	uninstall: (id: string) => Promise<void>;
	updateOne: (id: string, data: { meta: { enabled: boolean } }) => Promise<ApiOutput>;
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

export async function applyMarketplaceUpdate(options: {
	extensionsService: ExtensionsServiceLike;
	env: Record<string, unknown>;
	extensionId: string;
	/** When set, install this Marketplace version (upgrade or downgrade). */
	versionId?: string | null;
	hostVersion?: string | null;
}): Promise<UpdateApplyResponse> {
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
		// hostVersion is accepted for API compatibility; declared Marketplace host ranges
		// are advisory only and do not gate which version is installed.
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

		if (target.id === previousVersionId) {
			throw Object.assign(new Error(`Version ${target.version} is already installed`), { status: 400 });
		}

		// Default "Update" path only moves forward unless a specific version was chosen.
		if (!requestedId && compareSemver(target.version, fromVersion) <= 0) {
			throw Object.assign(new Error('This extension is already up to date'), { status: 400 });
		}

		// Refuse corrupt Marketplace publishes BEFORE uninstall (e.g. missing dist/).
		await assertMarketplacePackageIntegrity(registry, target.id, { force: true });

		/**
		 * Native Directus has no “switch version” API:
		 *   install()   → insert DB row (folder = version UUID), then extract tarball
		 *   reinstall() → re-extract the SAME folder UUID (no version change)
		 *   uninstall() → delete DB row, then delete `.registry/<folder>`
		 *
		 * Switching versions therefore has to be uninstall + install. That is unsafe
		 * if install() “succeeds” with an incomplete tarball (core only checks that
		 * package.json has a type — not that `directus:extension.path` exists).
		 *
		 * Rollback must uninstall the failed/new row first: a second install() would
		 * otherwise hit a unique constraint on `directus_extensions.id` and leave a
		 * ghost `.registry/<new-uuid>` that breaks the whole Studio app bundle.
		 */
		let swapped = false;
		try {
			swapped = true;
			await options.extensionsService.uninstall(options.extensionId);
			await options.extensionsService.install(options.extensionId, target.id);
			assertInstalledPackageOnDisk(options.env, target.id);
		} catch (error) {
			if (swapped) {
				try {
					await options.extensionsService.uninstall(options.extensionId);
				} catch {
					// already gone, or never created
				}
				try {
					await options.extensionsService.install(options.extensionId, previousVersionId);
				} catch {
					// original error is more useful
				}
			}
			throw error;
		}

		if (!wasEnabled) {
			try {
				await options.extensionsService.updateOne(options.extensionId, { meta: { enabled: false } });
			} catch {
				// install succeeded; enabled-state restore is best-effort
			}
		}

		invalidateUpdateCache();
		invalidateIntegrityCache();

		return {
			id: options.extensionId,
			name: described.name || schemaName(current),
			from_version: fromVersion,
			to_version: target.version,
			reload_required: true,
			self_update: selfUpdate,
		};
	} finally {
		applying = false;
	}
}
