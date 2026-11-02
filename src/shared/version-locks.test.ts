import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localHasUpdatePath } from './local-update-path';
import { applyVersionLocks, parseVersionLocks, setVersionLock } from './version-locks';
import type { ExtensionUpdateItem } from './types';

function item(overrides: Partial<ExtensionUpdateItem> = {}): ExtensionUpdateItem {
	return {
		id: 'extension-id',
		source: 'registry',
		name: 'directus-extension-example',
		type: 'bundle',
		enabled: true,
		current_version: '1.0.2',
		current_version_id: 'version-id',
		folder: 'version-id',
		latest_version: '1.0.3',
		latest_version_id: 'latest-id',
		host_version: null,
		has_update: true,
		host_mismatch: false,
		is_self: false,
		marketplace_path: '',
		...overrides,
	};
}

test('a lock on the installed version hides the update', () => {
	const [result] = applyVersionLocks([item()], { 'extension-id': '1.0.2' });
	assert.equal(result?.has_update, false);
	assert.equal(result?.version_locked, true);
});

test('a lock on another version no longer applies', () => {
	const [result] = applyVersionLocks([item()], { 'extension-id': '1.0.1' });
	assert.equal(result?.has_update, true);
	assert.equal(result?.version_locked, undefined);
});

test('other extensions keep their updates', () => {
	const [result] = applyVersionLocks([item()], { other: '1.0.2' });
	assert.equal(result?.has_update, true);
});

test('setting and clearing a lock leaves other locks alone', () => {
	const locked = setVersionLock({ other: '2.0.0' }, 'extension-id', '1.0.2');
	assert.deepEqual(locked, { other: '2.0.0', 'extension-id': '1.0.2' });
	assert.deepEqual(setVersionLock(locked, 'extension-id', null), { other: '2.0.0' });
});

test('stored locks parse from JSON text or objects and ignore bad values', () => {
	assert.deepEqual(parseVersionLocks('{"a":"1.0.0"}'), { a: '1.0.0' });
	assert.deepEqual(parseVersionLocks({ a: '1.0.0', b: 2 }), { a: '1.0.0' });
	assert.deepEqual(parseVersionLocks('not json'), {});
	assert.deepEqual(parseVersionLocks(null), {});
	assert.deepEqual(parseVersionLocks([]), {});
});

test('a locked local extension stays listed so it can be unlocked', () => {
	const locked = item({ source: 'local', marketplace_id: 'id', has_update: false, version_locked: true });
	assert.equal(localHasUpdatePath(locked), true);
});
