import type { UpdateCheckResponse } from '../shared/types';

const listCache = new Map<string, { expiresAt: number; data: UpdateCheckResponse }>();
export const LIST_TTL_MS = 30 * 60 * 1000;

export function readUpdateCache(key: string): UpdateCheckResponse | null {
	const cached = listCache.get(key);
	if (cached && Date.now() < cached.expiresAt) return cached.data;
	return null;
}

export function writeUpdateCache(key: string, data: UpdateCheckResponse): void {
	listCache.set(key, { data, expiresAt: Date.now() + LIST_TTL_MS });
}

export function invalidateUpdateCache(): void {
	listCache.clear();
}
