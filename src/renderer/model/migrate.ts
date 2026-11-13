import { MapDocSchema, WorldMetaSchema, type MapDoc, type WorldMeta } from './schema';

export const CURRENT_FORMAT_VERSION = 1;

export type MigrationStep = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Ordered upgrade functions keyed by source `formatVersion` (e.g. 1 -> 2).
 */
export const WORLD_MIGRATIONS: Record<number, MigrationStep> = {};
export const MAP_MIGRATIONS: Record<number, MigrationStep> = {};

function runMigrations(
  raw: unknown,
  migrations: Record<number, MigrationStep>,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Expected JSON object');
  }
  let current: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  let version =
    typeof current['formatVersion'] === 'number' ? current['formatVersion'] : 1;

  if (version > CURRENT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported formatVersion ${version} (max supported is ${CURRENT_FORMAT_VERSION})`,
    );
  }

  while (version < CURRENT_FORMAT_VERSION) {
    const step = migrations[version];
    if (!step) {
      throw new Error(`Missing migration step for formatVersion ${version}`);
    }
    current = step(current);
    version += 1;
    current['formatVersion'] = version;
  }

  return current;
}

export function migrateWorldData(raw: unknown): WorldMeta {
  const migrated = runMigrations(raw, WORLD_MIGRATIONS);
  return WorldMetaSchema.parse(migrated);
}

export function migrateMapData(raw: unknown): MapDoc {
  const migrated = runMigrations(raw, MAP_MIGRATIONS);
  return MapDocSchema.parse(migrated);
}
