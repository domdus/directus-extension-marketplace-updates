import type { ApiOutput } from '@directus/types';
import { EXTENSION_MARKETPLACE_UID, EXTENSION_PACKAGE_NAME } from '../shared/extension-meta';
import { normalizeVersion } from '../shared/semver';
import type { ExtensionVersionListResponse, ExtensionVersionOption } from '../shared/types';
import { assertMarketplacePackageIntegrity, inspectInstalledPackage } from './package-integrity';
import { describeExtension, resolveRegistryBase } from './registry';

type ExtensionsServiceLike = {
	readOne: (id: string) => Promise<ApiOutput>;
};

function schemaName(entry: ApiOutput): string {
	const schema = entry.schema as { name?: string } | null;
	return schema?.name ? String(schema.name) : entry.id;
}

function schemaVersion(entry: ApiOutput): string {
	const schema = entry.schema as { version?: string } | null;
	return schema?.version ? normalizeVersion(schema.version) : 'unknown';
}

export async function listExtensionVersions(options: {
	extensionsService: ExtensionsServiceLike;
	env: Record<string, unknown>;
	extensionId: string;
}): Promise<ExtensionVersionListResponse> {
	const current = await options.extensionsService.readOne(options.extensionId);
	if (current.meta?.source !== 'registry') {
		throw Object.assign(new Error('Only Marketplace (registry) extensions are supported'), {
			status: 400,
		});
	}
	if (current.bundle != null || current.meta?.bundle != null) {
		throw Object.assign(new Error('Bundle entries cannot be managed separately'), { status: 400 });
	}

	const registry = resolveRegistryBase(options.env);
	const described = await describeExtension(options.extensionId, registry, true);
	const versions = Array.isArray(described.versions) ? described.versions : [];
	const currentVersionId = String(current.meta?.folder || '');
	const disk = inspectInstalledPackage(options.env, currentVersionId);
	const filesMissing = Boolean(disk.error) || disk.missing.length > 0;
	let currentVersion = schemaVersion(current);
	const installedRelease = versions.find((version) => version.id === currentVersionId);
	if (installedRelease?.version) currentVersion = installedRelease.version;

	const optionsOut: ExtensionVersionOption[] = [];
	for (const version of versions) {
		const option: ExtensionVersionOption = {
			id: version.id,
			version: version.version,
			host_version: version.host_version || null,
			publish_date: version.publish_date || null,
			is_current: version.id === currentVersionId,
			installable: false,
		};

		if (option.is_current && !filesMissing) {
			option.installable = false;
			optionsOut.push(option);
			continue;
		}

		try {
			await assertMarketplacePackageIntegrity(registry, version.id);
			option.installable = true;
		} catch (error: any) {
			option.installable = false;
			option.error = error?.message || 'Package failed integrity check';
		}

		optionsOut.push(option);
	}

	return {
		id: options.extensionId,
		name: described.name || schemaName(current),
		current_version: currentVersion,
		current_version_id: currentVersionId,
		versions: optionsOut,
	};
}
