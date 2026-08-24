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
	latest_compatible_version: string | null;
	latest_compatible_version_id: string | null;
	host_version: string | null;
	has_update: boolean;
	incompatible_update: boolean;
	is_self: boolean;
	marketplace_path: string;
	error?: string;
};

export type UpdateCheckResponse = {
	host_version: string | null;
	checked_at: string;
	update_count: number;
	incompatible_count: number;
	items: ExtensionUpdateItem[];
};

export type UpdateApplyResponse = {
	id: string;
	name: string;
	from_version: string;
	to_version: string;
	reload_required: boolean;
	self_update: boolean;
};
