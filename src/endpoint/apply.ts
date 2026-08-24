import type { ApiOutput } from '@directus/types';
import { EXTENSION_MARKETPLACE_UID, EXTENSION_PACKAGE_NAME } from '../shared/extension-meta';
import { compareSemver, normalizeVersion } from '../shared/semver';
import type { UpdateApplyResponse } from '../shared/types';
import { invalidateUpdateCache } from './check';
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
	hostVersion?: string | null;
}): Promise<UpdateApplyResponse> {
	if (applying) {
		throw Object.assign(new Error('An update is already in progress'), { status: 409 });
	}

	applying = true;
	try {
		const current = await options.extensionsService.readOne(options.extensionId);
		if (current.meta?.source !== 'registry') {
			throw Object.assign(new Error('Only marketplace (registry) extensions can be updated this way'), {
				status: 400,
			});
		}
		if (current.bundle != null || current.meta?.bundle != null) {
			throw Object.assign(new Error('Bundle entries cannot be updated separately'), { status: 400 });
		}

		const registry = resolveRegistryBase(options.env);
		// hostVersion is accepted for API compatibility; declared marketplace host ranges
		// are advisory only and do not gate which version is installed.
		readHostVersion(options.env, options.hostVersion || undefined);
		const described = await describeExtension(options.extensionId, registry, true);
		const versions = Array.isArray(described.versions) ? described.versions : [];
		const latest = versions[0] || null;
		if (!latest) {
			throw Object.assign(new Error('No marketplace versions were found for this extension'), {
				status: 400,
			});
		}

		const fromVersion = schemaVersion(current);
		if (compareSemver(latest.version, fromVersion) <= 0) {
			throw Object.assign(new Error('This extension is already up to date'), { status: 400 });
		}

		const previousVersionId = String(current.meta.folder);
		const wasEnabled = Boolean(current.meta.enabled);
		const selfUpdate = isSelf(current);

		try {
			await options.extensionsService.uninstall(options.extensionId);
			await options.extensionsService.install(options.extensionId, latest.id);
		} catch (error) {
			try {
				await options.extensionsService.install(options.extensionId, previousVersionId);
			} catch {
				// original error is more useful
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

		return {
			id: options.extensionId,
			name: described.name || schemaName(current),
			from_version: fromVersion,
			to_version: latest.version,
			reload_required: true,
			self_update: selfUpdate,
		};
	} finally {
		applying = false;
	}
}
