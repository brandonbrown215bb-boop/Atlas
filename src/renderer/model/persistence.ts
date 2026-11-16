import type { MapDoc, WorldMeta } from './schema';
import { worldStore } from './store';

const AUTOSAVE_DELAY_MS = 2000;
const RETRY_DELAY_MS = 10_000;
const BACKUP_INTERVAL_MS = 10 * 60 * 1000;

let saveTimer: number | null = null;
let backupTimer: number | null = null;
let changedSinceBackup = false;
let pendingSave: Promise<unknown> | null = null;

export async function flushDirtyWorld(): Promise<void> {
  if (pendingSave) {
    await pendingSave;
    return flushDirtyWorld();
  }
  const state = worldStore.getState();
  if (!state.world || !state.worldPath) {
    return;
  }

  const dirtyMapIds = Object.keys(state.dirtyMapIds);
  if (!state.dirtyWorld && dirtyMapIds.length === 0) {
    return;
  }

  const payload: { meta?: WorldMeta; maps?: Record<string, MapDoc> } = {};
  if (state.dirtyWorld) {
    payload.meta = state.world.meta;
  }
  if (dirtyMapIds.length > 0) {
    payload.maps = {};
    for (const mapId of dirtyMapIds) {
      const mapDoc = state.world.maps[mapId];
      if (mapDoc) {
        payload.maps[mapId] = mapDoc;
      }
    }
  }

  pendingSave = window.atlasApi.saveDirtyWorld(state.worldPath, payload);
  try {
    await pendingSave;
    const current = worldStore.getState();
    if(current.worldPath !== state.worldPath || current.world?.meta.id !== state.world.meta.id) return;
    worldStore.getState().markClean({
      world: Boolean(payload.meta) && current.world?.meta === payload.meta,
      mapIds: dirtyMapIds.filter(id => current.world?.maps[id] === state.world!.maps[id]),
    });
  } finally {
    pendingSave = null;
  }
}

export function startWorldPersistence(): () => void {
  const scheduleSave = (delay: number) => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      // Unsaved flags stay set on failure; retry, and rethrow so the error banner shows it.
      void flushDirtyWorld().catch((error: unknown) => {
        scheduleSave(RETRY_DELAY_MS);
        throw error;
      });
    }, delay);
  };
  const unsubscribe = worldStore.subscribe((state) => {
    const hasDirty =
      state.dirtyWorld || Object.keys(state.dirtyMapIds).length > 0;
    if (!hasDirty || !state.worldPath) {
      return;
    }

    changedSinceBackup = true;
    scheduleSave(AUTOSAVE_DELAY_MS);
  });

  backupTimer = window.setInterval(() => {
    const state = worldStore.getState();
    if (changedSinceBackup && state.worldPath) {
      changedSinceBackup = false;
      void flushDirtyWorld().then(() =>
        window.atlasApi.backupWorld(state.worldPath!),
      );
    }
  }, BACKUP_INTERVAL_MS);

  const onBeforeUnload = () => {
    void flushDirtyWorld();
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  window.atlasApi?.setBeforeCloseFlush?.(() => flushDirtyWorld());

  return () => {
    unsubscribe();
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (backupTimer !== null) {
      window.clearInterval(backupTimer);
      backupTimer = null;
    }
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.atlasApi?.setBeforeCloseFlush?.(null);
  };
}
