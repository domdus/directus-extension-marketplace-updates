import { parseVersionLocks, setVersionLock, VERSION_LOCKS_FIELD, type VersionLocks } from '../shared/version-locks';

type Database = any;

export async function readVersionLocks(database: Database): Promise<VersionLocks> {
	try {
		if (!(await database.schema.hasColumn('directus_settings', VERSION_LOCKS_FIELD))) return {};
		const row = await database('directus_settings').select(VERSION_LOCKS_FIELD).first();
		return parseVersionLocks(row?.[VERSION_LOCKS_FIELD]);
	} catch {
		return {};
	}
}

async function ensureVersionLocksField(
	services: { FieldsService: new (options: Record<string, unknown>) => any },
	schema: unknown,
	database: Database,
): Promise<void> {
	if (await database.schema.hasColumn('directus_settings', VERSION_LOCKS_FIELD)) return;
	const fieldsService = new services.FieldsService({ accountability: null, schema });
	await fieldsService.createField('directus_settings', {
		field: VERSION_LOCKS_FIELD,
		type: 'json',
		meta: {
			collection: 'directus_settings',
			field: VERSION_LOCKS_FIELD,
			special: ['cast-json'],
			interface: 'input-code',
			hidden: true,
			readonly: false,
			width: 'full',
			note: 'Managed by Marketplace Updates extension. Do not edit manually.',
		},
		schema: {},
	});
}

export async function writeVersionLock(options: {
	services: { FieldsService: new (options: Record<string, unknown>) => any };
	schema: unknown;
	database: Database;
	extensionId: string;
	version: string | null;
}): Promise<VersionLocks> {
	const { services, schema, database, extensionId, version } = options;
	await ensureVersionLocksField(services, schema, database);

	return database.transaction(async (trx: Database) => {
		const row = await trx('directus_settings').select('id', VERSION_LOCKS_FIELD).first();
		const locks = setVersionLock(parseVersionLocks(row?.[VERSION_LOCKS_FIELD]), extensionId, version);
		const value = JSON.stringify(locks);
		if (row) await trx('directus_settings').where({ id: row.id }).update({ [VERSION_LOCKS_FIELD]: value });
		else await trx('directus_settings').insert({ [VERSION_LOCKS_FIELD]: value });
		return locks;
	});
}
