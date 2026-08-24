import type { ApiOutput } from '@directus/types';
import { EXTENSION_MARKETPLACE_UID, EXTENSION_PACKAGE_NAME } from '../shared/extension-meta';
import { compareSemver, normalizeVersion, versionSatisfies } from '../shared/semver';
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
		const hostVersion = readHostVersion(options.env, options.hostVersion || undefined);
		const described = await describeExtension(options.extensionId, registry, true);
		const versions = Array.isArray(described.versions) ? described.versions : [];
		const compatible = versions.find((version) =>
			hostVersion ? versionSatisfies(hostVersion, version.host_version) : true,
		);
		if (!compatible) {
			throw Object.assign(new Error('No marketplace version is compatible with this Directus host'), {
				status: 400,
			});
		}

		const fromVersion = schemaVersion(current);
		if (compareSemver(compatible.version, fromVersion) <= 0) {
			throw Object.assign(new Error('This extension is already up to date'), { status: 400 });
		}

		const previousVersionId = String(current.meta.folder);
		const wasEnabled = Boolean(current.meta.enabled);
		const selfUpdate = isSelf(current);

		try {
			await options.extensionsService.uninstall(options.extensionId);
			await options.extensionsService.install(options.extensionId, compatible.id);
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
			to_version: compatible.version,
			reload_required: true,
			self_update: selfUpdate,
		};
	} finally {
		applying = false;
	}
}
