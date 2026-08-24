<template>
	<private-view title="Extension Updates" icon="system_update">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Settings', to: '/settings/extensions' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="About">
				<p class="sidebar-text">
					This page compares registry-installed extensions with the marketplace and applies updates by
					uninstalling the current version, then installing the latest compatible release.
				</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<p class="explain">
				Only extensions installed from the Marketplace are listed. Local folder and npm
				(<code>node_modules</code>) installs cannot be updated here.
			</p>

			<div class="actions">
				<v-button secondary :loading="checking" @click="load(true)">Check now</v-button>
			</div>

			<div v-if="errorMessage" class="result">
				<v-notice type="danger">{{ errorMessage }}</v-notice>
			</div>

			<div v-else-if="summary" class="result">
				<v-notice :type="summaryType">
					<template v-if="summary.update_count">
						{{ summary.update_count }} update<template v-if="summary.update_count !== 1">s</template>
						available
					</template>
					<template v-else>All marketplace extensions are up to date</template>
					<template v-if="summary.incompatible_count">
						· {{ summary.incompatible_count }} newer release<template v-if="summary.incompatible_count !== 1">s</template>
						need a newer Directus
					</template>
					<template v-if="summary.host_version">
						· Directus {{ summary.host_version }}
					</template>
				</v-notice>
			</div>

			<div v-if="!checking && items.length === 0 && !errorMessage" class="result">
				<v-notice type="info">
					No marketplace-installed extensions were found on this instance.
				</v-notice>
			</div>

			<div v-for="item in items" :key="item.id" class="ext-row">
				<div class="ext-main">
					<div class="ext-title">
						<strong>{{ item.name }}</strong>
						<v-chip v-if="item.type" small class="type-chip">{{ formatType(item.type) }}</v-chip>
						<v-chip v-if="item.has_update" small class="state warning">Update</v-chip>
						<v-chip v-else-if="item.incompatible_update" small class="state warning">Needs Directus</v-chip>
						<v-chip v-else-if="item.error" small class="state">Error</v-chip>
						<v-chip v-else small class="state enabled">Up to date</v-chip>
					</div>
					<p class="ext-meta">
						Installed {{ item.current_version }}
						<template v-if="item.latest_compatible_version">
							· Latest compatible {{ item.latest_compatible_version }}
						</template>
						<template v-else-if="item.latest_version">
							· Latest {{ item.latest_version }}
						</template>
						<template v-if="item.is_self"> · This checker</template>
					</p>
					<p v-if="item.error" class="ext-error">{{ item.error }}</p>
					<p v-else-if="item.incompatible_update && item.host_version" class="ext-error">
						{{ item.latest_version }} requires Directus {{ item.host_version }}.
					</p>
				</div>
				<div class="ext-actions">
					<v-button
						v-if="item.has_update"
						small
						:loading="applyingId === item.id"
						:disabled="Boolean(applyingId)"
						@click="confirmUpdate(item)"
					>
						Update
					</v-button>
					<v-button small secondary :to="item.marketplace_path">Marketplace</v-button>
				</div>
			</div>
		</div>

		<v-dialog v-model="confirmOpen" @esc="confirmOpen = false">
			<v-card>
				<v-card-title>Update {{ pending?.name }}?</v-card-title>
				<v-card-text>
					<p>
						This uninstalls {{ pending?.current_version }} and installs
						{{ pending?.latest_compatible_version }}. Config stored in project settings is kept.
						The Data Studio will need a reload afterwards.
					</p>
					<p v-if="pending?.is_self" class="dialog-note">
						This is the update checker itself. Apply it last if other extensions also have updates.
					</p>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="confirmOpen = false">Cancel</v-button>
					<v-button :loading="Boolean(applyingId)" @click="runUpdate">Update</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="reloadOpen" @esc="reloadOpen = false">
			<v-card>
				<v-card-title>Reload required</v-card-title>
				<v-card-text>
					{{ pending?.name || 'The extension' }} was updated to {{ appliedVersion }}. Reload the Data
					Studio to load the new version.
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="reloadOpen = false">Later</v-button>
					<v-button @click="reloadNow">Reload now</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import { usePageClass } from './composables/use-page-class';
