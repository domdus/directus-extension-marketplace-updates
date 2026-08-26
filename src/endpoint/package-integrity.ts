import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

type ExtensionManifest = {
	'directus:extension'?: {
		type?: string;
		path?: string | { app?: string; api?: string };
	};
};

const integrityCache = new Map<string, { expiresAt: number; ok: true } | { expiresAt: number; ok: false; message: string }>();
const TTL_MS = 30 * 60 * 1000;

function stripNul(value: string): string {
	return value.replace(/\0.*$/s, '').trim();
}

/** List and read members from a gzipped ustar/npm pack tarball. */
function readTarGz(buffer: Buffer): Map<string, Buffer> {
	const data = gunzipSync(buffer);
	const files = new Map<string, Buffer>();
	let offset = 0;

	while (offset + 512 <= data.length) {
		const header = data.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;

		const name = stripNul(header.subarray(0, 100).toString('utf8'));
		const prefix = stripNul(header.subarray(345, 500).toString('utf8'));
		const size = Number.parseInt(stripNul(header.subarray(124, 136).toString('utf8')), 8) || 0;
		const typeFlag = String.fromCharCode(header[156] || 0);
		const fullName = prefix ? `${prefix}/${name}` : name;
		offset += 512;

		const content = data.subarray(offset, offset + size);
		offset += Math.ceil(size / 512) * 512;

		if (!fullName || typeFlag === '5') continue; // skip directories
		files.set(fullName.replace(/^\.\//, ''), Buffer.from(content));
	}

	return files;
}

function normalizePackPath(filePath: string): string {
	return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function entryPathsFromManifest(manifest: ExtensionManifest): string[] {
	const ext = manifest['directus:extension'];
	if (!ext?.path) return [];

	if (typeof ext.path === 'string') {
		return [normalizePackPath(ext.path)];
	}

	const paths: string[] = [];
	if (ext.path.app) paths.push(normalizePackPath(ext.path.app));
	if (ext.path.api) paths.push(normalizePackPath(ext.path.api));
	return paths;
}

function findPackFile(files: Map<string, Buffer>, relativePath: string): Buffer | null {
	const wanted = normalizePackPath(relativePath);
	const candidates = [`package/${wanted}`, wanted];
	for (const key of files.keys()) {
		const normalized = normalizePackPath(key);
		if (candidates.includes(normalized) || normalized.endsWith(`/${wanted}`)) {
			return files.get(key) || null;
		}
	}
	return null;
}

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

export function resolveExtensionsPath(env: Record<string, unknown> | undefined): string {
	const raw = env?.EXTENSIONS_PATH;
	if (typeof raw === 'string' && raw.trim()) {
		return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
	}
	return path.resolve(process.cwd(), 'extensions');
}

export function inspectInstalledPackage(
	env: Record<string, unknown> | undefined,
	versionId: string,
): { name: string | null; missing: string[]; error?: string } {
	const root = path.join(resolveExtensionsPath(env), '.registry', versionId);
	const packageJsonPath = path.join(root, 'package.json');
	if (!fs.existsSync(packageJsonPath)) {
		return { name: null, missing: ['package.json'], error: 'missing package.json' };
	}

	let manifest: ExtensionManifest & { name?: string };
	try {
		manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as ExtensionManifest & { name?: string };
	} catch {
		return { name: null, missing: ['package.json'], error: 'invalid package.json' };
	}

	const entries = entryPathsFromManifest(manifest);
	const missing = entries.filter((entry) => !fs.existsSync(path.join(root, entry)));
	return { name: manifest.name ? String(manifest.name) : null, missing };
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

export function invalidateIntegrityCache(): void {
	integrityCache.clear();
}
