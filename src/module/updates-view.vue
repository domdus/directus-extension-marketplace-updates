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
					uninstalling the current version, then installing a chosen marketplace release. Packages that
					are missing their built entry files (for example no dist/) are blocked before uninstall. Use
					<strong>Install version</strong> to pick an older or newer release.
				</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<p class="explain">
				Only extensions installed from the Marketplace are listed. Local folder and npm
				(<code>node_modules</code>) installs cannot be updated here.
			</p>

			<div class="actions">
				<v-button secondary :loading="checking" :disabled="updatingAll" @click="load(true)">
					Check now
				</v-button>
				<v-button
					v-if="updateTargets.length"
					:loading="updatingAll"
					:disabled="checking || Boolean(applyingId)"
					@click="confirmUpdateAll"
				>
					Update all
				</v-button>
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
					<template v-if="summary.host_mismatch_count">
						· {{ summary.host_mismatch_count }} newer release<template
							v-if="summary.host_mismatch_count !== 1"
							>s</template
						>
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
						<v-chip v-else-if="item.error" small class="state">Error</v-chip>
						<v-chip v-else small class="state enabled">Up to date</v-chip>
					</div>
					<p class="ext-meta">
						Installed {{ item.current_version }}
						<template v-if="item.latest_version">
							· Latest {{ item.latest_version }}
						</template>
						<template v-if="item.is_self"> · This checker</template>
					</p>
					<p v-if="item.error" class="ext-error">{{ item.error }}</p>
					<p v-else-if="item.has_update && item.host_mismatch && item.host_version" class="ext-note">
						Declared host range {{ item.host_version }} (often outdated — update still allowed).
					</p>
				</div>
				<div class="ext-actions">
					<v-button
						v-if="item.has_update"
						small
						:loading="applyingId === item.id"
						:disabled="checking || updatingAll || Boolean(applyingId) || loadingVersions"
						@click="confirmUpdate(item)"
					>
						Update
					</v-button>
					<v-button
						small
						secondary
						:loading="loadingVersions && versionTarget?.id === item.id"
						:disabled="checking || updatingAll || Boolean(applyingId) || loadingVersions"
						@click="openVersionPicker(item)"
					>
						Install version
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
						{{ pending?.latest_version }}. Config stored in project settings is kept.
						The Data Studio will need a reload afterwards.
					</p>
					<p v-if="pending?.host_mismatch && pending?.host_version" class="dialog-note">
						Marketplace lists host range {{ pending.host_version }}, which does not match this
						Directus. Publishers often leave that field outdated — proceed if you trust the release.
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

		<v-dialog v-model="versionPickerOpen" @esc="!applyingId && closeVersionPicker()">
			<v-card class="version-card">
				<v-card-title>Install version — {{ versionTarget?.name }}</v-card-title>
				<v-card-text>
					<p class="version-intro">
						Installed {{ versionList?.current_version || versionTarget?.current_version }}. Choose any
						marketplace release; corrupt packages (missing entry files) are disabled.
					</p>
					<div v-if="loadingVersions" class="version-loading">Loading versions…</div>
					<div v-else-if="versionError" class="ext-error">{{ versionError }}</div>
					<div v-else class="version-list">
						<button
							v-for="version in versionList?.versions || []"
							:key="version.id"
							type="button"
							class="version-row"
							:class="{
								current: version.is_current,
								blocked: !version.installable && !version.is_current,
							}"
							:disabled="version.is_current || !version.installable || Boolean(applyingId)"
							@click="confirmInstallVersion(version)"
						>
							<div class="version-row-main">
								<strong>{{ version.version }}</strong>
								<v-chip v-if="version.is_current" small class="state enabled">Installed</v-chip>
								<v-chip v-else-if="!version.installable" small class="state">Blocked</v-chip>
								<v-chip
									v-else-if="isNewerThanInstalled(version.version)"
									small
									class="state warning"
								>
									Newer
								</v-chip>
								<v-chip v-else small class="type-chip">Older</v-chip>
							</div>
							<p v-if="version.publish_date" class="version-meta">
								{{ formatDate(version.publish_date) }}
								<template v-if="version.host_version"> · host {{ version.host_version }}</template>
							</p>
							<p v-if="version.error" class="ext-error">{{ version.error }}</p>
						</button>
					</div>
				</v-card-text>
				<v-card-actions>
					<v-button secondary :disabled="Boolean(applyingId)" @click="closeVersionPicker">
						Close
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="confirmVersionOpen" @esc="confirmVersionOpen = false">
			<v-card>
				<v-card-title>
					Install {{ pendingVersion?.version }} of {{ versionTarget?.name }}?
				</v-card-title>
				<v-card-text>
					<p>
						This uninstalls {{ versionList?.current_version || versionTarget?.current_version }} and
						installs {{ pendingVersion?.version }}. Config stored in project settings is kept. The
						Data Studio will need a reload afterwards.
					</p>
					<p v-if="versionTarget?.is_self" class="dialog-note">
						This is the update checker itself — reload immediately after installing.
					</p>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="confirmVersionOpen = false">Cancel</v-button>
					<v-button :loading="Boolean(applyingId)" @click="runInstallVersion">Install</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="confirmAllOpen" @esc="!updatingAll && (confirmAllOpen = false)">
			<v-card>
				<v-card-title>
					<template v-if="updatingAll && bulkProgress">
						Updating extensions…
					</template>
					<template v-else>
						Update {{ updateTargets.length }} extension<template v-if="updateTargets.length !== 1"
							>s</template
						>?
					</template>
				</v-card-title>
				<v-card-text>
					<p v-if="updatingAll && bulkProgress" class="bulk-progress">
						Updating {{ bulkProgress.name }} ({{ bulkProgress.current }}/{{ bulkProgress.total }})…
					</p>
					<template v-else>
						<p>
							Each extension is uninstalled and reinstalled at its latest marketplace version, one at a
							time. Config in project settings is kept. The Data Studio will need a reload afterwards.
						</p>
						<p v-if="updateTargets.some((item) => item.host_mismatch)" class="dialog-note">
							Some releases declare a host range that does not match this Directus. Publishers often
							leave that field outdated — proceed if you trust those releases.
						</p>
						<p v-if="updateTargets.some((item) => item.is_self)" class="dialog-note">
							This checker is included and will be applied last.
						</p>
					</template>
				</v-card-text>
				<v-card-actions>
					<v-button secondary :disabled="updatingAll" @click="confirmAllOpen = false">Cancel</v-button>
					<v-button :loading="updatingAll" :disabled="updatingAll" @click="runUpdateAll">
						Update all
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="reloadOpen" @esc="reloadOpen = false">
			<v-card>
				<v-card-title>Reload required</v-card-title>
				<v-card-text>
					<template v-if="bulkResult">
						Updated {{ bulkResult.succeeded }} extension<template v-if="bulkResult.succeeded !== 1"
							>s</template
						>.
						<template v-if="bulkResult.failed">
							{{ bulkResult.failed }} failed.
						</template>
						Reload the Data Studio to load the new versions.
					</template>
					<template v-else>
						{{ pending?.name || versionTarget?.name || 'The extension' }} was switched to
						{{ appliedVersion }}. Reload the Data Studio to load that version.
					</template>
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
import { compareSemver } from '../shared/semver';
import type {
	ExtensionUpdateItem,
	ExtensionVersionListResponse,
	ExtensionVersionOption,
	UpdateCheckResponse,
} from '../shared/types';

