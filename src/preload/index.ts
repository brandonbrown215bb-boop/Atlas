import { contextBridge, ipcRenderer } from 'electron';

export interface AtlasApi {
  platform: NodeJS.Platform;
  closePopout: (frameName: string) => Promise<void>;
}

const api: AtlasApi = {
  platform: process.platform,
  closePopout: (frameName: string) => ipcRenderer.invoke('atlas:close-popout', frameName),
};

contextBridge.exposeInMainWorld('atlasApi', api);
