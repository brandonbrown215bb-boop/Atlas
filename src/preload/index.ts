import { contextBridge, ipcRenderer } from 'electron';
import type { AssetsIndex, MapDoc, WorldMeta } from '../renderer/model/schema';
import type { Pack, PackProgress, AssetQuery, AssetPage } from '../renderer/model/packs';

export interface RecentWorldInfo {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
}

export interface WorldActionResult {
  worldDir: string;
  meta: WorldMeta;
  maps: Record<string, MapDoc>;
  recent: RecentWorldInfo[];
}

export type OpenWorldResult =
  | ({ ok: true } & WorldActionResult)
  | { ok: false; error: string; filePath?: string; backups: string[] };

export interface AgentServerInfo {
  enabled: boolean;
  url: string;
  token: string;
}

export interface AtlasApi {
  linkedWorldPath: (worldId: string) => Promise<string | null>;
  prepareLinkedSync: (mapId: string, path: string, expectedMine: string, expectedTheirs: string) => Promise<{otherMap:MapDoc;otherWorldId:string;assets:AssetsIndex}>;

  readTransferWorld: (path: string) => Promise<{world:import('../renderer/model/commands').WorldDocument;assets:AssetsIndex}>;
  transferMap: (targetDir: string, input: import('../renderer/model/transfer').TransferInput, expected: import('../renderer/model/commands').WorldDocument) => Promise<{before:import('../renderer/model/commands').WorldDocument;after:import('../renderer/model/commands').WorldDocument;mapId:string;targetWorldId:string}>;
  forkWorld: (targetDir: string, name: string) => Promise<WorldActionResult>;

  saveExport: (name: string, extension: 'png' | 'dd2vtt', data: string) => Promise<string | null>;
  listDisplays: () => Promise<Array<{ id: number; label: string }>>;
  playerFullscreen: (displayId: number | null) => Promise<void>;
  importDungeondraftPack: (source?: string) => Promise<Pack[] | null>;
  usePackAsset: (worldDir: string, id: string) => Promise<{ assetId: string; index: AssetsIndex; w: number; h: number; metersPerPixel: number }>;
  searchAssets: (query: AssetQuery) => Promise<AssetPage>;
  getAssetThumbnail: (id: string) => Promise<string>;
  listPacks: () => Promise<Pack[]>;
  registerPack: (root: string) => Promise<Pack[]>;
  setPackScale: (id: string, pxPerSquare: number) => Promise<Pack[]>;
  onPackProgress: (handler: (progress: PackProgress) => void) => () => void;
  platform: NodeJS.Platform;
  closePopout: (frameName: string) => Promise<void>;
  pickFolder: (title?: string) => Promise<string | null>;
  createWorld: (worldDir: string, name: string) => Promise<WorldActionResult>;
  openWorld: (worldDir: string) => Promise<OpenWorldResult>;
  saveDirtyWorld: (
    worldDir: string,
    payload: { meta?: WorldMeta; maps?: Record<string, MapDoc> },
  ) => Promise<{ ok: boolean }>;
  backupWorld: (worldDir: string) => Promise<{ backupName: string }>;
  listBackups: (worldDir: string) => Promise<string[]>;
  restoreBackup: (worldDir: string, backupName: string) => Promise<WorldActionResult>;
  listRecentWorlds: () => Promise<RecentWorldInfo[]>;
  loadLayout: (worldId: string) => Promise<unknown | null>;
  saveLayout: (worldId: string, layout: unknown) => Promise<{ ok: boolean }>;
  pickImage: () => Promise<string | null>;
  pickSvg: () => Promise<{ name: string; text: string } | null>;
  importImageAsset: (
    worldDir: string,
    filePath: string,
  ) => Promise<{ assetId: string; index: AssetsIndex }>;
  listWorldAssets: (worldDir: string) => Promise<AssetsIndex>;
  getAgentInfo: () => Promise<AgentServerInfo>;
  setAgentEnabled: (enabled: boolean) => Promise<AgentServerInfo>;
  onAgentCall: (
    handler: (
      reqId: string,
      method: string,
      params: Record<string, unknown>,
    ) => void,
  ) => () => void;
  sendAgentReply: (
    reqId: string,
    payload: { ok: boolean; result?: unknown; error?: string },
  ) => void;
}

