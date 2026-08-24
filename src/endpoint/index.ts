import type { Request, Response, NextFunction, Router } from 'express';
import type { ApiExtensionContext } from '@directus/types';
import { accountabilityIsAdmin } from '../shared/admin';
import { applyMarketplaceUpdate } from './apply';
import { checkMarketplaceUpdates } from './check';

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
		const { services, getSchema, env, database } = context;

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

				const extensionId = String((req.body as { extension?: string } | undefined)?.extension || '');
				if (!extensionId) {
					res.status(400).json({ errors: [{ message: 'extension is required' }] });
					return;
				}

				const schema = await getSchema();
				const extensionsService = new services.ExtensionsService({
					accountability: (req as any).accountability,
					schema,
				});
				const host = typeof req.body?.host === 'string' ? req.body.host : undefined;
				const data = await applyMarketplaceUpdate({
					extensionsService,
					env,
					extensionId,
					hostVersion: host,
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
	},
};
