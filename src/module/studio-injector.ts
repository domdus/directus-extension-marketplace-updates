import { userHasAdminAccess } from '../shared/admin';

const FLAG = '__extensionUpdatesStudioInjectorInstalled';
const STYLE_ID = 'eu-studio-injector-styles';
const NAV_ATTR = 'data-eu-settings-nav';
const BANNER_ATTR = 'data-eu-extensions-banner';
const ENDPOINT_PATH = '/extension-updates/check';

type CheckPayload = {
	update_count?: number;
	host_mismatch_count?: number;
	corrupt_count?: number;
	host_version?: string | null;
};

function getVueApp(): any {
	return (document.querySelector('#app') as any)?.__vue_app__ || null;
}

function isAdminUser(): boolean {
	try {
		const pinia = getPinia(getVueApp());
		const userStore = pinia?._s?.get?.('userStore');
		return userHasAdminAccess(userStore?.currentUser);
	} catch {
		return false;
	}
}

function getPinia(app: any): any {
	return app?.config?.globalProperties?.$pinia || null;
}

function getAuthHeaders(): Record<string, string> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	try {
		const pinia = getPinia(getVueApp());
		const auth = pinia?._s?.get?.('authStore');
		const token = auth?.accessToken || auth?.access_token || auth?.token;
		if (typeof token === 'string' && token) {
			headers.Authorization = `Bearer ${token}`;
		}
	} catch {
		// cookie session still works with credentials: 'same-origin'
	}
	return headers;
}

function adminBase(): string {
	const path = window.location.pathname;
	const idx = path.indexOf('/admin');
	if (idx >= 0) return path.slice(0, idx) + '/admin';
	return '/admin';
}

function apiRoot(): string {
	const path = window.location.pathname;
	const idx = path.indexOf('/admin');
	if (idx >= 0) return path.slice(0, idx) || '';
	return '';
}

function currentPath(): string {
	return window.location.pathname.replace(/\/+$/, '') + '/';
}

function isSettingsModule(): boolean {
	return /\/settings\//.test(currentPath());
}

function isExtensionsList(): boolean {
	return /\/settings\/extensions\/?$/.test(window.location.pathname.replace(/\/+$/, ''));
}

function isMarketplaceSettings(): boolean {
	return /\/settings\/marketplace(\/|$)/.test(window.location.pathname.replace(/\/+$/, ''));
}

function isBannerPage(): boolean {
	return isExtensionsList() || isMarketplaceSettings();
}

function isUpdatesPage(): boolean {
	return window.location.pathname.replace(/\/+$/, '').endsWith('/extension-updates');
}

function ensureStyles(): void {
	if (document.getElementById(STYLE_ID)) return;
	const el = document.createElement('style');
	el.id = STYLE_ID;
	el.textContent = `
[${NAV_ATTR}] .v-icon,
[${NAV_ATTR}] .material-icons,
[${NAV_ATTR}] .material-symbols-outlined,
[${NAV_ATTR}] .material-symbols-rounded {
	font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
.eu-ext-banner {
	margin: 0 0 1rem;
	padding: 12px 16px;
	border-radius: var(--theme--border-radius, 6px);
	background: var(--theme--warning-background, var(--warning-alt));
	color: var(--theme--warning, var(--warning));
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	font-size: 14px;
	line-height: 1.4;
}
.eu-ext-banner a {
	color: inherit;
	font-weight: 600;
	text-decoration: none;
}
.eu-ext-banner a:hover {
	text-decoration: underline;
}
.eu-ext-banner.danger {
	background: var(--theme--danger-background, var(--danger-alt));
	color: var(--theme--danger, var(--danger));
}
`;
	document.head.appendChild(el);
}

function findExtensionsNavLink(): HTMLElement | null {
	const links = Array.from(document.querySelectorAll<HTMLElement>('a[href]'));
	for (const link of links) {
		if (link.hasAttribute(NAV_ATTR)) continue;
		const href = link.getAttribute('href') || '';
		if (!/\/settings\/extensions\/?$/.test(href)) continue;
		if (href.includes('marketplace')) continue;
		return link;
	}
	return null;
}

