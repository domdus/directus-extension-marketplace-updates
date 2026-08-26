export type RegistryVersion = {
	id: string;
	version: string;
	host_version: string;
	type?: string;
	publish_date?: string;
};

export type RegistryDescribe = {
	id: string;
	name: string;
	description?: string | null;
	type?: string;
	versions: RegistryVersion[];
};

export type ExtensionUpdateItem = {
	id: string;
	name: string;
	type: string | null;
	enabled: boolean;
	current_version: string;
	current_version_id: string;
	latest_version: string | null;
	latest_version_id: string | null;
	host_version: string | null;
	has_update: boolean;
	/** Declared Marketplace host range does not match this Directus — advisory only. */
	host_mismatch: boolean;
	is_self: boolean;
	marketplace_path: string;
	/** Real failures (lookup/read). Not used when only the newest Marketplace release is corrupt. */
	error?: string;
	/**
	 * Newest Marketplace release exists but failed integrity (e.g. missing dist).
	 * Installed version can still be fine — UI should stay "Up to date", not Error.
	 */
	latest_blocked_reason?: string;
	/**
	 * Installed .registry folder is missing declared entry files (e.g. dist/index.js).
	 * Directus cannot bundle App extensions until this package is disabled or replaced.
	 */
	installed_blocked_reason?: string;
	/** DB row exists but `.registry/<folder>/package.json` is gone (interrupted install). */
	files_missing?: boolean;
};

export type UpdateCheckResponse = {
	host_version: string | null;
	checked_at: string;
	update_count: number;
	host_mismatch_count: number;
	corrupt_count: number;
	corrupt_names: string[];
	items: ExtensionUpdateItem[];
};

export type UpdateApplyResponse = {
	id: string;
	name: string;
	from_version: string;
	to_version: string;
	reload_required: boolean;
	self_update: boolean;
	/** `started` = HTTP returned before native uninstall/install finished. */
	status?: 'started' | 'complete';
};

export type ExtensionVersionOption = {
	id: string;
	version: string;
	host_version: string | null;
	publish_date: string | null;
	is_current: boolean;
	installable: boolean;
	error?: string;
};

export type ExtensionVersionListResponse = {
	id: string;
	name: string;
	current_version: string;
	current_version_id: string;
	versions: ExtensionVersionOption[];
};
