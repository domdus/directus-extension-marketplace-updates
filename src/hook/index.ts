import { defineHook } from '@directus/extensions-sdk';
import { quarantineCorruptRegistryExtensions } from '../endpoint/quarantine';

export default defineHook(({ action }, { database, env, services, getSchema, logger }) => {
	let scheduled = false;

	async function runQuarantine(reason: string) {
		if (scheduled) return;
		scheduled = true;
		try {
			let extensionsService: {
				updateOne: (id: string, data: { meta: { enabled: boolean } }) => Promise<unknown>;
			} | null = null;

			try {
				if (typeof services.ExtensionsService === 'function') {
					const schema = await getSchema();
					extensionsService = new services.ExtensionsService({
						schema,
						accountability: null,
					});
				}
			} catch {
				extensionsService = null;
			}

			const disabled = await quarantineCorruptRegistryExtensions({
				database,
				env,
				extensionsService,
				logger,
			});

			if (disabled.length) {
				logger.warn(
					`[extension-updates] ${reason}: disabled ${disabled.length} corrupt Marketplace package(s). Reload Studio after the next extension reload.`,
				);
			}
		} catch (error: any) {
			logger.warn(`[extension-updates] Corrupt-package quarantine failed: ${error?.message || error}`);
		} finally {
			scheduled = false;
		}
	}

	// After API extensions register (this hook included) Directus bundles App
	// extensions. If that Rollup failed, we still get extensions.load — disable
	// the broken registry row so the queued reload can bundle successfully.
	action('extensions.load', () => {
		void runQuarantine('extensions.load');
	});

	action('server.start', () => {
		void runQuarantine('server.start');
	});
});
