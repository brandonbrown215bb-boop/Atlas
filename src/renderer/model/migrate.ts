import { MapDocSchema, WorldMetaSchema, type MapDoc, type WorldMeta } from './schema';

export const CURRENT_FORMAT_VERSION = 2;

/** Older layer deletion left its contents pointing at a nonexistent layer. Recover them intact. */
export function restoreMissingLayers(map: MapDoc): void {
  const known = new Set(map.layers.map(layer => layer.id));
  for (const entity of Object.values(map.entities)) {
    if (known.has(entity.layerId)) continue;
    map.layers.push({ id: entity.layerId, name: 'Recovered contents', visible: true, locked: false, gmOnly: false });
    known.add(entity.layerId);
  }
}

export type MigrationStep = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Ordered upgrade functions keyed by source `formatVersion` (e.g. 1 -> 2).
 */
export const WORLD_MIGRATIONS: Record<number, MigrationStep> = { 1: data => ({...data}) };
export const MAP_MIGRATIONS: Record<number, MigrationStep> = { 1: data => {
  const map = structuredClone(data) as unknown as MapDoc;
  map.groups ??= {};
  for(const [id,r] of Object.entries(map.generators ?? {})) {
    r.algorithmVersion ??= 1;
    r.params = {...r.params, algorithmVersion: r.params.algorithmVersion ?? 1};
    r.groupId ??= id;
    const source=map.entities[r.regionEntityId];
    if(source?.type==='area'){r.boundary ??= source.rings;source.usage='boundary';source.groupId=id;}
    map.groups[id]={name:`${r.type} result`,genId:id,boundary:r.boundary};
  }
  for(const e of Object.values(map.entities ?? {})) {
    if(e.type==='image')e.usage='reference';
    if(e.type==='area'&&e.role==='water'&&e.name==='Ocean')e.waterKind='ocean';
    if(e.origin==='inherited') { delete e.genId; e.groupId='inherited';map.groups.inherited={name:'Inherited geography'}; }
    else if(e.genId&&map.generators[e.genId])e.groupId ??= map.generators[e.genId]!.groupId;
    if(e.type==='prop'&&['mountain','hill','forest','settlement'].includes(e.builtin??''))e.symbolKind=e.builtin as 'mountain'|'hill'|'forest'|'settlement';
  }
  return map as unknown as Record<string,unknown>;
} };

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
  const map = MapDocSchema.parse(migrated);
  restoreMissingLayers(map);
  return map;
}
