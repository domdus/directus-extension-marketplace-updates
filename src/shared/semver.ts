export function normalizeVersion(raw: string): string {
	return String(raw || '')
		.trim()
		.replace(/^v/i, '');
}

function splitVersion(version: string): { nums: number[]; prerelease: string[] } {
	const normalized = normalizeVersion(version);
	const [core, prereleaseRaw] = normalized.split('-', 2);
	const nums = core
		.split('.')
		.map((part) => parseInt(part, 10))
		.map((n) => (Number.isFinite(n) ? n : 0));
	return { nums, prerelease: prereleaseRaw ? prereleaseRaw.split('.') : [] };
}

/** @returns 1 if a > b, -1 if a < b, 0 if equal */
export function compareSemver(a: string, b: string): number {
	const av = splitVersion(a);
	const bv = splitVersion(b);
	const len = Math.max(av.nums.length, bv.nums.length, 3);
	for (let i = 0; i < len; i++) {
		const left = av.nums[i] ?? 0;
		const right = bv.nums[i] ?? 0;
		if (left > right) return 1;
		if (left < right) return -1;
	}
	if (!av.prerelease.length && bv.prerelease.length) return 1;
	if (av.prerelease.length && !bv.prerelease.length) return -1;
	const pLen = Math.max(av.prerelease.length, bv.prerelease.length);
	for (let i = 0; i < pLen; i++) {
		const left = av.prerelease[i];
		const right = bv.prerelease[i];
		if (left == null) return -1;
		if (right == null) return 1;
		const lNum = /^[0-9]+$/.test(left) ? parseInt(left, 10) : null;
		const rNum = /^[0-9]+$/.test(right) ? parseInt(right, 10) : null;
		if (lNum != null && rNum != null) {
			if (lNum > rNum) return 1;
			if (lNum < rNum) return -1;
			continue;
		}
		if (lNum != null && rNum == null) return -1;
		if (lNum == null && rNum != null) return 1;
		if (left > right) return 1;
		if (left < right) return -1;
	}
	return 0;
}

function sameMajor(a: string, b: string): boolean {
	return (splitVersion(a).nums[0] ?? 0) === (splitVersion(b).nums[0] ?? 0);
}

function sameMajorMinor(a: string, b: string): boolean {
	const av = splitVersion(a);
	const bv = splitVersion(b);
	return (av.nums[0] ?? 0) === (bv.nums[0] ?? 0) && (av.nums[1] ?? 0) === (bv.nums[1] ?? 0);
}

function matchesComparator(version: string, token: string): boolean {
	const trimmed = token.trim();
	if (!trimmed) return true;
	const match = trimmed.match(/^(>=|<=|>|<|=|~|\^)?\s*(.+)$/);
	if (!match) return true;
	const op = match[1] || '=';
	const target = normalizeVersion(match[2] || '');
	if (!target) return true;
	const cmp = compareSemver(version, target);
	switch (op) {
		case '>=':
			return cmp >= 0;
		case '<=':
			return cmp <= 0;
		case '>':
			return cmp > 0;
		case '<':
			return cmp < 0;
		case '^':
			return cmp >= 0 && sameMajor(version, target);
		case '~':
			return cmp >= 0 && sameMajorMinor(version, target);
		default:
			return cmp === 0;
	}
}

/** Marketplace `host_version` ranges, e.g. `>=10.10.0 <13.0.0` or `^10.0.0 || ^11.0.0`. */
export function versionSatisfies(version: string, range: string | null | undefined): boolean {
	const v = normalizeVersion(version);
	if (!v) return false;
	if (!range || !String(range).trim()) return true;
	return String(range)
		.trim()
		.split(/\s*\|\|\s*/)
		.some((clause) => {
			const tokens = clause
				.trim()
				.split(/\s+/)
				.filter((token) => token && token !== '||');
			if (!tokens.length) return false;
			return tokens.every((token) => matchesComparator(v, token));
		});
}
