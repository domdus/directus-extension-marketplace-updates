import type { ApiOutput } from '@directus/types';
import { normalizeVersion } from '../shared/semver';
import type { ExtensionVersionListResponse, ExtensionVersionOption } from '../shared/types';
import { assertMarketplacePackageIntegrity, inspectInstalledPackage, inspectLocalPackage } from './package-integrity';
import { describeExtension, findMarketplaceByPackageName, resolveRegistryBase } from './registry';

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

async function listMarketplaceVersions(options: {
	registry: string;
	extensionId: string;
	currentVersion: string;
	currentVersionId: string;
	/** Local folder comparing by semver, not a registry UUID. */
	matchCurrentBySemver?: boolean;
	filesMissing: boolean;
}): Promise<ExtensionVersionOption[]> {
	const described = await describeExtension(options.extensionId, options.registry, true);
	const versions = Array.isArray(described.versions) ? described.versions : [];
	const optionsOut: ExtensionVersionOption[] = [];

	for (const version of versions) {
		const isCurrent = options.matchCurrentBySemver
			? version.version === options.currentVersion
			: version.id === options.currentVersionId;
		const option: ExtensionVersionOption = {
			id: version.id,
			version: version.version,
			host_version: version.host_version || null,
			publish_date: version.publish_date || null,
			is_current: isCurrent,
			installable: false,
		};

		if (option.is_current && !options.filesMissing && !options.matchCurrentBySemver) {
			option.installable = false;
			optionsOut.push(option);
			continue;
		}

		try {
			await assertMarketplacePackageIntegrity(options.registry, version.id);
			option.installable = true;
		} catch (error: any) {
			option.installable = false;
			option.error = error?.message || 'Package failed integrity check';
		}

		optionsOut.push(option);
	}

	return optionsOut;
}

async function listLocalMarketplaceVersions(options: {
	extensionsService: ExtensionsServiceLike;
	env: Record<string, unknown>;
	extensionId: string;
}): Promise<ExtensionVersionListResponse> {
	const current = await options.extensionsService.readOne(options.extensionId);
	const folder = String(current.meta?.folder || '');
	const disk = inspectLocalPackage(options.env, folder);
	const name = disk.name || schemaName(current);
	const currentVersion = disk.version ? normalizeVersion(disk.version) : schemaVersion(current);
	const filesMissing = Boolean(disk.error) || disk.missing.length > 0;

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

	const described = await describeExtension(match.id, registry, true);
	const versions = await listMarketplaceVersions({
		registry,
		extensionId: match.id,
		currentVersion,
		currentVersionId: folder,
		matchCurrentBySemver: true,
		filesMissing,
	});

	return {
		id: options.extensionId,
		name: described.name || name,
		source: 'local',
		current_version: currentVersion,
		current_version_id: folder,
		versions,
	};
}

export async function listExtensionVersions(options: {
	extensionsService: ExtensionsServiceLike;
	env: Record<string, unknown>;
	extensionId: string;
}): Promise<ExtensionVersionListResponse> {
	const current = await options.extensionsService.readOne(options.extensionId);

	if (current.meta?.source === 'local') {
		return listLocalMarketplaceVersions(options);
	}
	if (current.meta?.source !== 'registry') {
		throw Object.assign(new Error('Only Marketplace (registry) and local folder extensions are supported'), {
			status: 400,
		});
	}
	if (current.bundle != null || current.meta?.bundle != null) {
		throw Object.assign(new Error('Bundle entries cannot be managed separately'), { status: 400 });
	}

	const registry = resolveRegistryBase(options.env);
	const described = await describeExtension(options.extensionId, registry, true);
	const currentVersionId = String(current.meta?.folder || '');
	const disk = inspectInstalledPackage(options.env, currentVersionId);
	const filesMissing = Boolean(disk.error) || disk.missing.length > 0;
	let currentVersion = schemaVersion(current);
	const installedRelease = (described.versions || []).find((version) => version.id === currentVersionId);
	if (installedRelease?.version) currentVersion = installedRelease.version;

	const versions = await listMarketplaceVersions({
		registry,
		extensionId: options.extensionId,
		currentVersion,
		currentVersionId,
		filesMissing,
	});

	return {
		id: options.extensionId,
		name: described.name || schemaName(current),
		source: 'registry',
		current_version: currentVersion,
		current_version_id: currentVersionId,
		versions,
	};
}
