import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, dialog, ipcMain, nativeImage, type BrowserWindow } from 'electron';
import type { MapDoc, WorldMeta } from '../renderer/model/schema';
import {
  addRecentWorld,
  atomicWriteFile,
  createBackup,
  createWorldFolder,
  importImageAsset,
  listBackups,
  openWorldFolder,
  readAssetsIndex,
  readRecentWorlds,
  restoreFromBackup,
  saveDirtyWorldFiles,
  WorldParseError,
  type LoadedWorld,
  type RecentWorldEntry,
} from './worldFs';

export interface WorldIpcState {
  getCurrentWorldDir: () => string | null;
}

export function registerWorldIpc(getMainWindow: () => BrowserWindow | null): WorldIpcState {
  let currentWorldDir: string | null = null;
  const userDataDir = () => app.getPath('userData');

  const recordRecent = (loaded: LoadedWorld, worldDir: string): RecentWorldEntry[] => {
    return addRecentWorld(userDataDir(), {
      id: loaded.meta.id,
      name: loaded.meta.name,
      path: resolve(worldDir),
      lastOpenedAt: new Date().toISOString(),
    });
  };

  ipcMain.handle('atlas:pick-folder', async (_event, title?: string) => {
    const win = getMainWindow();
    const options = {
      title: title ?? 'Select World Folder',
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
    };
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (res.canceled || res.filePaths.length === 0) {
      return null;
    }
    return res.filePaths[0] ?? null;
  });

  ipcMain.handle(
    'atlas:world-create',
    (_event, worldDir: string, name: string) => {
      const resolved = resolve(worldDir);
      const loaded = createWorldFolder(resolved, name);
      currentWorldDir = resolved;
      const recent = recordRecent(loaded, resolved);
      return { worldDir: resolved, ...loaded, recent };
    },
  );

  ipcMain.handle('atlas:world-open', (_event, worldDir: string) => {
    const resolved = resolve(worldDir);
    try {
      const loaded = openWorldFolder(resolved);
      currentWorldDir = resolved;
      const recent = recordRecent(loaded, resolved);
      return { ok: true as const, worldDir: resolved, ...loaded, recent };
    } catch (err) {
      if (err instanceof WorldParseError) {
        return {
          ok: false as const,
          error: err.message,
          filePath: err.filePath,
          backups: err.backups,
        };
      }
      return {
        ok: false as const,
        error: (err as Error).message,
        backups: listBackups(resolved),
      };
    }
  });

  ipcMain.handle(
    'atlas:world-save-dirty',
    (
      _event,
      worldDir: string,
      payload: { meta?: WorldMeta; maps?: Record<string, MapDoc> },
    ) => {
      const resolved = resolve(worldDir);
      if (currentWorldDir !== resolved) {
        throw new Error('Cannot save to a world that is not currently open');
      }
      saveDirtyWorldFiles(resolved, payload);
      return { ok: true };
    },
  );

  ipcMain.handle('atlas:world-backup', (_event, worldDir: string) => {
    const resolved = resolve(worldDir);
    if (currentWorldDir !== resolved) {
      throw new Error('Cannot backup a world that is not currently open');
    }
    const backupName = createBackup(resolved, 20);
    return { backupName };
  });

  ipcMain.handle('atlas:world-list-backups', (_event, worldDir: string) => {
    return listBackups(resolve(worldDir));
  });

  ipcMain.handle(
    'atlas:world-restore-backup',
    (_event, worldDir: string, backupName: string) => {
      const resolved = resolve(worldDir);
      const loaded = restoreFromBackup(resolved, backupName);
      currentWorldDir = resolved;
      const recent = recordRecent(loaded, resolved);
      return { worldDir: resolved, ...loaded, recent };
    },
  );

  ipcMain.handle('atlas:world-recent-list', () => {
    return readRecentWorlds(userDataDir());
  });

  ipcMain.handle('atlas:layout-load', (_event, worldId: string) => {
    const safeId = worldId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = join(userDataDir(), 'layouts', `${safeId}.json`);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    } catch {
      return null;
    }
  });

  ipcMain.handle('atlas:layout-save', (_event, worldId: string, layout: unknown) => {
    const safeId = worldId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = join(userDataDir(), 'layouts');
    mkdirSync(dir, { recursive: true });
    atomicWriteFile(join(dir, `${safeId}.json`), JSON.stringify(layout, null, 2));
    return { ok: true };
  });

  ipcMain.handle('atlas:pick-image', async () => {
    const win = getMainWindow();
    const options = {
      title: 'Import Backdrop Image',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
      ],
      properties: ['openFile'] as Array<'openFile'>,
    };
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (res.canceled || res.filePaths.length === 0) {
      return null;
    }
    return res.filePaths[0] ?? null;
  });

  ipcMain.handle(
    'atlas:asset-import-image',
    (_event, worldDir: string, filePath: string) => {
      const resolvedWorld = resolve(worldDir);
      if (currentWorldDir !== resolvedWorld) {
        throw new Error('Cannot import asset into a world that is not open');
      }
      const img = nativeImage.createFromPath(filePath);
      const size = img.getSize();
      return importImageAsset(resolvedWorld, filePath, {
        width: size.width || 1000,
        height: size.height || 1000,
      });
    },
  );

  ipcMain.handle('atlas:asset-list', (_event, worldDir: string) => {
    return readAssetsIndex(resolve(worldDir));
  });

  return {
    getCurrentWorldDir: () => currentWorldDir,
  };
}
