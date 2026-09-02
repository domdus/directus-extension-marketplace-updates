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
					Marketplace installs are updated through the registry. Local extensions can be
					replaced from a zip/tgz, or switched to a Marketplace listing when the package.json name
					matches exactly. Packages missing their built entry files (for example no dist/) are
					blocked. Installs from <code>node_modules</code> are not managed here.
				</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<p class="explain">
				Marketplace extensions update through the registry. Local extensions can be uploaded as a zip or
				.tgz, and switched to the Marketplace when the package name matches exactly. Installs from
				<code>node_modules</code> stay package-manager-managed.
			</p>

			<div class="actions">
				<v-button secondary :loading="checking" :disabled="updatingAll || uploading" @click="load(true)">
					Check Now
				</v-button>
				<div class="actions-right">
					<v-button secondary :loading="uploading" :disabled="checking || updatingAll || Boolean(applyingId)" @click="pickUpload">
						Upload ZIP
					</v-button>
					<v-button
						v-if="updateTargets.length"
						:loading="updatingAll"
						:disabled="checking || uploading || Boolean(applyingId)"
						@click="confirmUpdateAll"
					>
						Update All
					</v-button>
				</div>
			</div>

			<div class="local-toggle">
				<v-checkbox v-model="showLocalUpdates" :disabled="checking || updatingAll || uploading" />
				<span>Show Local Extension Updates</span>
			</div>

			<div v-if="errorMessage" class="result">
				<v-notice type="danger">{{ errorMessage }}</v-notice>
			</div>

			<div v-else-if="summary" class="result">
				<v-notice v-if="visibleCorruptCount" type="danger" class="result">
					<template v-if="corruptNames.length">
						{{ formatNameList(corruptNames) }}
						<template v-if="corruptNames.length === 1"> was</template>
						<template v-else> were</template>
						disabled because the installed files are incomplete.
					</template>
					<template v-else>
						{{ visibleCorruptCount }} package<template v-if="visibleCorruptCount !== 1">s were</template>
						<template v-else> was</template>
						disabled because the installed files are incomplete.
					</template>
					Use Choose Version to install a complete release, then enable it again.
				</v-notice>
				<v-notice :type="summaryType">
					<template v-if="visibleUpdateCount">
						{{ visibleUpdateCount }} update<template v-if="visibleUpdateCount !== 1">s</template>
						available
					</template>
					<template v-else>All listed extensions are up to date</template>
					<template v-if="visibleHostMismatchCount">
						· {{ visibleHostMismatchCount }} newer release<template
							v-if="visibleHostMismatchCount !== 1"
							>s</template
						>
						need a newer Directus
					</template>
					<template v-if="summary.host_version">
						· Directus {{ summary.host_version }}
					</template>
				</v-notice>
			</div>

			<div
				v-if="showLocalUpdates && !checking && localItems.length === 0 && !errorMessage"
				class="result"
			>
				<v-notice type="info">No local extensions were found on this instance.</v-notice>
			</div>

			<div v-if="!checking && marketplaceItems.length === 0 && !errorMessage && !showLocalUpdates" class="result">
				<v-notice type="info">
					No Marketplace extensions were found on this instance.
				</v-notice>
			</div>

			<div v-for="(item, index) in visibleItems" :key="item.id">
				<p
					v-if="showLocalUpdates && item.source === 'local' && visibleItems[index - 1]?.source !== 'local'"
					class="section-label"
				>
					Local extensions
				</p>
				<p
					v-if="showLocalUpdates && item.source === 'registry' && visibleItems[index - 1]?.source !== 'registry'"
					class="section-label"
				>
					Marketplace extensions
				</p>
				<div class="ext-row">
					<div class="ext-main">
					<div class="ext-title">
						<strong>{{ item.name }}</strong>
						<v-chip small class="type-chip">{{ item.source === 'local' ? 'Local' : 'Marketplace' }}</v-chip>
						<v-chip v-if="item.type" small class="type-chip">{{ formatType(item.type) }}</v-chip>
						<v-chip v-if="item.files_missing" small class="state warning">Missing files</v-chip>
						<v-chip v-else-if="item.installed_blocked_reason" small class="state warning">Corrupt install</v-chip>
						<v-chip v-else-if="item.has_update" small class="state warning">Update</v-chip>
						<v-chip v-else-if="item.error" small class="state">Error</v-chip>
						<v-chip v-else-if="item.latest_blocked_reason" small class="state">Update blocked</v-chip>
						<v-chip v-else-if="item.source === 'local' && !item.marketplace_id" small class="type-chip">Not on Marketplace</v-chip>
						<v-chip v-else small class="state enabled">Up to date</v-chip>
					</div>
					<p class="ext-meta">
						Installed {{ item.current_version }}
						<template v-if="item.latest_version">
							· Latest {{ item.latest_version }}
						</template>
						<template v-if="item.is_self"> · This checker</template>
					</p>
					<p v-if="item.files_missing && item.source === 'registry'" class="ext-error">
						The files for this extension are gone, so Marketplace offers Install instead of Manage.
						Reinstall this version to restore them, then enable it if it is still disabled.
					</p>
					<p v-else-if="item.files_missing" class="ext-error">
						The files for this local extension are gone. Upload a zip/tgz to restore them.
					</p>
					<p v-else-if="item.installed_blocked_reason" class="ext-error">
						{{ item.installed_blocked_reason }}. Disabled so other Studio extensions can load.
						<template v-if="item.source === 'registry' || item.marketplace_id">
							Use Choose Version to install a complete release, then enable it again.
						</template>
						<template v-else>Upload a complete package, then enable it again.</template>
					</p>
					<p v-else-if="item.error" class="ext-error">{{ item.error }}</p>
					<p v-else-if="item.latest_blocked_reason" class="ext-note">
						Latest {{ item.latest_version }} is corrupt on the Marketplace. Your installed version is fine —
						use Choose Version for other releases.
					</p>
					<p v-else-if="item.source === 'local' && item.has_update" class="ext-note">
						Marketplace {{ item.latest_version }} is newer. Update switches this local extension to a
						registry install.
					</p>
					<p v-else-if="item.has_update && item.host_mismatch && item.host_version" class="ext-note">
						Declared host range {{ item.host_version }} (often outdated — update still allowed).
					</p>
					<p v-else-if="item.source === 'local' && !item.marketplace_id" class="ext-note">
						No Marketplace listing matches this package name — updates are by zip upload only.
					</p>
					<p v-else-if="item.source === 'local' && item.marketplace_older" class="ext-note">
						Marketplace {{ item.latest_version }} is older than this local copy.
					</p>
				</div>
				<div class="ext-actions">
					<v-button
						v-if="item.files_missing && item.source === 'registry'"
						small
						:loading="applyingId === item.id"
						:disabled="checking || updatingAll || uploading || Boolean(applyingId) || loadingVersions"
						@click="runReinstall(item)"
					>
						Reinstall
					</v-button>
					<v-button
						v-if="item.has_update"
						small
						:loading="applyingId === item.id"
						:disabled="checking || updatingAll || uploading || Boolean(applyingId) || loadingVersions"
						@click="confirmUpdate(item)"
					>
						Update
					</v-button>
					<v-button
						v-if="item.source === 'registry' || item.marketplace_id"
						small
						secondary
						:loading="loadingVersions && versionTarget?.id === item.id"
						:disabled="checking || updatingAll || uploading || Boolean(applyingId) || loadingVersions"
						@click="openVersionPicker(item)"
					>
						Choose Version
					</v-button>
					<v-button
						v-if="item.marketplace_path"
						v-tooltip="'Marketplace'"
						class="marketplace-icon"
						icon
						small
						secondary
						:to="item.marketplace_path"
					>
						<v-icon name="storefront" />
					</v-button>
				</div>
				</div>
			</div>

			<div
				v-if="showLocalUpdates && !checking && marketplaceItems.length === 0 && !errorMessage"
				class="result"
			>
				<v-notice type="info">No Marketplace extensions were found on this instance.</v-notice>
			</div>
		</div>

		<v-dialog v-model="confirmOpen" @esc="confirmOpen = false">
			<v-card>
				<v-card-title>Update {{ pending?.name }}?</v-card-title>
				<v-card-text>
					<p v-if="pending?.source === 'local'">
						This replaces this local extension with Marketplace {{ pending?.latest_version }}.
						Future updates will use the registry. The Data Studio will need a reload afterwards.
					</p>
					<p v-else>
						This uninstalls {{ pending?.current_version }} and installs
						{{ pending?.latest_version }}. Config stored in project settings is kept.
						The Data Studio will need a reload afterwards.
					</p>
					<p v-if="pending?.marketplace_older" class="dialog-note">
						Marketplace {{ pending.latest_version }} is older than local
						{{ pending.current_version }}.
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
				<v-card-title>Choose Version — {{ versionTarget?.name }}</v-card-title>
				<v-card-text>
					<p class="version-intro">
						Installed {{ versionList?.current_version || versionTarget?.current_version }}.
						<template v-if="versionTarget?.source === 'local'">
							These are Marketplace releases. Installing one replaces this local extension with a
							registry install.
						</template>
						<template v-else>
							These are Marketplace releases; corrupt packages (missing entry files) are disabled.
						</template>
					</p>
					<div v-if="loadingVersions" class="version-loading">
						<v-progress-circular indeterminate />
						<span>Loading versions…</span>
					</div>
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
							:disabled="!version.installable || Boolean(applyingId)"
							@click="confirmInstallVersion(version)"
						>
							<div class="version-row-main">
								<strong>{{ version.version }}</strong>
								<v-chip v-if="version.is_current && version.installable && versionTarget?.source === 'local'" small class="state warning">Switch</v-chip>
								<v-chip v-else-if="version.is_current && version.installable" small class="state warning">Reinstall</v-chip>
								<v-chip v-else-if="version.is_current" small class="state enabled">Installed</v-chip>
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
					<template v-if="versionTarget?.source === 'local'">
						Install Marketplace {{ pendingVersion?.version }} of {{ versionTarget?.name }}?
					</template>
					<template v-else-if="pendingVersion?.is_current">
						Reinstall {{ pendingVersion?.version }} of {{ versionTarget?.name }}?
					</template>
					<template v-else>
						Install {{ pendingVersion?.version }} of {{ versionTarget?.name }}?
					</template>
				</v-card-title>
				<v-card-text>
					<p v-if="versionTarget?.source === 'local'">
						This replaces this local extension with Marketplace {{ pendingVersion?.version }} from
						the registry. Future updates will use Marketplace.
					</p>
					<p v-else-if="pendingVersion?.is_current">
						This restores the missing files for {{ pendingVersion?.version }}. Your project settings are
						kept. You’ll be asked to refresh the page when it’s done.
					</p>
					<p v-else>
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
					<v-button :loading="Boolean(applyingId)" @click="runInstallVersion">
						<template v-if="versionTarget?.source === 'local'">Install</template>
						<template v-else-if="pendingVersion?.is_current">Reinstall</template>
						<template v-else>Install</template>
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog
			:model-value="confirmAllOpen"
			persistent
			@update:model-value="onConfirmAllOpenChange"
			@esc="onCancelUpdateAll"
		>
			<v-card>
				<v-card-title>
					<template v-if="updatingAll && cancelAllRequested">
						Stopping…
					</template>
					<template v-else-if="updatingAll && bulkProgress">
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
						<template v-if="cancelAllRequested">
							Finishing {{ bulkProgress.name }}, then stopping…
						</template>
						<template v-else>
							Updating {{ bulkProgress.name }} ({{ bulkProgress.current }}/{{ bulkProgress.total }})…
							This can take a moment.
						</template>
					</p>
					<template v-else>
						<p>
							Each extension will be updated to its latest Marketplace version, one at a time. This can
							take a moment. Marketplace installs keep project settings. Local extensions that match a
							listing are switched to the Marketplace. You’ll be asked to refresh the page when it’s
							done.
						</p>
						<p v-if="updateTargets.some((item) => item.is_self)" class="dialog-note">
							This checker is included and will be applied last.
						</p>
					</template>
				</v-card-text>
				<v-card-actions>
					<v-button
						secondary
						:disabled="updatingAll && cancelAllRequested"
						@click="onCancelUpdateAll"
					>
						<template v-if="updatingAll && cancelAllRequested">Stopping…</template>
						<template v-else>Cancel</template>
					</v-button>
					<v-button :loading="updatingAll" :disabled="updatingAll" @click="runUpdateAll">
						Update All
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="uploadOpen" @esc="!uploading && closeUploadDialog()">
			<v-card>
				<v-card-title>Upload from Device</v-card-title>
				<v-card-text>
					<p class="version-intro">
						A <code>.zip</code>, <code>.tgz</code>, or <code>.tar.gz</code> with
						<code>package.json</code> and the built files (usually a <code>dist/</code> folder).
					</p>
					<div
						class="dropzone"
						:class="{ dragging: uploadDragging, disabled: uploading }"
						@dragenter.prevent="onUploadDragEnter"
						@dragover.prevent
						@dragleave.prevent="onUploadDragLeave"
						@drop.prevent="onUploadDrop"
					>
						<input
							ref="fileInput"
							class="dropzone-browse"
							type="file"
							accept=".zip,.tgz,.tar.gz,application/zip,application/gzip"
							:disabled="uploading"
							@change="onFileChosen"
						/>
						<v-icon name="file_upload" large />
						<p>{{ uploadDragging ? 'Drop to upload' : 'Drag file here' }}</p>
					</div>
				</v-card-text>
				<v-card-actions>
					<v-button secondary :disabled="uploading" @click="closeUploadDialog">Cancel</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="replaceOpen" @esc="replaceOpen = false">
			<v-card>
				<v-card-title>Replace {{ pendingReplace?.name }}?</v-card-title>
				<v-card-text>
					<p>
						{{ pendingReplace?.name }} is already installed locally
						<template v-if="pendingReplace?.current_version">
							as {{ pendingReplace.current_version }}
						</template>
						. Replace it with
						<template v-if="pendingReplace?.incoming_version">
							{{ pendingReplace.incoming_version }}
						</template>
						<template v-else>this upload</template>?
					</p>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="cancelReplace">Cancel</v-button>
					<v-button :loading="uploading" @click="runReplaceUpload">Replace</v-button>
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
						<template v-if="bulkResult.skipped">
							{{ bulkResult.skipped }} skipped.
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
import {
	apiErrorMessage,
	APPLY_POST_TIMEOUT_MS,
	isConflict,
	isNotFound,
	isRouteNotFound,
	isTransportError,
	RELOAD_ROUTE_TIMEOUT_MS,
	SETTLE_TIMEOUT_MS,
	sleep,
	withRouteRetry,
} from './route-retry';
import { formatNameList } from '../shared/format';
import { compareSemver } from '../shared/semver';
import type {
	ExtensionUpdateItem,
	ExtensionVersionListResponse,
	ExtensionVersionOption,
	UpdateApplyResponse,
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
const uploading = ref(false);
const cancelAllRequested = ref(false);
const loadingVersions = ref(false);
const errorMessage = ref<string | null>(null);
const versionError = ref<string | null>(null);
const summary = ref<UpdateCheckResponse | null>(null);
const items = ref<ExtensionUpdateItem[]>([]);
const confirmOpen = ref(false);
const confirmAllOpen = ref(false);
const confirmVersionOpen = ref(false);
const versionPickerOpen = ref(false);
const replaceOpen = ref(false);
const reloadOpen = ref(false);
const pending = ref<ExtensionUpdateItem | null>(null);
const pendingReplace = ref<{
	file: File;
	name?: string;
	current_version?: string;
	incoming_version?: string;
} | null>(null);
const versionTarget = ref<ExtensionUpdateItem | null>(null);
const versionList = ref<ExtensionVersionListResponse | null>(null);
const pendingVersion = ref<ExtensionVersionOption | null>(null);
const appliedVersion = ref('');
const bulkResult = ref<{ succeeded: number; failed: number; skipped: number } | null>(null);
const bulkProgress = ref<{ current: number; total: number; name: string } | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const showLocalUpdates = ref(false);
const uploadOpen = ref(false);
const uploadDragging = ref(false);
let uploadDragCount = 0;

const marketplaceItems = computed(() => items.value.filter((item) => item.source === 'registry'));
const localItems = computed(() => items.value.filter((item) => item.source === 'local'));
const visibleItems = computed(() =>
	showLocalUpdates.value ? [...localItems.value, ...marketplaceItems.value] : marketplaceItems.value,
);
const visibleUpdateCount = computed(() => visibleItems.value.filter((item) => item.has_update).length);
const visibleHostMismatchCount = computed(
	() => visibleItems.value.filter((item) => item.has_update && item.host_mismatch).length,
);
const visibleCorruptItems = computed(() =>
	visibleItems.value.filter((item) => item.installed_blocked_reason && !item.files_missing),
);
const visibleCorruptCount = computed(() => visibleCorruptItems.value.length);

const summaryType = computed(() => {
	if (!summary.value) return 'info';
	if (visibleCorruptCount.value) return 'warning';
	if (visibleUpdateCount.value) return 'warning';
	return 'success';
});

const updateTargets = computed(() => {
	const pendingItems = visibleItems.value.filter((item) => item.has_update && !item.error);
	const others = pendingItems.filter((item) => !item.is_self);
	const self = pendingItems.filter((item) => item.is_self);
	return [...others, ...self];
});

const corruptNames = computed(() => visibleCorruptItems.value.map((item) => item.name));

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

async function waitForCheckerRoute() {
	await sleep(800);
	await withRouteRetry(
		() => api.get('/extension-updates/ping', { timeout: 8_000 }),
		{ timeoutMs: RELOAD_ROUTE_TIMEOUT_MS },
	);
}

async function waitUntilApplied(
	extensionId: string,
	targetVersionId: string,
	expectedVersion: string,
	timeoutMs = SETTLE_TIMEOUT_MS,
	folder?: string,
): Promise<string> {
	const started = Date.now();
	let lastError: unknown;

	while (Date.now() - started < timeoutMs) {
		try {
			const res = await api.get(`/extension-updates/status/${encodeURIComponent(extensionId)}`, {
				timeout: 8_000,
			});
			const row = res.data?.data as {
				current_version?: string;
				current_version_id?: string;
				files_ok?: boolean;
			} | undefined;
			if (!row?.files_ok) continue;
			if (targetVersionId && row.current_version_id === targetVersionId) {
				return row.current_version || expectedVersion;
			}
			if (expectedVersion && row.current_version === expectedVersion) {
				return expectedVersion;
			}
		} catch (error) {
			lastError = error;
			if (folder && (isRouteNotFound(error) || isNotFound(error))) {
				try {
					const folderRes = await api.get(`/extension-updates/folder-status/${encodeURIComponent(folder)}`, {
						timeout: 8_000,
					});
					const folderRow = folderRes.data?.data as {
						current_version?: string;
						files_ok?: boolean;
					} | undefined;
					if (folderRow?.files_ok && expectedVersion && folderRow.current_version === expectedVersion) {
						await api.get('/extension-updates/ping', { timeout: 8_000 });
						return expectedVersion;
					}
				} catch {
					// keep polling
				}
			} else if (!isRouteNotFound(error) && !isNotFound(error) && !isTransportError(error)) {
				throw error;
			}
		}
		await sleep(1_500);
	}

	throw lastError || new Error('Timed out waiting for Directus to finish installing that extension');
}

async function load(force = false, waitForRouteMs?: number) {
	checking.value = true;
	errorMessage.value = null;
	try {
		const res = await withRouteRetry(
			() =>
				api.get('/extension-updates/check', {
					params: { force: force ? '1' : undefined, host: hostParam() },
				}),
			{ timeoutMs: waitForRouteMs ?? (force ? RELOAD_ROUTE_TIMEOUT_MS : undefined) },
		);
		const data = (res.data?.data || null) as UpdateCheckResponse | null;
		summary.value = data;
		items.value = data?.items || [];
	} catch (error: unknown) {
		errorMessage.value = apiErrorMessage(error, 'Update check failed');
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
	cancelAllRequested.value = false;
	confirmAllOpen.value = true;
}

function onCancelUpdateAll() {
	if (!updatingAll.value) {
		confirmAllOpen.value = false;
		return;
	}
	cancelAllRequested.value = true;
}

function onConfirmAllOpenChange(open: boolean) {
	if (open) {
		confirmAllOpen.value = true;
		return;
	}
	onCancelUpdateAll();
}

async function openVersionPicker(item: ExtensionUpdateItem) {
	versionTarget.value = item;
	versionList.value = null;
	versionError.value = null;
	pendingVersion.value = null;
	versionPickerOpen.value = true;
	loadingVersions.value = true;
	try {
		const res = await withRouteRetry(
			() => api.get(`/extension-updates/versions/${encodeURIComponent(item.id)}`),
			{ timeoutMs: RELOAD_ROUTE_TIMEOUT_MS },
		);
		versionList.value = (res.data?.data || null) as ExtensionVersionListResponse | null;
	} catch (error: unknown) {
		versionError.value = apiErrorMessage(error, 'Could not load versions');
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
	if (!version.installable) return;
	pendingVersion.value = version;
	confirmVersionOpen.value = true;
}

async function applyOne(
	item: ExtensionUpdateItem,
	versionId?: string,
	expectedVersion?: string,
) {
	const expected = expectedVersion || item.latest_version || '';
	let lastError: unknown;

	for (let attempt = 0; attempt < 3; attempt++) {
		await waitForCheckerRoute();
		try {
			const res = await api.post(
				'/extension-updates/apply',
				{
					extension: item.id,
					version: versionId || undefined,
					host: hostParam(),
				},
				{ timeout: APPLY_POST_TIMEOUT_MS },
			);
			const data = (res.data?.data || {}) as UpdateApplyResponse;
			const toVersion = data.to_version || expected;
			const pollId = data.id || item.id;
			const folder = data.folder || item.folder;
			const targetVersionId =
				data.kind === 'upload' ? '' : data.current_version_id || versionId || item.latest_version_id || '';
			return await waitUntilApplied(pollId, targetVersionId, toVersion, SETTLE_TIMEOUT_MS, folder);
		} catch (error) {
			lastError = error;
			if (isConflict(error)) {
				return await waitUntilApplied(
					item.id,
					versionId || item.latest_version_id || '',
					expected,
					SETTLE_TIMEOUT_MS,
					item.folder,
				);
			}
			if (isRouteNotFound(error)) {
				try {
					return await waitUntilApplied(
						item.id,
						versionId || item.latest_version_id || '',
						expected,
						20_000,
						item.folder,
					);
				} catch {
					continue;
				}
			}
			if (isTransportError(error)) {
				return await waitUntilApplied(
					item.id,
					versionId || item.latest_version_id || '',
					expected,
					SETTLE_TIMEOUT_MS,
					item.folder,
				);
			}
			throw error;
		}
	}

	throw lastError || new Error('Update failed');
}

function pickUpload() {
	uploadDragging.value = false;
	uploadDragCount = 0;
	uploadOpen.value = true;
}

function closeUploadDialog() {
	if (uploading.value) return;
	uploadOpen.value = false;
	uploadDragging.value = false;
	uploadDragCount = 0;
}

function isExtensionArchive(file: File) {
	const name = file.name.toLowerCase();
	return name.endsWith('.zip') || name.endsWith('.tgz') || name.endsWith('.tar.gz');
}

function onUploadDragEnter() {
	uploadDragCount += 1;
	if (uploadDragCount === 1) uploadDragging.value = true;
}

function onUploadDragLeave() {
	uploadDragCount -= 1;
	if (uploadDragCount <= 0) {
		uploadDragCount = 0;
		uploadDragging.value = false;
	}
}

function onUploadDrop(event: DragEvent) {
	uploadDragCount = 0;
	uploadDragging.value = false;
	const file = event.dataTransfer?.files?.[0];
	if (!file || uploading.value) return;
	void takeUploadFile(file);
}

function takeUploadFile(file: File) {
	if (!isExtensionArchive(file)) {
		errorMessage.value = 'Upload a .zip, .tgz, or .tar.gz package';
		return;
	}
	uploadOpen.value = false;
	void uploadFile(file, false);
}

function conflictDetails(error: unknown): {
	name?: string;
	current_version?: string;
	incoming_version?: string;
} | null {
	const err = error as { response?: { status?: number; data?: { errors?: { extensions?: Record<string, string> }[] } } };
	if (err?.response?.status !== 409) return null;
	return err.response.data?.errors?.[0]?.extensions || null;
}

async function uploadFile(file: File, replace = false) {
	uploading.value = true;
	errorMessage.value = null;
	bulkResult.value = null;
	try {
		const form = new FormData();
		form.append('file', file);
		const res = await api.post(`/extension-updates/upload${replace ? '?replace=1' : ''}`, form, {
			timeout: APPLY_POST_TIMEOUT_MS,
		});
		const data = (res.data?.data || {}) as UpdateApplyResponse;
		appliedVersion.value = await waitUntilApplied(
			data.id,
			'',
			data.to_version,
			SETTLE_TIMEOUT_MS,
			data.folder,
		);
		pending.value = { name: data.name } as ExtensionUpdateItem;
		reloadOpen.value = true;
		await load(true, RELOAD_ROUTE_TIMEOUT_MS);
	} catch (error: unknown) {
		const conflict = conflictDetails(error);
		if (conflict && !replace) {
			pendingReplace.value = {
				file,
				name: conflict.name,
				current_version: conflict.current_version,
				incoming_version: conflict.incoming_version,
			};
			replaceOpen.value = true;
			return;
		}
		errorMessage.value = apiErrorMessage(error, 'Upload failed');
	} finally {
		uploading.value = false;
		if (fileInput.value) fileInput.value.value = '';
	}
}

function onFileChosen(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (fileInput.value) fileInput.value.value = '';
	if (!file) return;
	void takeUploadFile(file);
}

function cancelReplace() {
	replaceOpen.value = false;
	pendingReplace.value = null;
}

async function runReplaceUpload() {
	const pendingFile = pendingReplace.value?.file;
	replaceOpen.value = false;
	if (!pendingFile) return;
	await uploadFile(pendingFile, true);
	pendingReplace.value = null;
}

async function runReinstall(item: ExtensionUpdateItem) {
	if (!item.current_version_id) return;
	applyingId.value = item.id;
	errorMessage.value = null;
	bulkResult.value = null;
	try {
		appliedVersion.value = await applyOne(item, item.current_version_id, item.current_version);
		pending.value = item;
		reloadOpen.value = true;
		await load(true, RELOAD_ROUTE_TIMEOUT_MS);
	} catch (error: unknown) {
		errorMessage.value = apiErrorMessage(error, 'Reinstall failed');
	} finally {
		applyingId.value = null;
	}
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
		await load(true, RELOAD_ROUTE_TIMEOUT_MS);
	} catch (error: unknown) {
		errorMessage.value = apiErrorMessage(error, 'Update failed');
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
		appliedVersion.value = await applyOne(item, version.id, version.version);
		confirmVersionOpen.value = false;
		versionPickerOpen.value = false;
		pending.value = item;
		reloadOpen.value = true;
		await load(true, RELOAD_ROUTE_TIMEOUT_MS);
	} catch (error: unknown) {
		errorMessage.value = apiErrorMessage(error, 'Install failed');
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
	cancelAllRequested.value = false;
	errorMessage.value = null;
	bulkProgress.value = null;
	let succeeded = 0;
	let failed = 0;
	let skipped = 0;
	let lastError: string | null = null;

	try {
		for (let index = 0; index < queue.length; index++) {
			if (cancelAllRequested.value) {
				skipped = queue.length - index;
				break;
			}
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
			} catch (error: unknown) {
				failed += 1;
				lastError = apiErrorMessage(error, 'Update failed');
				break;
			}
		}
	} finally {
		applyingId.value = null;
		updatingAll.value = false;
		cancelAllRequested.value = false;
		bulkProgress.value = null;
		confirmAllOpen.value = false;
	}

	await load(true, RELOAD_ROUTE_TIMEOUT_MS);

	if (succeeded || skipped) {
		bulkResult.value = { succeeded, failed, skipped };
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
.page-container {
	padding: var(--content-padding);
	padding-block-end: var(--content-padding-bottom);
	max-inline-size: 67.5rem;
}

.page-container--flush-top {
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

.actions-right {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.local-toggle {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: -4px 0 16px;
	font-size: 14px;
	line-height: 1.4;
	color: var(--theme--foreground);
}

.section-label {
	margin: 8px 0 12px;
	font-size: 13px;
	font-weight: 600;
	letter-spacing: 0.02em;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
}

.dropzone {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	min-block-size: 140px;
	padding: 24px 16px;
	color: var(--theme--foreground-subdued);
	text-align: center;
	border: var(--theme--border-width, 2px) dashed var(--theme--form--field--input--border-color, var(--theme--border-color));
	border-radius: var(--theme--border-radius, 6px);
	cursor: pointer;
}

.dropzone p {
	margin: 0;
	color: inherit;
}

.dropzone.dragging {
	color: var(--theme--primary);
	background-color: var(--theme--primary-background);
	border-color: var(--theme--primary);
}

.dropzone.disabled {
	pointer-events: none;
	opacity: 0.6;
}

.dropzone-browse {
	position: absolute;
	inset: 0;
	inline-size: 100%;
	block-size: 100%;
	cursor: pointer;
	opacity: 0;
}

.result {
	margin-bottom: 16px;
}

.ext-row {
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	justify-content: space-between;
	align-items: flex-start;
	padding: 14px 0;
	border-top: var(--theme--border-width, 1px) solid var(--theme--border-color-subdued);
}

.ext-main {
	min-width: 0;
	flex: 1 1 12rem;
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
.version-intro {
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

.version-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 12px;
	min-height: 120px;
	margin: 12px 0 0;
	font-size: 13px;
	line-height: 1.45;
	color: var(--theme--foreground-subdued);
}

.ext-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	flex-shrink: 0;
	justify-content: flex-end;
}

.marketplace-icon {
	--v-button-min-width: 36px;
	border-radius: var(--theme--border-radius, 6px) !important;
}

@media (max-width: 600px) {
	.ext-row {
		flex-direction: column;
		align-items: stretch;
	}

	.ext-main {
		flex: none;
	}

	.ext-actions {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		flex-shrink: 1;
		width: 100%;
		justify-content: flex-end;
	}
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
