import type { MapDoc, WorldMeta } from './schema';
import { worldStore } from './store';

const AUTOSAVE_DELAY_MS = 2000;
const BACKUP_INTERVAL_MS = 10 * 60 * 1000;

let saveTimer: number | null = null;
let backupTimer: number | null = null;
let changedSinceBackup = false;
let saving = false;

export async function flushDirtyWorld(): Promise<void> {
  if (saving) {
    return;
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

  saving = true;
  try {
    await window.atlasApi.saveDirtyWorld(state.worldPath, payload);
    worldStore.getState().markClean({
      world: Boolean(payload.meta),
      mapIds: dirtyMapIds,
    });
  } finally {
    saving = false;
  }
}

export function startWorldPersistence(): () => void {
  const unsubscribe = worldStore.subscribe((state) => {
    const hasDirty =
      state.dirtyWorld || Object.keys(state.dirtyMapIds).length > 0;
    if (!hasDirty || !state.worldPath) {
      return;
    }

    changedSinceBackup = true;
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void flushDirtyWorld();
    }, AUTOSAVE_DELAY_MS);
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
  };
}