const pageClass = usePageClass();
const api = useApi();
const { useServerStore } = useStores() as {
	useServerStore: () => { info?: { version?: string } };
};
const serverStore = useServerStore();

const checking = ref(false);
const applyingId = ref<string | null>(null);
const updatingAll = ref(false);
const loadingVersions = ref(false);
const errorMessage = ref<string | null>(null);
const versionError = ref<string | null>(null);
const summary = ref<UpdateCheckResponse | null>(null);
const items = ref<ExtensionUpdateItem[]>([]);
const confirmOpen = ref(false);
const confirmAllOpen = ref(false);
const confirmVersionOpen = ref(false);
const versionPickerOpen = ref(false);
const reloadOpen = ref(false);
const pending = ref<ExtensionUpdateItem | null>(null);
const versionTarget = ref<ExtensionUpdateItem | null>(null);
const versionList = ref<ExtensionVersionListResponse | null>(null);
const pendingVersion = ref<ExtensionVersionOption | null>(null);
const appliedVersion = ref('');
const bulkResult = ref<{ succeeded: number; failed: number } | null>(null);
const bulkProgress = ref<{ current: number; total: number; name: string } | null>(null);

const summaryType = computed(() => {
	if (!summary.value) return 'info';
	if (summary.value.update_count) return 'warning';
	return 'success';
});

const updateTargets = computed(() => {
	const pendingItems = items.value.filter((item) => item.has_update && !item.error);
	const others = pendingItems.filter((item) => !item.is_self);
	const self = pendingItems.filter((item) => item.is_self);
	return [...others, ...self];
});

