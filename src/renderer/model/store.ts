import { enablePatches, produceWithPatches, type Patch } from 'immer';
import { createStore } from 'zustand/vanilla';
import {
  executeCommandOnDraft,
  type WorldDocument,
} from './commands';
import {
  applyHistoryRedo,
  applyHistoryUndo,
  createEmptyHistory,
  pushHistory,
  type HistoryState,
} from './history';
import type { MapDoc, WorldMeta } from './schema';

enablePatches();

export interface CommandCall {
  name: string;
  input: unknown;
}

export interface WorldStoreState {
  world: WorldDocument | null;
  worldPath: string | null;
  activeMapId: string | null;
  history: HistoryState;
  dirtyWorld: boolean;
  dirtyMapIds: Record<string, true>;

  loadWorld: (meta: WorldMeta, maps: Record<string, MapDoc>, worldPath?: string | null) => void;
  closeWorld: () => void;
  setActiveMap: (mapId: string | null) => void;
  execute: (name: string, input: unknown) => unknown;
  executeBatch: (calls: readonly CommandCall[], label?: string) => unknown[];
  undo: () => boolean;
  redo: () => boolean;
  markClean: (options?: { world?: boolean; mapIds?: string[] }) => void;
}

function collectTouchedFromPatches(patches: readonly Patch[]): {
  touchedMapIds: string[];
  worldMetaTouched: boolean;
} {
  const mapIds = new Set<string>();
  let worldMetaTouched = false;

  for (const patch of patches) {
    const [root, second] = patch.path;
    if (root === 'meta') {
      worldMetaTouched = true;
    } else if (root === 'maps' && typeof second === 'string') {
      mapIds.add(second);
    }
  }

  return {
    touchedMapIds: Array.from(mapIds),
    worldMetaTouched,
  };
}

export function createWorldStore() {
  return createStore<WorldStoreState>((set, get) => ({
    world: null,
    worldPath: null,
    activeMapId: null,
    history: createEmptyHistory(),
    dirtyWorld: false,
    dirtyMapIds: {},

    loadWorld(meta, maps, worldPath = null) {
      const firstMapId = meta.maps[0]?.id ?? Object.keys(maps)[0] ?? null;
      set({
        world: { meta, maps },
        worldPath,
        activeMapId: firstMapId,
        history: createEmptyHistory(),
        dirtyWorld: false,
        dirtyMapIds: {},
      });
    },

    closeWorld() {
      set({
        world: null,
        worldPath: null,
        activeMapId: null,
        history: createEmptyHistory(),
        dirtyWorld: false,
        dirtyMapIds: {},
      });
    },

    setActiveMap(mapId) {
      set({ activeMapId: mapId });
    },

    execute(name, input) {
      const [result] = get().executeBatch([{ name, input }], name);
      return result;
    },

    executeBatch(calls, label) {
      const state = get();
      if (!state.world) {
        throw new Error('No world is open');
      }
      if (calls.length === 0) {
        return [];
      }

      const results: unknown[] = [];
      const [nextWorld, patches, inversePatches] = produceWithPatches(
        state.world,
        (draft) => {
          for (const call of calls) {
            results.push(executeCommandOnDraft(draft, call.name, call.input));
          }
        },
      );

      if (patches.length === 0) {
        return results;
      }

      const { touchedMapIds, worldMetaTouched } = collectTouchedFromPatches(patches);
      const nextDirtyMaps = { ...state.dirtyMapIds };
      for (const mapId of touchedMapIds) {
        nextDirtyMaps[mapId] = true;
      }

      set({
        world: nextWorld,
        history: pushHistory(state.history, {
          label: label ?? calls.map((c) => c.name).join(', '),
          patches,
          inversePatches,
          touchedMapIds,
          worldMetaTouched,
        }),
        dirtyWorld: state.dirtyWorld || worldMetaTouched,
        dirtyMapIds: nextDirtyMaps,
      });

      return results;
    },

    undo() {
      const state = get();
      if (!state.world) {
        return false;
      }
      const { state: nextWorld, history, entry } = applyHistoryUndo(
        state.world,
        state.history,
      );
      if (!entry) {
        return false;
      }

      const nextDirtyMaps = { ...state.dirtyMapIds };
      for (const mapId of entry.touchedMapIds) {
        nextDirtyMaps[mapId] = true;
      }

      set({
        world: nextWorld,
        history,
        dirtyWorld: state.dirtyWorld || entry.worldMetaTouched,
        dirtyMapIds: nextDirtyMaps,
      });
      return true;
    },

    redo() {
      const state = get();
      if (!state.world) {
        return false;
      }
      const { state: nextWorld, history, entry } = applyHistoryRedo(
        state.world,
        state.history,
      );
      if (!entry) {
        return false;
      }

      const nextDirtyMaps = { ...state.dirtyMapIds };
      for (const mapId of entry.touchedMapIds) {
        nextDirtyMaps[mapId] = true;
      }

      set({
        world: nextWorld,
        history,
        dirtyWorld: state.dirtyWorld || entry.worldMetaTouched,
        dirtyMapIds: nextDirtyMaps,
      });
      return true;
    },

    markClean(options) {
      const state = get();
      if (!options) {
        set({ dirtyWorld: false, dirtyMapIds: {} });
        return;
      }
      const nextDirtyMaps = { ...state.dirtyMapIds };
      if (options.mapIds) {
        for (const id of options.mapIds) {
          delete nextDirtyMaps[id];
        }
      }
      set({
        dirtyWorld: options.world ? false : state.dirtyWorld,
        dirtyMapIds: nextDirtyMaps,
      });
    },
  }));
}

export const worldStore = createWorldStore();
