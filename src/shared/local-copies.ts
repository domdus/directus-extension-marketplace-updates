import type { ExtensionUpdateItem } from './types';

function isSameExtension(registryItem: ExtensionUpdateItem, localItem: ExtensionUpdateItem): boolean {
	return localItem.marketplace_id === registryItem.id || localItem.name === registryItem.name;
}

function isRunnable(item: ExtensionUpdateItem): boolean {
	return item.enabled && !item.files_missing && !item.installed_blocked_reason;
}

/**
 * Relates each Marketplace install to a local copy of the same extension:
 * - disabled while a local copy runs: replaced, so it no longer counts as an update
 * - enabled alongside a local copy: flagged, because Directus loads both
 */
export function markLocalCopies(
	registryItems: ExtensionUpdateItem[],
	localItems: ExtensionUpdateItem[],
): ExtensionUpdateItem[] {
	return registryItems.map((item) => {
		const running = localItems.find((local) => isRunnable(local) && isSameExtension(item, local));
		if (!running) return item;
		if (item.enabled) return { ...item, duplicate_local_version: running.current_version };
		return { ...item, has_update: false, replaced_by_local_version: running.current_version };
	});
}