import ModuleNavigation from './navigation.vue';
import type { ExtensionUpdateItem, UpdateCheckResponse } from '../shared/types';

const pageClass = usePageClass();
const api = useApi();
const { useServerStore } = useStores() as {
	useServerStore: () => { info?: { version?: string } };
};
const serverStore = useServerStore();

const checking = ref(false);
const applyingId = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const summary = ref<UpdateCheckResponse | null>(null);
const items = ref<ExtensionUpdateItem[]>([]);
const confirmOpen = ref(false);
const reloadOpen = ref(false);
const pending = ref<ExtensionUpdateItem | null>(null);
const appliedVersion = ref('');

const summaryType = computed(() => {
	if (!summary.value) return 'info';
	if (summary.value.update_count) return 'warning';
	if (summary.value.incompatible_count) return 'warning';
	return 'success';
});

function formatType(type: string) {
	return type.charAt(0).toUpperCase() + type.slice(1);
}

function hostParam() {
	return serverStore?.info?.version || undefined;
}

async function load(force = false) {
	checking.value = true;
	errorMessage.value = null;
	try {
		const res = await api.get('/extension-updates/check', {
			params: { force: force ? '1' : undefined, host: hostParam() },
		});
		const data = (res.data?.data || null) as UpdateCheckResponse | null;
		summary.value = data;
		items.value = data?.items || [];
	} catch (error: any) {
		errorMessage.value =
			error?.response?.data?.errors?.[0]?.message || error?.message || 'Update check failed';
		summary.value = null;
		items.value = [];
	} finally {
		checking.value = false;
	}
}

function confirmUpdate(item: ExtensionUpdateItem) {
	pending.value = item;
	confirmOpen.value = true;
}

async function runUpdate() {
	const item = pending.value;
	if (!item) return;
	applyingId.value = item.id;
	errorMessage.value = null;
	try {
		const res = await api.post('/extension-updates/apply', {
			extension: item.id,
			host: hostParam(),
		});
		confirmOpen.value = false;
		appliedVersion.value = res.data?.data?.to_version || item.latest_compatible_version || '';
		reloadOpen.value = true;
		await load(true);
	} catch (error: any) {
		errorMessage.value =
			error?.response?.data?.errors?.[0]?.message || error?.message || 'Update failed';
		confirmOpen.value = false;
	} finally {
		applyingId.value = null;
	}
}

function reloadNow() {
	window.location.reload();
}

onMounted(() => {
	void load(false);
});
</script>

<style scoped>
.page {
	padding: var(--content-padding);
	padding-block-end: var(--content-padding-bottom);
	max-width: 760px;
}

.page--flush-top {
	padding-block-start: 0;
}

.explain,
.sidebar-text,
.v-card-text {
	margin: 0 0 16px;
	line-height: 1.55;
	color: var(--theme--foreground);
}

.explain code,
.sidebar-text code {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 0.9em;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 16px;
}

.result {
	margin-bottom: 16px;
}

.ext-row {
	display: flex;
	gap: 16px;
	justify-content: space-between;
	align-items: flex-start;
	padding: 14px 0;
	border-top: var(--theme--border-width, 1px) solid var(--theme--border-color-subdued);
}

.ext-main {
	min-width: 0;
}

.ext-title {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.ext-meta,
.ext-error {
	margin: 6px 0 0;
	font-size: 13px;
	line-height: 1.45;
	color: var(--theme--foreground-subdued);
	font-family: var(--theme--fonts--monospace--font-family, monospace);
}

.ext-error {
	color: var(--theme--warning);
}

.ext-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	flex-shrink: 0;
}

.type-chip {
	--v-chip-color: var(--theme--foreground-subdued);
	--v-chip-background-color: var(--theme--background-normal);
}

.state {
	--v-chip-color: var(--theme--danger);
	--v-chip-background-color: var(--theme--danger-background);
}

.state.enabled {
	--v-chip-color: var(--theme--success);
	--v-chip-background-color: var(--theme--success-background);
}

.state.warning {
	--v-chip-color: var(--theme--warning);
	--v-chip-background-color: var(--theme--warning-background);
}

.dialog-note {
	margin-top: 12px;
}

.v-card-text p {
	margin: 0;
}
</style>
