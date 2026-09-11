<template>
	<v-list nav>
		<template v-for="(group, index) in linkGroups" :key="index">
			<v-list-item
				v-for="item in group"
				:key="item.to ?? item.href"
				:to="item.to"
				:href="item.href"
				:target="item.href ? '_blank' : undefined"
				:rel="item.href ? 'noopener noreferrer' : undefined"
				:class="item.className"
			>
				<v-list-item-icon>
					<v-icon :name="item.icon" />
				</v-list-item-icon>
				<v-list-item-content>
					<span class="label">
						<v-text-overflow class="label" :text="item.name" />
					</span>
				</v-list-item-content>
			</v-list-item>

			<v-divider v-if="index !== linkGroups.length - 1" />
		</template>

		<v-list-item href="https://github.com/directus/directus/releases" target="_blank" rel="noopener noreferrer" class="version">
			<v-list-item-icon>
				<v-icon name="directus" />
			</v-list-item-icon>
			<v-list-item-content>
				<v-text-overflow class="version" :text="versionLabel" />
			</v-list-item-content>
		</v-list-item>
	</v-list>
</template>

<script setup lang="ts">
import { useStores } from '@directus/extensions-sdk';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

type NavLink = {
	icon: string;
	name: string;
	to?: string;
	href?: string;
	className?: string;
};

const DEFAULT_REPORT_BUG_URL =
	'https://github.com/directus/directus/issues/new?template=bug_report.yml';
const DEFAULT_REPORT_FEATURE_URL = 'https://roadmap.directus.io/';

const { t } = useI18n();
const { useServerStore, useSettingsStore } = useStores() as {
	useServerStore: () => {
		info?: {
			version?: string;
			ai_enabled?: boolean;
			mcp_enabled?: boolean;
			websocket?: { logs?: boolean };
		};
	};
	useSettingsStore: () => {
		settings?: {
			report_bug_url?: string | null;
			report_feature_url?: string | null;
		};
	};
};

const { info } = storeToRefs(useServerStore());
const { settings } = storeToRefs(useSettingsStore());

const versionLabel = computed(() => {
	const version = info.value?.version;
	return version ? `Directus ${version}` : 'Directus';
});

const linkGroups = computed(() => {
	const groups: NavLink[][] = [
		[
			{ icon: 'database', name: t('settings_data_model'), to: '/settings/data-model' },
			{ icon: 'bolt', name: t('settings_flows'), to: '/settings/flows' },
		],
		[
			{ icon: 'group', name: t('settings_roles'), to: '/settings/roles' },
			{ icon: 'admin_panel_settings', name: t('settings_permissions'), to: '/settings/policies' },
		],
		[
			{ icon: 'tune', name: t('settings_project'), to: '/settings/project' },
			{ icon: 'palette', name: t('settings_appearance'), to: '/settings/appearance' },
			{ icon: 'bookmark', name: t('settings_presets'), to: '/settings/presets' },
			{ icon: 'translate', name: t('settings_translations'), to: '/settings/translations' },
			...(info.value?.ai_enabled || info.value?.mcp_enabled
				? [{ icon: 'smart_toy', name: t('settings_ai'), to: '/settings/ai' }]
				: []),
		],
		[
			{ icon: 'storefront', name: t('marketplace'), to: '/settings/marketplace' },
			{ icon: 'category', name: t('extensions'), to: '/settings/extensions' },
			{ icon: 'system_update', name: 'Extension Updates', to: '/extension-updates' },
		],
		[
			...(info.value?.websocket?.logs
				? [{ icon: 'terminal', name: t('settings_system_logs'), to: '/settings/system-logs' }]
				: []),
			{
				icon: 'bug_report',
				name: t('report_bug'),
				href: settings.value?.report_bug_url ?? DEFAULT_REPORT_BUG_URL,
			},
			{
				icon: 'new_releases',
				name: t('request_feature'),
				href: settings.value?.report_feature_url ?? DEFAULT_REPORT_FEATURE_URL,
			},
		],
	];

	return groups.filter((group) => group.length > 0);
});
</script>

<style scoped>
.version :deep(.v-icon) {
	color: var(--theme--foreground-subdued);
	transition: color var(--fast) var(--transition);
}

.version :deep(.v-text-overflow) {
	color: var(--theme--foreground-subdued);
	transition: color var(--fast) var(--transition);
}

.version:hover :deep(.v-icon),
.version:hover :deep(.v-text-overflow) {
	color: var(--theme--foreground-accent);
}

.label {
	display: flex;
	align-items: center;
}
</style>
