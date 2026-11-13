import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addRecentWorld,
  atomicWriteFile,
  createBackup,
  createWorldFolder,
  listBackups,
  openWorldFolder,
  readRecentWorlds,
  restoreFromBackup,
  saveDirtyWorldFiles,
  WorldParseError,
} from './worldFs';

describe('P1.2 worldFs', () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-world-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes files atomically without leaving .tmp behind', () => {
    const dir = makeTempDir();
    const target = join(dir, 'test.json');
    atomicWriteFile(target, '{"ok":true}');
    expect(readFileSync(target, 'utf-8')).toBe('{"ok":true}');
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('rotates backups to keep at most 20 newest', () => {
    const worldDir = join(makeTempDir(), 'MyWorld');
    createWorldFolder(worldDir, 'MyWorld');

    for (let i = 0; i < 25; i++) {
      createBackup(worldDir, 20);
    }

    const backups = listBackups(worldDir);
    expect(backups).toHaveLength(20);
  });

  it('refuses to overwrite a corrupt file on open and offers backups to restore', () => {
    const worldDir = join(makeTempDir(), 'CorruptWorld');
    const created = createWorldFolder(worldDir, 'CorruptWorld');
    const backupName = createBackup(worldDir);

    const corruptContent = '{ "not": "valid world" ';
    writeFileSync(join(worldDir, 'world.json'), corruptContent, 'utf-8');

    expect(() => openWorldFolder(worldDir)).toThrow(WorldParseError);
    // Corrupt file must NOT be overwritten
    expect(readFileSync(join(worldDir, 'world.json'), 'utf-8')).toBe(corruptContent);

    // Restore from backup recovers valid world
    const restored = restoreFromBackup(worldDir, backupName);
    expect(restored.meta.id).toBe(created.meta.id);
    expect(restored.maps['map-1']).toBeDefined();
  });

  it('saves dirty map files and updates recent worlds', () => {
    const base = makeTempDir();
    const worldDir = join(base, 'SavedWorld');
    const userDataDir = join(base, 'userData');
    const created = createWorldFolder(worldDir, 'SavedWorld');

    const map = created.maps['map-1']!;
    map.entities['label-1'] = {
      id: 'label-1',
      type: 'label',
      layerId: 'layer-base',
      origin: 'manual',
      rev: 2,
      text: 'Capital',
      x: 500,
      y: 500,
      size: 24,
    };
    map.revision = 2;

    saveDirtyWorldFiles(worldDir, { maps: { 'map-1': map } });
    const reopened = openWorldFolder(worldDir);
    expect(reopened.maps['map-1']?.entities['label-1']).toBeDefined();

    addRecentWorld(userDataDir, {
      id: created.meta.id,
      name: created.meta.name,
      path: worldDir,
      lastOpenedAt: new Date().toISOString(),
    });
    const recent = readRecentWorlds(userDataDir);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.path).toBe(worldDir);
  });
});
