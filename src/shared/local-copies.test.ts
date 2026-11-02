import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markLocalCopies } from './local-copies';
import type { ExtensionUpdateItem } from './types';

function item(overrides: Partial<ExtensionUpdateItem>): ExtensionUpdateItem {
	return {
		id: 'marketplace-id',
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

const local = (overrides: Partial<ExtensionUpdateItem> = {}) =>
	item({ id: 'local-id', source: 'local', current_version: '1.0.4', has_update: false, ...overrides });

test('a disabled Marketplace copy is replaced by a running local copy', () => {
	const [result] = markLocalCopies([item({ enabled: false })], [local()]);
	assert.equal(result?.has_update, false);
	assert.equal(result?.replaced_by_local_version, '1.0.4');
});

test('a local copy matches by Marketplace id when the names differ', () => {
	const [result] = markLocalCopies(
		[item({ enabled: false, name: 'Display name' })],
		[local({ marketplace_id: 'marketplace-id' })],
	);
	assert.equal(result?.replaced_by_local_version, '1.0.4');
});

test('an enabled Marketplace copy keeps its update and is flagged as a duplicate', () => {
	const [result] = markLocalCopies([item({})], [local()]);
	assert.equal(result?.has_update, true);
	assert.equal(result?.duplicate_local_version, '1.0.4');
	assert.equal(result?.replaced_by_local_version, undefined);
});

test('a disabled local copy replaces nothing', () => {
	const [result] = markLocalCopies([item({ enabled: false })], [local({ enabled: false })]);
	assert.equal(result?.has_update, true);
	assert.equal(result?.replaced_by_local_version, undefined);
});

test('a broken local copy replaces nothing', () => {
	const [result] = markLocalCopies(
		[item({ enabled: false })],
		[local({ installed_blocked_reason: 'Installed package is missing dist/api.js' })],
	);
	assert.equal(result?.has_update, true);
	assert.equal(result?.replaced_by_local_version, undefined);
});

test('an unrelated local extension changes nothing', () => {
	const [result] = markLocalCopies([item({ enabled: false })], [local({ name: 'directus-extension-other' })]);
	assert.equal(result?.has_update, true);
	assert.equal(result?.replaced_by_local_version, undefined);
});
