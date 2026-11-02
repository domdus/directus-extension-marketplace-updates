import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { MAX_UNCOMPRESSED_BYTES, parseExtensionArchive, readArchive } from './archive';
import { assertSafeFolderName, atomicWritePackage } from './fs-local';

function tarEntry(name: string, content: Buffer): Buffer {
	const header = Buffer.alloc(512);
	header.write(name, 0);
	header.write(content.length.toString(8).padStart(11, '0'), 124);
	header[156] = 48;
	header.write('ustar', 257);
	return Buffer.concat([header, content, Buffer.alloc((512 - (content.length % 512)) % 512)]);
}

function zipWithLyingSize(name: string, content: Buffer): Buffer {
	const raw = deflateRawSync(content);
	const nameBytes = Buffer.from(name);
	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(8, 8);
	local.writeUInt32LE(raw.length, 18);
	local.writeUInt16LE(nameBytes.length, 26);
	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(8, 10);
	central.writeUInt32LE(raw.length, 20);
	central.writeUInt16LE(nameBytes.length, 28);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(1, 8);
	end.writeUInt16LE(1, 10);
	end.writeUInt32LE(46 + nameBytes.length, 12);
	end.writeUInt32LE(30 + nameBytes.length + raw.length, 16);
	return Buffer.concat([local, nameBytes, raw, central, nameBytes, end]);
}

const oversized = Buffer.alloc(MAX_UNCOMPRESSED_BYTES + 5 * 1024 * 1024);

test('a gzip bomb is rejected as too large', async () => {
	const bomb = gzipSync(tarEntry('package/huge.bin', oversized));
	await assert.rejects(readArchive(bomb, 'b.tgz'), (error: any) => error.status === 413);
});

test('a zip bomb that declares size 0 is rejected', async () => {
	const bomb = zipWithLyingSize('package/a.bin', oversized);
	await assert.rejects(readArchive(bomb, 'b.zip'), (error: any) => error.status === 413);
});

test('a valid npm tarball parses to its install files', async () => {
	const manifest = {
		name: 'directus-extension-x',
		version: '1.0.0',
		'directus:extension': { type: 'hook', path: 'dist/index.js' },
	};
	const archive = gzipSync(
		Buffer.concat([
			tarEntry('package/package.json', Buffer.from(JSON.stringify(manifest))),
			tarEntry('package/dist/index.js', Buffer.from('export default () => {}')),
			tarEntry('package/src/secret.ts', Buffer.from('skip me')),
			Buffer.alloc(1024),
		]),
	);
	const { files } = await parseExtensionArchive(archive, 'x.tgz');
	assert.deepEqual([...files.keys()].sort(), ['dist/index.js', 'package.json']);
});

test('package writes refuse paths that leave the folder', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
	try {
		const dest = path.join(root, 'ext');
		assert.throws(() => atomicWritePackage(dest, new Map([['../evil.js', Buffer.from('x')]])), /Illegal path/);
		assert.equal(fs.existsSync(path.join(root, 'evil.js')), false);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('folder names cannot traverse', () => {
	for (const name of ['..', '../x', '.registry', 'a/b', 'node_modules']) {
		assert.throws(() => assertSafeFolderName(name), /Invalid extension folder/);
	}
	assert.equal(assertSafeFolderName('directus-extension-x'), 'directus-extension-x');
});
