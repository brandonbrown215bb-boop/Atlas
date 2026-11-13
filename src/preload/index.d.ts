import type { AtlasApi } from './index';

declare global {
  interface Window {
    atlasApi: AtlasApi;
  }
}

export {};
