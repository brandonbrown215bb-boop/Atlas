import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { migrateMapData, migrateWorldData } from '../renderer/model/migrate';
import {
  AssetsIndexSchema,
  MapDocSchema,
  WorldMetaSchema,
  type AssetsIndex,
  type MapDoc,
  type WorldMeta,
} from '../renderer/model/schema';

export class WorldParseError extends Error {
  readonly filePath: string;
  readonly backups: string[];

  constructor(message: string, filePath: string, backups: string[]) {
    super(message);
    this.name = 'WorldParseError';
    this.filePath = filePath;
    this.backups = backups;
  }
}

export interface LoadedWorld {
  meta: WorldMeta;
  maps: Record<string, MapDoc>;
}

export interface RecentWorldEntry {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
}

/**
 * Atomically writes UTF-8 text to `targetPath` via `<targetPath>.tmp` + rename.
 */
export function atomicWriteFile(targetPath: string, content: string): void {
  const resolved = resolve(targetPath);
  const tmpPath = `${resolved}.tmp`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, resolved);
}

function formatBackupTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function listBackups(worldDir: string): string[] {
  const backupsDir = join(worldDir, 'backups');
  if (!existsSync(backupsDir)) {
    return [];
  }
  return readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
}

export function createBackup(worldDir: string, maxBackups = 20): string {
  const backupsDir = join(worldDir, 'backups');
  mkdirSync(backupsDir, { recursive: true });

  const baseName = formatBackupTimestamp();
  let backupName = baseName;
  let suffix = 1;
  while (existsSync(join(backupsDir, backupName))) {
    backupName = `${baseName}-${suffix}`;
    suffix += 1;
  }

  const targetDir = join(backupsDir, backupName);
  const targetMapsDir = join(targetDir, 'maps');
  mkdirSync(targetMapsDir, { recursive: true });

  const worldJsonPath = join(worldDir, 'world.json');
  if (existsSync(worldJsonPath)) {
    copyFileSync(worldJsonPath, join(targetDir, 'world.json'));
  }

  const mapsDir = join(worldDir, 'maps');
  if (existsSync(mapsDir)) {
    for (const file of readdirSync(mapsDir)) {
      if (file.endsWith('.json')) {
        copyFileSync(join(mapsDir, file), join(targetMapsDir, file));
      }
    }
  }

  const allBackups = listBackups(worldDir);
  for (const oldBackup of allBackups.slice(maxBackups)) {
    rmSync(join(backupsDir, oldBackup), { recursive: true, force: true });
  }

  return backupName;
}

export function createWorldFolder(worldDir: string, name: string): LoadedWorld {
  const resolvedDir = resolve(worldDir);
  mkdirSync(join(resolvedDir, 'maps'), { recursive: true });
  mkdirSync(join(resolvedDir, 'assets'), { recursive: true });
  mkdirSync(join(resolvedDir, 'backups'), { recursive: true });

  const worldId = crypto.randomUUID();
  const mapId = 'map-1';

  const meta = WorldMetaSchema.parse({
    formatVersion: 1,
    id: worldId,
    name: name.trim() || 'Untitled World',
    maps: [{ id: mapId, name: 'Overworld', kind: 'world' }],
    themes: { default: {} },
  });

  const initialMap = MapDocSchema.parse({
    formatVersion: 1,
    id: mapId,
    name: 'Overworld',
    kind: 'world',
    bounds: { x: 0, y: 0, w: 5000, h: 5000 },
    grid: { size: 100, visible: false },
    layers: [
      {
        id: 'layer-base',
        name: 'Base',
        visible: true,
        locked: false,
        gmOnly: false,
      },
    ],
    entities: {},
    generators: {},
    revision: 1,
    deleted: {},
    fog: { enabled: false, revealed: [] },
  });

  atomicWriteFile(join(resolvedDir, 'world.json'), JSON.stringify(meta, null, 2));
  atomicWriteFile(
    join(resolvedDir, 'maps', `${mapId}.json`),
    JSON.stringify(initialMap, null, 2),
  );
  atomicWriteFile(join(resolvedDir, 'assets', 'index.json'), JSON.stringify({}, null, 2));

  return {
    meta,
    maps: { [mapId]: initialMap },
  };
}

function readAndParseWorld(worldDir: string, backupDirForErrors: string): LoadedWorld {
  const worldPath = join(worldDir, 'world.json');
  const backups = listBackups(backupDirForErrors);

  let rawWorld: unknown;
  try {
    rawWorld = JSON.parse(readFileSync(worldPath, 'utf-8'));
  } catch (err) {
    throw new WorldParseError(
      `Failed to read world.json: ${(err as Error).message}`,
      worldPath,
      backups,
    );
  }

  let meta: WorldMeta;
  try {
    meta = migrateWorldData(rawWorld);
  } catch (err) {
    throw new WorldParseError(
      `Failed to parse world.json: ${(err as Error).message}`,
      worldPath,
      backups,
    );
  }

  const maps: Record<string, MapDoc> = {};
  for (const summary of meta.maps) {
    const mapPath = join(worldDir, 'maps', `${summary.id}.json`);
    let rawMap: unknown;
    try {
      rawMap = JSON.parse(readFileSync(mapPath, 'utf-8'));
    } catch (err) {
      throw new WorldParseError(
        `Failed to read map ${summary.id}: ${(err as Error).message}`,
        mapPath,
        backups,
      );
    }

    try {
      maps[summary.id] = migrateMapData(rawMap);
    } catch (err) {
      throw new WorldParseError(
        `Failed to parse map ${summary.id}: ${(err as Error).message}`,
        mapPath,
        backups,
      );
    }
  }

  return { meta, maps };
}

