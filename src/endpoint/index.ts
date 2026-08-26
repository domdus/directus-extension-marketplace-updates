import type { Request, Response, NextFunction, Router } from 'express';
import type { ApiExtensionContext } from '@directus/types';
import { accountabilityIsAdmin } from '../shared/admin';
import { finalizeMarketplaceUpdate, prepareMarketplaceUpdate, readInstallStatus } from './apply';
import { checkMarketplaceUpdates } from './check';
import { quarantineCorruptRegistryExtensions } from './quarantine';
import { listExtensionVersions } from './versions';

function requireAdmin(req: Request, res: Response): boolean {
	if (!accountabilityIsAdmin((req as any).accountability)) {
		res.status(403).json({ errors: [{ message: 'Admin access required', extensions: { code: 'FORBIDDEN' } }] });
		return false;
	}
	return true;
}

function sendError(res: Response, error: unknown) {
	const err = error as { status?: number; message?: string };
	const status = typeof err?.status === 'number' ? err.status : 500;
	res.status(status).json({
		errors: [{ message: err?.message || 'Request failed', extensions: { code: status === 500 ? 'INTERNAL_SERVER_ERROR' : 'INVALID_PAYLOAD' } }],
	});
}

export default {
	id: 'extension-updates',
	handler: (router: Router, context: ApiExtensionContext) => {
		const { services, getSchema, env, database, logger } = context;

		router.get('/ping', async (req: Request, res: Response) => {
			if (!requireAdmin(req, res)) return;
			res.json({ data: { ok: true } });
		});

		router.get('/check', async (req: Request, res: Response, next: NextFunction) => {
			try {
				if (!requireAdmin(req, res)) return;
				if (typeof services.ExtensionsService !== 'function') {
					res.status(501).json({
						errors: [
							{
								message: 'Marketplace updates require Directus 10.10 or newer',
								extensions: { code: 'UNSUPPORTED' },
							},
						],
					});
					return;
				}

				const schema = await getSchema();
				const extensionsService = new services.ExtensionsService({
					accountability: (req as any).accountability,
					schema,
				});
				const force = String(req.query.force || '') === '1';
				const host = typeof req.query.host === 'string' ? req.query.host : undefined;
				const data = await checkMarketplaceUpdates({
					extensionsService,
					database,
					env,
					hostVersion: host,
					force,
				});
				res.json({ data });
			} catch (error) {
				next(error);
			}
		});

		router.get('/status/:extension', async (req: Request, res: Response) => {
			try {
				if (!requireAdmin(req, res)) return;
				if (typeof services.ExtensionsService !== 'function') {
					res.status(501).json({
						errors: [
							{
								message: 'Marketplace updates require Directus 10.10 or newer',
								extensions: { code: 'UNSUPPORTED' },
							},
						],
					});
					return;
				}

				const extensionId = String(req.params.extension || '');
				if (!extensionId) {
					res.status(400).json({ errors: [{ message: 'extension is required' }] });
					return;
				}

				const schema = await getSchema();
				const extensionsService = new services.ExtensionsService({
					accountability: (req as any).accountability,
					schema,
				});
				const current = await extensionsService.readOne(extensionId);
				res.json({ data: readInstallStatus(current, env) });
			} catch {
				res.status(404).json({
					errors: [{ message: 'Extension not found', extensions: { code: 'NOT_FOUND' } }],
				});
			}
		});

		router.get('/versions/:extension', async (req: Request, res: Response, next: NextFunction) => {
			try {
				if (!requireAdmin(req, res)) return;
				if (typeof services.ExtensionsService !== 'function') {
					res.status(501).json({
						errors: [
							{
								message: 'Marketplace updates require Directus 10.10 or newer',
								extensions: { code: 'UNSUPPORTED' },
							},
						],
					});
					return;
				}

				const extensionId = String(req.params.extension || '');
				if (!extensionId) {
					res.status(400).json({ errors: [{ message: 'extension is required' }] });
					return;
				}

				const schema = await getSchema();
				const extensionsService = new services.ExtensionsService({
					accountability: (req as any).accountability,
					schema,
				});
				const data = await listExtensionVersions({
					extensionsService,
					env,
					extensionId,
				});
				res.json({ data });
			} catch (error) {
				if ((error as { status?: number })?.status) {
					sendError(res, error);
					return;
				}
				next(error);
			}
		});

		router.post('/apply', async (req: Request, res: Response, next: NextFunction) => {
			try {
				if (!requireAdmin(req, res)) return;
				if (typeof services.ExtensionsService !== 'function') {
					res.status(501).json({
						errors: [
							{
								message: 'Marketplace updates require Directus 10.10 or newer',
								extensions: { code: 'UNSUPPORTED' },
							},
						],
					});
					return;
				}

				const body = (req.body || {}) as { extension?: string; version?: string; host?: string };
				const extensionId = String(body.extension || '');
				if (!extensionId) {
					res.status(400).json({ errors: [{ message: 'extension is required' }] });
					return;
				}

				const schema = await getSchema();
				const extensionsService = new services.ExtensionsService({
					accountability: (req as any).accountability,
					schema,
				});
				const plan = await prepareMarketplaceUpdate({
					extensionsService,
					env,
					extensionId,
					versionId: body.version || null,
					hostVersion: typeof body.host === 'string' ? body.host : undefined,
				});
				res.status(202).json({ data: plan.response });
				setImmediate(() => {
					void finalizeMarketplaceUpdate(plan, logger).catch((error: unknown) => {
						const message = error instanceof Error ? error.message : String(error);
						logger?.error(`[extension-updates] Background apply failed: ${message}`);
					});
				});
			} catch (error) {
				if ((error as { status?: number })?.status) {
					sendError(res, error);
					return;
				}
				next(error);
			}
		});

		router.post('/repair', async (req: Request, res: Response, next: NextFunction) => {
			try {
				if (!requireAdmin(req, res)) return;
				if (typeof services.ExtensionsService !== 'function') {
					res.status(501).json({
						errors: [
							{
								message: 'Marketplace updates require Directus 10.10 or newer',
								extensions: { code: 'UNSUPPORTED' },
							},
						],
					});
					return;
				}

				const schema = await getSchema();
				const extensionsService = new services.ExtensionsService({
					accountability: (req as any).accountability,
					schema,
				});
				const data = await quarantineCorruptRegistryExtensions({
					database,
					env,
					extensionsService,
				});
				res.json({ data: { disabled: data } });
			} catch (error) {
				if ((error as { status?: number })?.status) {
					sendError(res, error);
					return;
				}
				next(error);
			}
		});
	},
};
