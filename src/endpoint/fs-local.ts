import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ExtensionManifest } from './archive';
import { entryPathsFromManifest } from './archive';

export function resolveExtensionsPath(env: Record<string, unknown> | undefined): string {
	const raw = env?.EXTENSIONS_PATH;
	if (typeof raw === 'string' && raw.trim()) {
		return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
	}
	return path.resolve(process.cwd(), 'extensions');
}

export function registryPackageDir(env: Record<string, unknown> | undefined, versionId: string): string {
	return path.join(resolveExtensionsPath(env), '.registry', versionId);
}

export function localPackageDir(env: Record<string, unknown> | undefined, folder: string): string {
	return path.join(resolveExtensionsPath(env), folder);
}

export function folderFromPackageName(name: string): string {
	const cleaned = String(name || '')
		.trim()
		.replace(/^@/, '')
		.replace(/\//g, '-')
		.replace(/[^a-zA-Z0-9._-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80);
	if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned === '.registry') {
		throw Object.assign(new Error('Could not derive a safe folder name from package.json name'), { status: 400 });
	}
	return cleaned;
}

export function assertSafeFolderName(folder: string): string {
	const name = String(folder || '').trim();
	if (!name || name !== path.basename(name) || name.startsWith('.') || name === 'node_modules') {
		throw Object.assign(new Error('Invalid extension folder name'), { status: 400 });
	}
	if (name.includes('..') || name.includes('/') || name.includes('\\')) {
		throw Object.assign(new Error('Invalid extension folder name'), { status: 400 });
	}
	return name;
}

export function isPathInside(root: string, target: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(target));
	return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export type InspectedPackage = {
	name: string | null;
	version: string | null;
	type: string | null;
	host: string | null;
	missing: string[];
	error?: string;
};

export function inspectPackageDir(root: string): InspectedPackage {
	const packageJsonPath = path.join(root, 'package.json');
	if (!fs.existsSync(packageJsonPath)) {
		return { name: null, version: null, type: null, host: null, missing: ['package.json'], error: 'missing package.json' };
	}

	let manifest: ExtensionManifest;
	try {
		manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as ExtensionManifest;
	} catch {
		return { name: null, version: null, type: null, host: null, missing: ['package.json'], error: 'invalid package.json' };
	}

	const entries = entryPathsFromManifest(manifest);
	const missing = entries.filter((entry) => !fs.existsSync(path.join(root, entry)));
	return {
		name: manifest.name ? String(manifest.name) : null,
		version: manifest.version ? String(manifest.version) : null,
		type: manifest['directus:extension']?.type ? String(manifest['directus:extension']?.type) : null,
		host: manifest['directus:extension']?.host ? String(manifest['directus:extension']?.host) : null,
		missing,
	};
}

export function moveDir(src: string, dest: string): void {
	try {
		fs.renameSync(src, dest);
	} catch (error: any) {
		if (error?.code !== 'EXDEV') throw error;
		fs.cpSync(src, dest, { recursive: true });
		fs.rmSync(src, { recursive: true, force: true });
	}
}

export function atomicWritePackage(destDir: string, files: Map<string, Buffer>): void {
	const destParent = path.dirname(destDir);
	fs.mkdirSync(destParent, { recursive: true });

	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'directus-eu-'));
	const bak = path.join(os.tmpdir(), `directus-eu-bak-${crypto.randomBytes(6).toString('hex')}`);
	const destExisted = fs.existsSync(destDir);

	try {
		for (const [rel, buf] of files) {
			if (!rel || path.isAbsolute(rel) || path.normalize(rel).split(path.sep).includes('..')) {
				throw Object.assign(new Error(`Illegal path in package: ${rel}`), { status: 400 });
			}
			const target = path.join(tmp, rel);
			if (!isPathInside(tmp, target)) {
				throw Object.assign(new Error(`Illegal path in package: ${rel}`), { status: 400 });
			}
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, buf);
		}

		if (destExisted) moveDir(destDir, bak);
		try {
			moveDir(tmp, destDir);
		} catch (error) {
			if (destExisted && !fs.existsSync(destDir) && fs.existsSync(bak)) {
				moveDir(bak, destDir);
			}
			throw error;
		}
		if (destExisted) fs.rmSync(bak, { recursive: true, force: true });
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

export function backupDir(src: string): string {
	const dest = path.join(os.tmpdir(), `directus-eu-swap-${crypto.randomBytes(6).toString('hex')}`);
	moveDir(src, dest);
	return dest;
}