export function openWorldFolder(worldDir: string): LoadedWorld {
  const resolvedDir = resolve(worldDir);
  const loaded = readAndParseWorld(resolvedDir, resolvedDir);
  createBackup(resolvedDir);
  return loaded;
}

export function saveDirtyWorldFiles(
  worldDir: string,
  payload: { meta?: WorldMeta; maps?: Record<string, MapDoc> },
): void {
  const resolvedDir = resolve(worldDir);
  if (payload.meta) {
    const validatedMeta = WorldMetaSchema.parse(payload.meta);
    atomicWriteFile(
      join(resolvedDir, 'world.json'),
      JSON.stringify(validatedMeta, null, 2),
    );
  }
  if (payload.maps) {
    mkdirSync(join(resolvedDir, 'maps'), { recursive: true });
    for (const [mapId, mapDoc] of Object.entries(payload.maps)) {
      const validatedMap = MapDocSchema.parse(mapDoc);
      atomicWriteFile(
        join(resolvedDir, 'maps', `${mapId}.json`),
        JSON.stringify(validatedMap, null, 2),
      );
    }
  }
}

export function restoreFromBackup(worldDir: string, backupName: string): LoadedWorld {
  const resolvedDir = resolve(worldDir);
  const backupDir = join(resolvedDir, 'backups', backupName);
  if (!existsSync(backupDir)) {
    throw new Error(`Backup not found: ${backupName}`);
  }

  // Validate backup completely before touching live files
  const loaded = readAndParseWorld(backupDir, resolvedDir);

  atomicWriteFile(
    join(resolvedDir, 'world.json'),
    JSON.stringify(loaded.meta, null, 2),
  );
  mkdirSync(join(resolvedDir, 'maps'), { recursive: true });
  for (const [mapId, mapDoc] of Object.entries(loaded.maps)) {
    atomicWriteFile(
      join(resolvedDir, 'maps', `${mapId}.json`),
      JSON.stringify(mapDoc, null, 2),
    );
  }

  return loaded;
}

export function readRecentWorlds(userDataDir: string): RecentWorldEntry[] {
  const filePath = join(userDataDir, 'recent-worlds.json');
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is RecentWorldEntry =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.path === 'string' &&
        typeof item.lastOpenedAt === 'string',
    );
  } catch {
    return [];
  }
}

export function addRecentWorld(
  userDataDir: string,
  entry: RecentWorldEntry,
): RecentWorldEntry[] {
  mkdirSync(userDataDir, { recursive: true });
  const existing = readRecentWorlds(userDataDir).filter(
    (item) => resolve(item.path) !== resolve(entry.path),
  );
  const updated = [entry, ...existing].slice(0, 20);
  atomicWriteFile(
    join(userDataDir, 'recent-worlds.json'),
    JSON.stringify(updated, null, 2),
  );
  return updated;
}

export function readAssetsIndex(worldDir: string): AssetsIndex {
  const indexPath = join(resolve(worldDir), 'assets', 'index.json');
  if (!existsSync(indexPath)) {
    return {};
  }
  try {
    const raw = JSON.parse(readFileSync(indexPath, 'utf-8'));
    return AssetsIndexSchema.parse(raw);
  } catch {
    return {};
  }
}

export function importImageAsset(
  worldDir: string,
  sourceFilePath: string,
  dimensions: { width: number; height: number },
): { assetId: string; index: AssetsIndex } {
  const resolvedWorld = resolve(worldDir);
  const resolvedSrc = resolve(sourceFilePath);
  const buf = readFileSync(resolvedSrc);
  const sha1 = createHash('sha1').update(buf).digest('hex');
  const ext = extname(resolvedSrc).replace(/^\./, '').toLowerCase() || 'png';

  const assetsDir = join(resolvedWorld, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const targetPath = join(assetsDir, `${sha1}.${ext}`);
  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, buf);
  }

  const index = readAssetsIndex(resolvedWorld);
  index[sha1] = {
    originalName: basename(resolvedSrc),
    packName: 'imported',
    pxPerSquare: 200,
    width: Math.max(1, dimensions.width),
    height: Math.max(1, dimensions.height),
    ext,
  };
  atomicWriteFile(join(assetsDir, 'index.json'), JSON.stringify(index, null, 2));

  return { assetId: sha1, index };
}
