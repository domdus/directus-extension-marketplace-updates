import type { ExtensionUpdateItem } from './types';

export type VersionLocks = Record<string, string>;

/** Hidden `directus_settings` JSON field, created the first time a version is locked. */
export const VERSION_LOCKS_FIELD = 'extension_update_locks';

export function parseVersionLocks(value: unknown): VersionLocks {
	let parsed = value;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return {};
		}
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
	return Object.fromEntries(
		Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
	);
}

export function setVersionLock(locks: VersionLocks, extensionId: string, version: string | null): VersionLocks {
	const next = Object.fromEntries(Object.entries(locks).filter(([id]) => id !== extensionId));
	return version ? { ...next, [extensionId]: version } : next;
}

/** A lock holds only while its version stays installed, so choosing another version releases it. */
export function applyVersionLocks(items: ExtensionUpdateItem[], locks: VersionLocks): ExtensionUpdateItem[] {
	return items.map((item) =>
		locks[item.id] === item.current_version ? { ...item, has_update: false, version_locked: true } : item,
	);
}
