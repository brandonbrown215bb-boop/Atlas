import { copyAssetSet, forkWorldFolder, readTransferWorld, transferWorldFolders } from './transferFs';
import { TransferInputSchema, WorldDocumentSchema, usedAssets } from '../renderer/model/transfer';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { z } from 'zod';
import { basename, join, resolve } from 'node:path';
import { app, dialog, ipcMain, nativeImage, type BrowserWindow } from 'electron';
import type { MapDoc, WorldMeta } from '../renderer/model/schema';
import { PackLibrary } from './packs';
import type { AssetQuery } from '../renderer/model/packs';
import type { AssetTagOverride } from '../renderer/model/assetTags';
import { extractDungeondraft } from './dungeondraft';
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
  createWorld: (worldDir: string, name: string) => unknown;
  openWorld: (worldDir: string) => unknown;
  getPackRoots: () => string[];
}

export function registerWorldIpc(getMainWindow: () => BrowserWindow | null): WorldIpcState {
  let currentWorldDir: string | null = null;
  const userDataDir = () => app.getPath('userData');
  const library = new PackLibrary(userDataDir());
  const libraryReady = library.load();
  let importingPack = false;
  ipcMain.handle('atlas:pack-import', async (event, source?: string) => {
    await libraryReady;
    if (importingPack) throw new Error('A pack is already being imported.');
    if (!source) {
      const win = getMainWindow();
      const options = { title: 'Import Dungeondraft Pack', filters: [{name:'Dungeondraft packs',extensions:['dungeondraft_pack']}], properties:['openFile'] as Array<'openFile'> };
      const picked = win ? await dialog.showOpenDialog(win,options) : await dialog.showOpenDialog(options);
      if (picked.canceled || !picked.filePaths[0]) return null;
      source = picked.filePaths[0];
    }
    importingPack = true;
    try {
      const extracted = await extractDungeondraft(source, userDataDir(), (done,total) => {
        if (!event.sender.isDestroyed()) event.sender.send('atlas:packs-progress', { scanned:done,indexed:total,path:'Extracting pack' });
      });
      return await library.register(extracted.root, undefined, { name:extracted.name,pxPerSquare:256 });
    } finally { importingPack = false; }
  });
  ipcMain.handle('atlas:asset-search', async (_event, query: AssetQuery) => { await libraryReady; return library.search(query); });
  ipcMain.handle('atlas:asset-set-tags', async (_event, id: string, tags: AssetTagOverride) => {
    await libraryReady;
    return library.setAssetTags(id, tags);
  });
  ipcMain.handle('atlas:asset-use', async (_event, worldDir: string, id: string) => {
    await libraryReady;
    if (resolve(worldDir) !== currentWorldDir) throw new Error('The world is no longer open.');
    const { pack, asset, path } = library.findAsset(id);
    const info = await stat(path);
    if (info.size !== asset.size || info.mtimeMs !== asset.mtimeMs) throw new Error('Asset changed on disk. Reindex its folder first.');
    return { ...importImageAsset(worldDir, path, asset, { packName: pack.name, pxPerSquare: pack.pxPerSquare }),
      w: asset.width / pack.pxPerSquare * 1.524, h: asset.height / pack.pxPerSquare * 1.524, metersPerPixel: 1.524 / pack.pxPerSquare };
  });
  // Decode thumbnails one at a time, and reuse the disk cache next time.
  const thumbnailJobs = new Map<string, Promise<string>>();
  let thumbnailQueue = Promise.resolve();
  ipcMain.handle('atlas:asset-thumbnail', async (_event, id: string) => {
    await libraryReady;
    const { asset, path } = library.findAsset(id);
    const key = `${id}-${asset.size}-${asset.mtimeMs}`;
    let job = thumbnailJobs.get(key);
    if (!job) {
      job = thumbnailQueue.then(async () => {
        const target = join(userDataDir(), 'thumbnails', `${key}.png`);
        if (!existsSync(target)) {
          const image = await nativeImage.createThumbnailFromPath(path, { width: 96, height: 96 });
          if (image.isEmpty()) throw new Error('Cannot read image thumbnail.');
          await mkdir(join(userDataDir(), 'thumbnails'), { recursive: true });
          await writeFile(target, image.toPNG());
        }
        return `atlas-file://local/${target.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`;
      });
      thumbnailJobs.set(key, job);
      thumbnailQueue = job.then(() => undefined, () => undefined);
      void job.finally(() => thumbnailJobs.delete(key)).catch(() => {});
    }
    return job;
  });
  ipcMain.handle('atlas:packs-list', async () => { await libraryReady; return library.packs; });
  ipcMain.handle('atlas:packs-register', async (event, root: string) => {
    await libraryReady;
    return library.register(root, progress => {
      if (!event.sender.isDestroyed()) event.sender.send('atlas:packs-progress', progress);
    });
  });
  ipcMain.handle('atlas:packs-scale', async (_event, id: string, pxPerSquare: number) => {
    await libraryReady;
    return library.setScale(id, pxPerSquare);
  });

  const recordRecent = (loaded: LoadedWorld, worldDir: string): RecentWorldEntry[] => {
    return addRecentWorld(userDataDir(), {
      id: loaded.meta.id,
      name: loaded.meta.name,
      path: resolve(worldDir),
      lastOpenedAt: new Date().toISOString(),
    });
  };

  ipcMain.handle('atlas:transfer-read', (_event,path:string) => {
    const result=readTransferWorld(path);recordRecent(result.world,path);return result;
  });
  ipcMain.handle('atlas:linked-world-path', (_event,worldId:string) => readRecentWorlds(userDataDir()).find(w=>w.id===worldId&&existsSync(join(w.path,'world.json')))?.path ?? null);
  ipcMain.handle('atlas:sync-prepare', (_event,mapId:string,path:string,expectedMine:string,expectedTheirs:string) => {
    if(!currentWorldDir)throw new Error('No world is open');
    const mine=readTransferWorld(currentWorldDir),theirs=readTransferWorld(path),map=mine.world.maps[mapId];
    if(!map?.link || map.link.worldId!==theirs.world.meta.id)throw new Error('Choose the world this map is linked to.');
    const other=theirs.world.maps[map.link.mapId];
    if(!other || other.link?.worldId!==mine.world.meta.id || other.link.mapId!==map.id)throw new Error('The reciprocal linked map is missing.');
    if(JSON.stringify(map)!==expectedMine||JSON.stringify(other)!==expectedTheirs)throw new Error('A map changed since the sync preview. Preview again.');
    createBackup(currentWorldDir);
    copyAssetSet(path,currentWorldDir,usedAssets(theirs.world,[other.id]),theirs.assets,mine.assets);
    atomicWriteFile(join(currentWorldDir,'assets','index.json'),JSON.stringify(mine.assets,null,2));
    recordRecent(theirs.world,path);
    return {otherMap:other,otherWorldId:theirs.world.meta.id,assets:mine.assets};
  });
  ipcMain.handle('atlas:transfer-map', (_event,targetDir:string,input:unknown,expected:unknown) => {
    if(!currentWorldDir) throw new Error('No world is open');
    const result=transferWorldFolders(currentWorldDir,targetDir,TransferInputSchema.parse(input),WorldDocumentSchema.parse(expected));
    recordRecent({meta:readTransferWorld(targetDir).world.meta,maps:result.after.maps},targetDir);
    return result;
  });
  ipcMain.handle('atlas:world-fork', (_event,targetDir:string,name:string) => {
    if(!currentWorldDir) throw new Error('No world is open');
    const result=forkWorldFolder(currentWorldDir,targetDir,name);
    return {...result,recent:recordRecent(result,targetDir)};
  });

  ipcMain.handle('atlas:save-export', async (_event, name: string, extension: 'png'|'dd2vtt', data: string) => {
    z.enum(['png','dd2vtt']).parse(extension);
    z.string().max(400_000_000).parse(data);
    const options = { title:'Export map', defaultPath:`${String(name).replace(/[^a-zA-Z0-9 _-]/g,'_')}.${extension}`, filters:[{name:extension.toUpperCase(),extensions:[extension]}] };
    const win=getMainWindow();
    const result=win ? await dialog.showSaveDialog(win,options) : await dialog.showSaveDialog(options);
    if(result.canceled || !result.filePath) return null;
    await writeFile(`${result.filePath}.tmp`,extension==='png'?Buffer.from(data,'base64'):data);
    await rename(`${result.filePath}.tmp`,result.filePath);
    return result.filePath;
  });

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

  const doCreateWorld = (worldDir: string, name: string) => {
    const resolved = resolve(worldDir);
    const loaded = createWorldFolder(resolved, name);
    currentWorldDir = resolved;
    const recent = recordRecent(loaded, resolved);
    return { worldDir: resolved, ...loaded, recent, assetsIndex: {} };
  };

  const doOpenWorld = (worldDir: string) => {
    const resolved = resolve(worldDir);
    try {
      const loaded = openWorldFolder(resolved);
      currentWorldDir = resolved;
      const recent = recordRecent(loaded, resolved);
      const assetsIndex = readAssetsIndex(resolved);
      return { ok: true as const, worldDir: resolved, ...loaded, recent, assetsIndex };
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
  };

  ipcMain.handle(
    'atlas:world-create',
    (_event, worldDir: string, name: string) => doCreateWorld(worldDir, name),
  );

  ipcMain.handle('atlas:world-open', (_event, worldDir: string) =>
    doOpenWorld(worldDir),
  );

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

  ipcMain.handle('atlas:ui-layout-load', () => {
    const filePath = join(userDataDir(), 'ui-layout.json');
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    } catch {
      return null;
    }
  });

  ipcMain.handle('atlas:ui-layout-save', (_event, layout: unknown) => {
    mkdirSync(userDataDir(), { recursive: true });
    atomicWriteFile(join(userDataDir(), 'ui-layout.json'), JSON.stringify(layout, null, 2));
    return { ok: true };
  });

  // Read only the file chosen by the native dialog; the renderer supplies no path.
  ipcMain.handle('atlas:pick-svg', async () => {
    const win = getMainWindow();
    const options = {
      title: 'Import SVG',
      filters: [{ name: 'SVG drawings', extensions: ['svg'] }],
      properties: ['openFile'] as Array<'openFile'>,
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    if ((await stat(filePath)).size > 10 * 1024 * 1024) {
      throw new Error('SVG files must be smaller than 10 MB.');
    }
    return { name: basename(filePath), text: await readFile(filePath, 'utf8') };
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
    getPackRoots: () => library.packs.map(p => p.root),
    getCurrentWorldDir: () => currentWorldDir,
    createWorld: doCreateWorld,
    openWorld: doOpenWorld,
  };
}
