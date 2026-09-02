import { gunzipSync, inflateRawSync } from 'node:zlib';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2_000;

export type ExtensionManifest = {
	name?: string;
	version?: string;
	files?: string[];
	'directus:extension'?: {
		type?: string;
		host?: string;
		path?: string | { app?: string; api?: string };
	};
};

export type ArchiveFiles = Map<string, Buffer>;

export function normalizePackPath(filePath: string): string {
	return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function entryPathsFromManifest(manifest: ExtensionManifest): string[] {
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

function stripNul(value: string): string {
	return value.replace(/\0.*$/s, '').trim();
}

/** List and read members from a gzipped ustar/npm pack tarball. */
export function readTarGz(buffer: Buffer): ArchiveFiles {
	const data = gunzipSync(buffer);
	const files: ArchiveFiles = new Map();
	let offset = 0;
	let uncompressed = 0;

	while (offset + 512 <= data.length) {
		const header = data.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;

		const name = stripNul(header.subarray(0, 100).toString('utf8'));
		const prefix = stripNul(header.subarray(345, 500).toString('utf8'));
		const size = Number.parseInt(stripNul(header.subarray(124, 136).toString('utf8')), 8) || 0;
		const typeFlag = String.fromCharCode(header[156] || 0);
		const fullName = prefix ? `${prefix}/${name}` : name;
		offset += 512;

		uncompressed += size;
		if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
			throw new Error('Archive is too large once unpacked');
		}
		if (files.size >= MAX_ARCHIVE_ENTRIES) {
			throw new Error('Archive has too many files');
		}

		const content = data.subarray(offset, offset + size);
		offset += Math.ceil(size / 512) * 512;

		if (!fullName || typeFlag === '5') continue;
		files.set(normalizePackPath(fullName.replace(/^\.\//, '')), Buffer.from(content));
	}

	return files;
}

function findEocdOffset(buffer: Buffer): number {
	const min = Math.max(0, buffer.length - 65_557);
	for (let i = buffer.length - 22; i >= min; i--) {
		if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b && buffer[i + 2] === 0x05 && buffer[i + 3] === 0x06) {
			return i;
		}
	}
	throw new Error('Not a zip file (missing end of central directory)');
}

function readU16(buffer: Buffer, offset: number): number {
	return buffer.readUInt16LE(offset);
}

function readU32(buffer: Buffer, offset: number): number {
	return buffer.readUInt32LE(offset);
}

/** Read a zip (store or deflate). ZIP64 and encrypted archives are rejected. */
export function readZip(buffer: Buffer): ArchiveFiles {
	const eocd = findEocdOffset(buffer);
	const totalEntries = readU16(buffer, eocd + 10);
	const cdSize = readU32(buffer, eocd + 12);
	const cdOffset = readU32(buffer, eocd + 16);

	if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
		throw new Error('ZIP64 archives are not supported');
	}
	if (totalEntries > MAX_ARCHIVE_ENTRIES) {
		throw new Error('Archive has too many files');
	}

	const files: ArchiveFiles = new Map();
	let cursor = cdOffset;
	let uncompressedTotal = 0;
	const cdEnd = cdOffset + cdSize;

	for (let i = 0; i < totalEntries; i++) {
		if (cursor + 46 > buffer.length || cursor + 46 > cdEnd + 46) {
			throw new Error('Zip central directory is truncated');
		}
		if (readU32(buffer, cursor) !== 0x02014b50) {
			throw new Error('Zip central directory is invalid');
		}

		const flags = readU16(buffer, cursor + 8);
		const method = readU16(buffer, cursor + 10);
		const compressedSize = readU32(buffer, cursor + 20);
		const uncompressedSize = readU32(buffer, cursor + 24);
		const nameLen = readU16(buffer, cursor + 28);
		const extraLen = readU16(buffer, cursor + 30);
		const commentLen = readU16(buffer, cursor + 32);
		const localOffset = readU32(buffer, cursor + 42);
		const name = buffer.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
		cursor += 46 + nameLen + extraLen + commentLen;

		if (flags & 0x0001) {
			throw new Error('Encrypted zip entries are not supported');
		}
		if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
			throw new Error('ZIP64 archives are not supported');
		}

		const rel = normalizePackPath(name);
		if (!rel || rel.endsWith('/')) continue;

		uncompressedTotal += uncompressedSize;
		if (uncompressedTotal > MAX_UNCOMPRESSED_BYTES) {
			throw new Error('Archive is too large once unpacked');
		}

		if (localOffset + 30 > buffer.length) {
			throw new Error('Zip local header is truncated');
		}
		if (readU32(buffer, localOffset) !== 0x04034b50) {
			throw new Error('Zip local header is invalid');
		}
		const localNameLen = readU16(buffer, localOffset + 26);
		const localExtraLen = readU16(buffer, localOffset + 28);
		const dataStart = localOffset + 30 + localNameLen + localExtraLen;
		const dataEnd = dataStart + compressedSize;
		if (dataEnd > buffer.length) {
			throw new Error('Zip entry data is truncated');
		}

		const compressed = buffer.subarray(dataStart, dataEnd);
		let content: Buffer;
		if (method === 0) {
			content = Buffer.from(compressed);
		} else if (method === 8) {
			content = inflateRawSync(compressed);
		} else {
			throw new Error(`Unsupported zip compression method (${method})`);
		}

		if (uncompressedSize && content.length !== uncompressedSize) {
			throw new Error(`Zip entry ${rel} has an unexpected size`);
		}
		files.set(rel, content);
	}

	return files;
}

export function detectArchiveKind(buffer: Buffer, filename = ''): 'zip' | 'tgz' {
	if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return 'tgz';
	if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return 'zip';
	const lower = filename.toLowerCase();
	if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz')) return 'tgz';
	if (lower.endsWith('.zip')) return 'zip';
	throw new Error('Upload must be a .zip or npm .tgz package');
}

export function readArchive(buffer: Buffer, filename = ''): ArchiveFiles {
	const kind = detectArchiveKind(buffer, filename);
	return kind === 'zip' ? readZip(buffer) : readTarGz(buffer);
}

export function findPackFile(files: ArchiveFiles, relativePath: string): Buffer | null {
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

export function locateExtensionRoot(files: ArchiveFiles): { prefix: string; manifest: ExtensionManifest } {
	const jsonPaths = [...files.keys()]
		.map((key) => normalizePackPath(key))
		.filter((key) => key === 'package.json' || key.endsWith('/package.json'))
		.filter((key) => !key.split('/').includes('node_modules'));

	jsonPaths.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);

	for (const jsonPath of jsonPaths) {
		const buf = files.get(jsonPath) || findPackFile(files, jsonPath);
		if (!buf) continue;
		try {
			const manifest = JSON.parse(buf.toString('utf8')) as ExtensionManifest;
			if (!manifest['directus:extension']) continue;
			const dir = jsonPath === 'package.json' ? '' : jsonPath.slice(0, -'package.json'.length);
			return { prefix: dir, manifest };
		} catch {
			// try next package.json
		}
	}

	throw Object.assign(new Error('No Directus extension package.json found (missing directus:extension)'), {
		status: 400,
	});
}

const ROOT_META = /^(readme(\.(md|txt))?|license(\.(md|txt))?)$/i;

/** package.json + declared entry dirs (usually dist/) + license/readme. */
export function selectInstallFiles(files: ArchiveFiles, prefix: string, manifest: ExtensionManifest): ArchiveFiles {
	const entries = entryPathsFromManifest(manifest);
	if (!entries.length) {
		throw Object.assign(new Error('package.json has no directus:extension.path entrypoints'), { status: 400 });
	}

	const out: ArchiveFiles = new Map();
	const packageJson = files.get(`${prefix}package.json`) || findPackFile(files, 'package.json');
	if (!packageJson) {
		throw Object.assign(new Error('Archive is missing package.json'), { status: 400 });
	}
	out.set('package.json', packageJson);

	const tops = new Set(entries.map((entry) => entry.split('/')[0]!).filter(Boolean));

	for (const [key, buf] of files) {
		const normalized = normalizePackPath(key);
		if (!normalized.startsWith(prefix)) continue;
		const rel = normalized.slice(prefix.length);
		if (!rel || rel === 'package.json') continue;
		if (rel.split('/').includes('node_modules') || rel.startsWith('.git/')) continue;
		const top = rel.split('/')[0] || '';
		if (tops.has(top) || tops.has(rel) || ROOT_META.test(rel)) {
			out.set(rel, buf);
		}
	}

	const missing = entries.filter((entry) => !out.has(entry) && !findPackFile(out, entry));
	if (missing.length) {
		throw Object.assign(
			new Error(`Package is corrupt/incomplete — missing ${missing.join(', ')}. Refusing install (publisher must ship a built dist).`),
			{ status: 400 },
		);
	}

	return out;
}

export function parseExtensionArchive(buffer: Buffer, filename = ''): {
	files: ArchiveFiles;
	manifest: ExtensionManifest;
} {
	const archive = readArchive(buffer, filename);
	const { prefix, manifest } = locateExtensionRoot(archive);
	return { files: selectInstallFiles(archive, prefix, manifest), manifest };
}
