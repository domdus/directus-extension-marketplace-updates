import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REGISTRY } from '../shared/extension-meta';
import { normalizeVersion } from '../shared/semver';
import type { RegistryDescribe, RegistryVersion } from '../shared/types';

const describeCache = new Map<string, { expiresAt: number; data: RegistryDescribe }>();
const TTL_MS = 30 * 60 * 1000;

export function resolveRegistryBase(env: Record<string, unknown> | undefined): string {
	const raw = env?.MARKETPLACE_REGISTRY;
	if (typeof raw === 'string' && raw.trim()) return raw.trim().replace(/\/+$/, '');
	return DEFAULT_REGISTRY;
}

/** Product releases are 9–12 today; @directus/api uses a separate 30+ line. */
function isDirectusProductVersion(version: string): boolean {
	const major = parseInt(normalizeVersion(version).split('.')[0] || '', 10);
	return Number.isFinite(major) && major >= 9 && major < 20;
}

function versionFromPackage(pkg: { name?: string; version?: string } | null | undefined): string | null {
	if (!pkg?.version) return null;
	if (pkg.name && pkg.name !== 'directus') return null;
	if (!isDirectusProductVersion(pkg.version)) return null;
	return normalizeVersion(pkg.version);
}

export function readHostVersion(env: Record<string, unknown> | undefined, fallback?: string): string | null {
	const envVersion = env?.DIRECTUS_VERSION;
	if (typeof envVersion === 'string' && isDirectusProductVersion(envVersion)) {
		return normalizeVersion(envVersion);
	}

	if (fallback && isDirectusProductVersion(fallback)) {
		return normalizeVersion(fallback);
	}

	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
			name?: string;
			version?: string;
		};
		const fromCwd = versionFromPackage(pkg);
		if (fromCwd) return fromCwd;
	} catch {
		// not running from the Directus package root
	}

	const requireFrom = [path.join(process.cwd(), 'package.json')];
	try {
		requireFrom.push(fileURLToPath(import.meta.url));
	} catch {
		// bundled environment without import.meta.url
	}

	for (const source of requireFrom) {
		try {
			const requireFn = createRequire(source);
			const fromDirectus = versionFromPackage(requireFn('directus/package.json'));
			if (fromDirectus) return fromDirectus;
		} catch {
			// try next resolver
		}
	}

	return fallback ? normalizeVersion(fallback) : null;
}

export async function describeExtension(
	extensionId: string,
	registry: string,
	force = false,
): Promise<RegistryDescribe> {
	const cacheKey = `${registry}:${extensionId}`;
	if (!force) {
		const cached = describeCache.get(cacheKey);
		if (cached && Date.now() < cached.expiresAt) return cached.data;
	}

	const url = `${registry.replace(/\/+$/, '')}/extensions/${encodeURIComponent(extensionId)}`;
	const response = await fetch(url, {
		method: 'GET',
		headers: { Accept: 'application/json' },
	});
	if (!response.ok) {
		throw new Error(`Marketplace registry request failed (${response.status})`);
	}

	const payload = (await response.json()) as { data?: Partial<RegistryDescribe> };
	const data = payload?.data;
	if (!data?.id || !Array.isArray(data.versions)) {
		throw new Error('Unexpected marketplace registry response');
	}

	const described: RegistryDescribe = {
		id: String(data.id),
		name: String(data.name || extensionId),
		description: data.description ?? null,
		type: data.type,
		versions: data.versions.map((version) => ({
			id: String((version as RegistryVersion).id),
			version: normalizeVersion(String((version as RegistryVersion).version || '')),
			host_version: String((version as RegistryVersion).host_version || ''),
			type: (version as RegistryVersion).type,
			publish_date: (version as RegistryVersion).publish_date,
		})),
	};

	describeCache.set(cacheKey, { data: described, expiresAt: Date.now() + TTL_MS });
	return described;
}
