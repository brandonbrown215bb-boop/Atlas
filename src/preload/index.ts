import { contextBridge } from 'electron';

export interface AtlasApi {
  platform: NodeJS.Platform;
}

const api: AtlasApi = {
  platform: process.platform,
};

contextBridge.exposeInMainWorld('atlasApi', api);
