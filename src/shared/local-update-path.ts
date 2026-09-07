import type { ExtensionUpdateItem } from './types';

/** Local install listed under Extension Updates only when Marketplace can act on it. */
export function localHasUpdatePath(item: ExtensionUpdateItem): boolean {
	if (item.source !== 'local') return false;
	if (!item.marketplace_id) return false;
	if (item.has_update) return true;
	if (item.files_missing) return true;
	if (item.installed_blocked_reason) return true;
	if (item.latest_blocked_reason) return true;
	if (item.error) return true;
	return false;
}