function setLinkActive(node: HTMLElement, active: boolean): void {
	node.classList.toggle('router-link-active', active);
	node.classList.toggle('router-link-exact-active', active);
	node.classList.toggle('active', active);
}

function removeInjectedNav(): void {
	document.querySelectorAll(`[${NAV_ATTR}]`).forEach((node) => node.remove());
}

function listAlreadyHasUpdatesLink(list: Element | null): boolean {
	if (!list) return false;
	return Array.from(list.querySelectorAll('a[href]')).some((anchor) => {
		const href = anchor.getAttribute('href') || '';
		return href.includes('/extension-updates') && !anchor.hasAttribute(NAV_ATTR);
	});
}

function getRouter(): any {
	try {
		return getVueApp()?.config?.globalProperties?.$router || null;
	} catch {
		return null;
	}
}

function updatesPath(): string {
	return `${adminBase()}/extension-updates`;
}

function navigateToUpdates(event?: Event): void {
	event?.preventDefault();
	event?.stopPropagation();
	const router = getRouter();
	if (router?.push) {
		void router.push('/extension-updates');
		return;
	}
	window.location.assign(updatesPath());
}

function wireSpaNavigation(root: HTMLElement): void {
	const targets: HTMLElement[] = [];
	if (root.tagName === 'A') targets.push(root);
	root.querySelectorAll('a').forEach((anchor) => targets.push(anchor as HTMLElement));
	if (!targets.length) {
		root.addEventListener('click', navigateToUpdates);
		return;
	}
	for (const target of targets) {
		target.addEventListener('click', navigateToUpdates);
	}
}

function injectSettingsNav(): void {
	// This page already renders Marketplace / Extensions / Extension Updates in Vue.
	// Only inject into native Settings navigation.
	if (isUpdatesPage() || !isSettingsModule()) {
		removeInjectedNav();
		return;
	}

	const extensionsLink = findExtensionsNavLink();
	if (!extensionsLink) return;
	const list = extensionsLink.closest('ul, .v-list, nav');
	if (listAlreadyHasUpdatesLink(list)) {
		removeInjectedNav();
		return;
	}

	if (document.querySelector(`[${NAV_ATTR}]`)) {
		const existing = document.querySelector(`[${NAV_ATTR}]`) as HTMLElement | null;
		if (existing) setLinkActive(existing, false);
		return;
	}

	const clone = extensionsLink.cloneNode(true) as HTMLElement;
	clone.setAttribute(NAV_ATTR, '1');
	const href = updatesPath();
	if (clone.tagName === 'A') {
		clone.setAttribute('href', href);
	}
	clone.querySelectorAll('a').forEach((anchor) => {
		anchor.setAttribute('href', href);
	});

	const overflow = clone.querySelector('.v-text-overflow, [class*="text-overflow"]');
	if (overflow) overflow.textContent = 'Extension Updates';
	else {
		const content = clone.querySelector('.v-list-item-content');
		if (content) content.textContent = 'Extension Updates';
	}

	clone.querySelectorAll('[data-icon]').forEach((el) => el.setAttribute('data-icon', 'system_update'));
	const iconText = clone.querySelector('.material-icons, .material-symbols-outlined, .material-symbols-rounded');
	if (iconText) iconText.textContent = 'system_update';

	setLinkActive(clone, false);
	setLinkActive(extensionsLink, /\/settings\/extensions\/?$/.test(window.location.pathname));

	wireSpaNavigation(clone);
	extensionsLink.parentElement?.insertBefore(clone, extensionsLink.nextSibling);
}

function removeBanner(): void {
	document.querySelectorAll(`[${BANNER_ATTR}]`).forEach((node) => node.remove());
}

function bannerHost(): HTMLElement | null {
	return (
		(document.querySelector('#main-content .page-container') as HTMLElement | null) ||
		(document.querySelector('.page-container') as HTMLElement | null) ||
		(document.querySelector('#main-content .private-view > div:last-child') as HTMLElement | null)
	);
}