function formatType(type: string) {
	return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatDate(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isNewerThanInstalled(version: string) {
	const current = versionList.value?.current_version || versionTarget.value?.current_version;
	if (!current || current === 'unknown') return false;
	return compareSemver(version, current) > 0;
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
	bulkResult.value = null;
	pending.value = item;
	confirmOpen.value = true;
}

function confirmUpdateAll() {
	if (!updateTargets.value.length) return;
	bulkResult.value = null;
	bulkProgress.value = null;
	confirmAllOpen.value = true;
}

async function openVersionPicker(item: ExtensionUpdateItem) {
	versionTarget.value = item;
	versionList.value = null;
	versionError.value = null;
	pendingVersion.value = null;
	versionPickerOpen.value = true;
	loadingVersions.value = true;
	try {
		const res = await api.get(`/extension-updates/versions/${encodeURIComponent(item.id)}`);
		versionList.value = (res.data?.data || null) as ExtensionVersionListResponse | null;
	} catch (error: any) {
		versionError.value =
			error?.response?.data?.errors?.[0]?.message || error?.message || 'Could not load versions';
	} finally {
		loadingVersions.value = false;
	}
}

function closeVersionPicker() {
	if (applyingId.value) return;
	versionPickerOpen.value = false;
	confirmVersionOpen.value = false;
	pendingVersion.value = null;
}

function confirmInstallVersion(version: ExtensionVersionOption) {
	if (!version.installable || version.is_current) return;
	pendingVersion.value = version;
	confirmVersionOpen.value = true;
}

async function applyOne(item: ExtensionUpdateItem, versionId?: string) {
	const res = await api.post('/extension-updates/apply', {
		extension: item.id,
		version: versionId || undefined,
		host: hostParam(),
	});
	return res.data?.data?.to_version || versionId || item.latest_version || '';
}

async function runUpdate() {
	const item = pending.value;
	if (!item) return;
	applyingId.value = item.id;
	errorMessage.value = null;
	bulkResult.value = null;
	try {
		appliedVersion.value = await applyOne(item);
		confirmOpen.value = false;
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

async function runInstallVersion() {
	const item = versionTarget.value;
	const version = pendingVersion.value;
	if (!item || !version) return;
	applyingId.value = item.id;
	errorMessage.value = null;
	bulkResult.value = null;
	try {
		appliedVersion.value = await applyOne(item, version.id);
		confirmVersionOpen.value = false;
		versionPickerOpen.value = false;
		pending.value = item;
		reloadOpen.value = true;
		await load(true);
	} catch (error: any) {
		errorMessage.value =
			error?.response?.data?.errors?.[0]?.message || error?.message || 'Install failed';
		confirmVersionOpen.value = false;
	} finally {
		applyingId.value = null;
	}
}

async function runUpdateAll() {
	const queue = [...updateTargets.value];
	if (!queue.length) {
		confirmAllOpen.value = false;
		return;
	}

	updatingAll.value = true;
	errorMessage.value = null;
	bulkProgress.value = null;
	let succeeded = 0;
	let failed = 0;
	let lastError: string | null = null;

	try {
		for (let index = 0; index < queue.length; index++) {
			const item = queue[index]!;
			bulkProgress.value = {
				current: index + 1,
				total: queue.length,
				name: item.name,
			};
			applyingId.value = item.id;
			try {
				await applyOne(item);
				succeeded += 1;
			} catch (error: any) {
				failed += 1;
				lastError =
					error?.response?.data?.errors?.[0]?.message || error?.message || 'Update failed';
				break;
			}
		}
	} finally {
		applyingId.value = null;
		updatingAll.value = false;
		bulkProgress.value = null;
		confirmAllOpen.value = false;
	}

	await load(true);

	if (succeeded) {
		bulkResult.value = { succeeded, failed };
		pending.value = null;
		appliedVersion.value = '';
		reloadOpen.value = true;
	}
	if (failed && lastError) {
		errorMessage.value =
			succeeded > 0
				? `Stopped after ${succeeded} update${succeeded === 1 ? '' : 's'}: ${lastError}`
				: lastError;
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
	align-items: center;
	justify-content: space-between;
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
.ext-error,
.ext-note,
.version-meta,
.version-intro,
.version-loading {
	margin: 6px 0 0;
	font-size: 13px;
	line-height: 1.45;
	color: var(--theme--foreground-subdued);
}

.ext-meta,
.version-meta {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
}

.ext-error {
	color: var(--theme--warning);
}

.ext-note {
	color: var(--theme--foreground-subdued);
}

.ext-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	flex-shrink: 0;
	justify-content: flex-end;
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

.bulk-progress {
	margin: 0;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
	line-height: 1.45;
	word-break: break-word;
}

.version-card {
	min-width: min(560px, 92vw);
}

.version-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
	max-height: min(50vh, 420px);
	overflow: auto;
	margin-top: 12px;
}

.version-row {
	display: block;
	width: 100%;
	text-align: left;
	padding: 12px 14px;
	border: var(--theme--border-width, 1px) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius, 6px);
	background: var(--theme--background);
	color: inherit;
	cursor: pointer;
}

.version-row:hover:not(:disabled) {
	border-color: var(--theme--primary);
}

.version-row:disabled {
	cursor: default;
	opacity: 0.85;
}

.version-row.blocked {
	opacity: 0.7;
}

.version-row-main {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.v-card-text p {
	margin: 0;
}
</style>
