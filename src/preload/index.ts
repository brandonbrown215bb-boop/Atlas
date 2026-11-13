import { contextBridge, ipcRenderer } from 'electron';
import type { AssetsIndex, MapDoc, WorldMeta } from '../renderer/model/schema';

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