async function loadUpdateCount(): Promise<CheckPayload | null> {
	try {
		const host = getPinia(getVueApp())?._s?.get?.('serverStore')?.info?.version;
		const params = new URLSearchParams();
		if (host) params.set('host', String(host));
		const url = `${apiRoot()}${ENDPOINT_PATH}${params.toString() ? `?${params}` : ''}`;
		const res = await fetch(url, { headers: getAuthHeaders(), credentials: 'same-origin' });
		if (!res.ok) return null;
		const json = await res.json();
		const data = json?.data;
		if (!data || typeof data !== 'object') return null;
		return {
			update_count: data.update_count,
			host_mismatch_count: data.host_mismatch_count,
			corrupt_count: data.corrupt_count,
			host_version: data.host_version,
		};
	} catch {
		return null;
	}
}

function formatSummary(data: CheckPayload): string {
	const parts: string[] = [];
	const corrupt = Number(data.corrupt_count || 0);
	if (corrupt) {
		parts.push(
			corrupt === 1
				? '1 Marketplace package was disabled because it is corrupt'
				: `${corrupt} Marketplace packages were disabled because they are corrupt`,
		);
	}
	const count = Number(data.update_count || 0);
	if (count) {
		parts.push(count === 1 ? '1 Marketplace update available' : `${count} Marketplace updates available`);
	}
	const mismatch = Number(data.host_mismatch_count || 0);
	if (mismatch) {
		parts.push(
			mismatch === 1
				? '1 newer release needs a newer Directus'
				: `${mismatch} newer releases need a newer Directus`,
		);
	}
	if (data.host_version) {
		parts.push(`Directus ${data.host_version}`);
	}
	return parts.join(' · ');
}

let bannerInflight = false;
let bannerCheckedAt = 0;
let bannerEmpty = false;

async function injectBanner(): Promise<void> {
	if (!isBannerPage()) {
		removeBanner();
		return;
	}
	if (document.querySelector(`[${BANNER_ATTR}]`)) return;
	if (bannerInflight) return;
	if (bannerEmpty && Date.now() - bannerCheckedAt < 60_000) return;
	bannerInflight = true;
	try {
		const data = await loadUpdateCount();
		bannerCheckedAt = Date.now();
		if (!isBannerPage()) return;
		const count = Number(data?.update_count || 0);
		const corrupt = Number(data?.corrupt_count || 0);
		if ((!count && !corrupt) || !data) {
			bannerEmpty = true;
			removeBanner();
			return;
		}
		bannerEmpty = false;
		const host = bannerHost();
		if (!host) return;
		const el = document.createElement('div');
		el.setAttribute(BANNER_ATTR, '1');
		el.className = corrupt ? 'eu-ext-banner danger' : 'eu-ext-banner';
		const label = formatSummary(data);
		el.innerHTML = `<span>${label}</span><a href="${updatesPath()}">Review updates</a>`;
		const review = el.querySelector('a');
		if (review) review.addEventListener('click', navigateToUpdates);
		host.insertBefore(el, host.firstChild);
	} finally {
		bannerInflight = false;
	}
}

function sync(): void {
	if (!isAdminUser()) return;
	ensureStyles();
	injectSettingsNav();
	void injectBanner();
	if (!isBannerPage()) removeBanner();
}

export function installStudioInjector(): void {
	if (typeof window === 'undefined') return;
	if ((window as any)[FLAG]) return;
	(window as any)[FLAG] = true;

	const start = () => {
		sync();
		let timer = 0;
		const observer = new MutationObserver(() => {
			window.clearTimeout(timer);
			timer = window.setTimeout(sync, 80);
		});
		observer.observe(document.body, { childList: true, subtree: true });

		const app = getVueApp();
		const router = app?.config?.globalProperties?.$router;
		if (router?.afterEach) {
			router.afterEach(() => {
				window.setTimeout(sync, 30);
			});
		} else {
			window.addEventListener('popstate', () => window.setTimeout(sync, 30));
		}
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start, { once: true });
	} else {
		start();
	}
}
