import fs from 'node:fs';
import {
	entryPathsFromManifest,
	findPackFile,
	readTarGz,
	type ExtensionManifest,
} from './archive';
import { inspectPackageDir, localPackageDir, registryPackageDir } from './fs-local';

const integrityCache = new Map<string, { expiresAt: number; ok: true } | { expiresAt: number; ok: false; message: string }>();
const TTL_MS = 30 * 60 * 1000;

export { resolveExtensionsPath } from './fs-local';

export async function assertMarketplacePackageIntegrity(
	registry: string,
	versionId: string,
	options?: { force?: boolean },
): Promise<void> {
	const cacheKey = `${registry}:${versionId}`;
	if (!options?.force) {
		const cached = integrityCache.get(cacheKey);
		if (cached && Date.now() < cached.expiresAt) {
			if (cached.ok) return;
			throw Object.assign(new Error(cached.message), { status: 400 });
		}
	}

	const url = `${registry.replace(/\/+$/, '')}/download/${encodeURIComponent(versionId)}`;
	let response: Response;
	try {
		response = await fetch(url, { method: 'GET', headers: { Accept: 'application/octet-stream,*/*' } });
	} catch (error: any) {
		const message = `Could not download Marketplace package for integrity check (${error?.message || 'network error'})`;
		integrityCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, ok: false, message });
		throw Object.assign(new Error(message), { status: 502 });
	}

	if (!response.ok) {
		const message = `Marketplace package download failed (${response.status})`;
		integrityCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, ok: false, message });
		throw Object.assign(new Error(message), { status: 502 });
	}

	const buffer = Buffer.from(await response.arrayBuffer());
	let files: Map<string, Buffer>;
	try {
		files = readTarGz(buffer);
	} catch (error: any) {
		const message = `Marketplace package is not a readable tarball (${error?.message || 'parse error'})`;
		integrityCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, ok: false, message });
		throw Object.assign(new Error(message), { status: 400 });
	}

	const packageJsonBuf = findPackFile(files, 'package.json');
	if (!packageJsonBuf) {
		const message = 'Marketplace package is missing package.json';
		integrityCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, ok: false, message });
		throw Object.assign(new Error(message), { status: 400 });
	}

	let manifest: ExtensionManifest;
	try {
		manifest = JSON.parse(packageJsonBuf.toString('utf8')) as ExtensionManifest;
	} catch {
		const message = 'Marketplace package has invalid package.json';
		integrityCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, ok: false, message });
		throw Object.assign(new Error(message), { status: 400 });
	}

	const entries = entryPathsFromManifest(manifest);
	if (!entries.length) {
		const message = 'Marketplace package.json has no directus:extension.path entrypoints';
		integrityCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, ok: false, message });
		throw Object.assign(new Error(message), { status: 400 });
	}

	const missing = entries.filter((entry) => !findPackFile(files, entry));
	if (missing.length) {
		const message = `Marketplace package is corrupt/incomplete — missing ${missing.join(', ')}. Refusing update (publisher must ship a built dist).`;
		integrityCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, ok: false, message });
		throw Object.assign(new Error(message), { status: 400 });
	}

	integrityCache.set(cacheKey, { expiresAt: Date.now() + TTL_MS, ok: true });
}

export function inspectInstalledPackage(
	env: Record<string, unknown> | undefined,
	versionId: string,
): { name: string | null; missing: string[]; error?: string } {
	const inspected = inspectPackageDir(registryPackageDir(env, versionId));
	return { name: inspected.name, missing: inspected.missing, error: inspected.error };
}

export function inspectLocalPackage(
	env: Record<string, unknown> | undefined,
	folder: string,
): { name: string | null; version: string | null; type: string | null; host: string | null; missing: string[]; error?: string } {
	return inspectPackageDir(localPackageDir(env, folder));
}

/** After Directus install — confirm entry files landed under .registry/<versionId>. */
export function assertInstalledPackageOnDisk(
	env: Record<string, unknown> | undefined,
	versionId: string,
): void {
	const inspected = inspectInstalledPackage(env, versionId);
	if (inspected.error === 'missing package.json') {
		throw Object.assign(
			new Error(`Installed Marketplace package is missing package.json under .registry/${versionId}`),
			{ status: 500 },
		);
	}
	if (inspected.error === 'invalid package.json') {
		throw Object.assign(new Error(`Installed Marketplace package.json is invalid (.registry/${versionId})`), {
			status: 500,
		});
	}
	if (inspected.missing.length) {
		throw Object.assign(
			new Error(
				`Installed Marketplace package is corrupt/incomplete under .registry/${versionId} — missing ${inspected.missing.join(', ')}`,
			),
			{ status: 500 },
		);
	}
}

export function assertLocalPackageOnDisk(env: Record<string, unknown> | undefined, folder: string): void {
	const inspected = inspectLocalPackage(env, folder);
	if (inspected.error === 'missing package.json') {
		throw Object.assign(new Error(`Installed local package is missing package.json under ${folder}`), { status: 500 });
	}
	if (inspected.error === 'invalid package.json') {
		throw Object.assign(new Error(`Installed local package.json is invalid (${folder})`), { status: 500 });
	}
	if (inspected.missing.length) {
		throw Object.assign(
			new Error(`Installed local package is corrupt/incomplete under ${folder} — missing ${inspected.missing.join(', ')}`),
			{ status: 500 },
		);
	}
}

export function invalidateIntegrityCache(): void {
	integrityCache.clear();
}
