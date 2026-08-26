/** Native uninstall/install unloads every API extension, including this checker. */

const DEFAULT_TIMEOUT_MS = 15_000;
export const RELOAD_ROUTE_TIMEOUT_MS = 90_000;
/** Integrity check + 202 only. Native reload is polled separately. */
export const APPLY_POST_TIMEOUT_MS = 45_000;
export const SETTLE_TIMEOUT_MS = 180_000;

export function sleep(ms: number) {
	return new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

export function isRouteNotFound(error: unknown): boolean {
	const err = error as {
		response?: { status?: number; data?: { errors?: { message?: string; extensions?: { code?: string } }[] } };
	};
	const payload = err?.response?.data?.errors?.[0];
	if (payload?.extensions?.code === 'ROUTE_NOT_FOUND') return true;
	const message = String(payload?.message || '');
	return err?.response?.status === 404 && message.includes("doesn't exist");
}

export function isNotFound(error: unknown): boolean {
	const err = error as {
		response?: { status?: number; data?: { errors?: { extensions?: { code?: string } }[] } };
	};
	if (err?.response?.status !== 404) return false;
	const code = err.response.data?.errors?.[0]?.extensions?.code;
	return code === 'NOT_FOUND' || code === 'ROUTE_NOT_FOUND';
}

export function isConflict(error: unknown): boolean {
	const err = error as { response?: { status?: number }; status?: number };
	return err?.response?.status === 409 || err?.status === 409;
}

export function isTransportError(error: unknown): boolean {
	const err = error as { code?: string; message?: string; response?: { status?: number } };
	const status = err?.response?.status;
	if (status === 502 || status === 503 || status === 504) return true;
	if (err?.code === 'ECONNABORTED' || err?.code === 'ERR_NETWORK' || err?.code === 'ERR_CANCELED') return true;
	const message = String(err?.message || '').toLowerCase();
	return message.includes('timeout') || message.includes('network error');
}

export function apiErrorMessage(error: unknown, fallback: string): string {
	if (isRouteNotFound(error) || isTransportError(error)) {
		return (
			'The update checker API is unavailable while Directus reloads extensions. Wait a moment and try again, ' +
			'or reload the Data Studio. If this continues, confirm Marketplace Updates is enabled under Settings → Extensions.'
		);
	}

	const err = error as { response?: { data?: { errors?: { message?: string }[] } }; message?: string };
	return err?.response?.data?.errors?.[0]?.message || err?.message || fallback;
}

export async function withRouteRetry<T>(
	request: () => Promise<T>,
	options?: { timeoutMs?: number },
): Promise<T> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const started = Date.now();
	let attempt = 0;
	let lastError: unknown;

	while (Date.now() - started < timeoutMs) {
		try {
			return await request();
		} catch (error) {
			lastError = error;
			if (!isRouteNotFound(error) && !isTransportError(error)) throw error;
			attempt += 1;
			await sleep(Math.min(3_000, 400 * attempt));
		}
	}

	throw lastError;
}