const api: AtlasApi = {
  linkedWorldPath: worldId => ipcRenderer.invoke('atlas:linked-world-path',worldId),
  prepareLinkedSync: (mapId,path,expectedMine,expectedTheirs) => ipcRenderer.invoke('atlas:sync-prepare',mapId,path,expectedMine,expectedTheirs),

  readTransferWorld: path => ipcRenderer.invoke('atlas:transfer-read', path),
  transferMap: (targetDir,input,expected) => ipcRenderer.invoke('atlas:transfer-map',targetDir,input,expected),
  forkWorld: (targetDir,name) => ipcRenderer.invoke('atlas:world-fork',targetDir,name),

  saveExport: (name, extension, data) => ipcRenderer.invoke('atlas:save-export', name, extension, data),
  listDisplays: () => ipcRenderer.invoke('atlas:displays'),
  playerFullscreen: id => ipcRenderer.invoke('atlas:player-fullscreen', id),
  importDungeondraftPack: source => ipcRenderer.invoke('atlas:pack-import', source),
  usePackAsset: (worldDir, id) => ipcRenderer.invoke('atlas:asset-use', worldDir, id),
  searchAssets: query => ipcRenderer.invoke('atlas:asset-search', query),
  getAssetThumbnail: id => ipcRenderer.invoke('atlas:asset-thumbnail', id),
  listPacks: () => ipcRenderer.invoke('atlas:packs-list'),
  registerPack: root => ipcRenderer.invoke('atlas:packs-register', root),
  setPackScale: (id, pxPerSquare) => ipcRenderer.invoke('atlas:packs-scale', id, pxPerSquare),
  onPackProgress: handler => {
    const listener = (_event: Electron.IpcRendererEvent, progress: PackProgress) => handler(progress);
    ipcRenderer.on('atlas:packs-progress', listener);
    return () => ipcRenderer.removeListener('atlas:packs-progress', listener);
  },
  platform: process.platform,
  closePopout: (frameName: string) => ipcRenderer.invoke('atlas:close-popout', frameName),
  pickFolder: (title?: string) => ipcRenderer.invoke('atlas:pick-folder', title),
  createWorld: (worldDir: string, name: string) =>
    ipcRenderer.invoke('atlas:world-create', worldDir, name),
  openWorld: (worldDir: string) => ipcRenderer.invoke('atlas:world-open', worldDir),
  saveDirtyWorld: (worldDir, payload) =>
    ipcRenderer.invoke('atlas:world-save-dirty', worldDir, payload),
  backupWorld: (worldDir: string) => ipcRenderer.invoke('atlas:world-backup', worldDir),
  listBackups: (worldDir: string) =>
    ipcRenderer.invoke('atlas:world-list-backups', worldDir),
  restoreBackup: (worldDir: string, backupName: string) =>
    ipcRenderer.invoke('atlas:world-restore-backup', worldDir, backupName),
  listRecentWorlds: () => ipcRenderer.invoke('atlas:world-recent-list'),
  loadLayout: (worldId: string) => ipcRenderer.invoke('atlas:layout-load', worldId),
  saveLayout: (worldId: string, layout: unknown) =>
    ipcRenderer.invoke('atlas:layout-save', worldId, layout),
  pickImage: () => ipcRenderer.invoke('atlas:pick-image'),
  pickSvg: () => ipcRenderer.invoke('atlas:pick-svg'),
  importImageAsset: (worldDir: string, filePath: string) =>
    ipcRenderer.invoke('atlas:asset-import-image', worldDir, filePath),
  listWorldAssets: (worldDir: string) =>
    ipcRenderer.invoke('atlas:asset-list', worldDir),
  getAgentInfo: () => ipcRenderer.invoke('atlas:agent-info'),
  setAgentEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('atlas:agent-set-enabled', enabled),
  onAgentCall: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      reqId: string,
      method: string,
      params: Record<string, unknown>,
    ) => {
      handler(reqId, method, params);
    };
    ipcRenderer.on('atlas:agent-call', listener);
    return () => ipcRenderer.removeListener('atlas:agent-call', listener);
  },
  sendAgentReply: (reqId, payload) => {
    ipcRenderer.send('atlas:agent-reply', reqId, payload);
  },
};

contextBridge.exposeInMainWorld('atlasApi', api);
