import { createStore } from 'zustand/vanilla';
import { DungeonParamsSchema } from '../gen/dungeon/layout';
import { OutdoorParamsSchema } from '../gen/glade/outdoor';
import { WorldParamsSchema } from '../gen/world/world';
import { CityParamsSchema } from '../gen/city/city';
import { executeGeneration, prepareGeneration } from '../render/generationJob';
import { resolveTargetLayerId } from '../tools/types';
import { worldStore } from './store';
import { viewStore } from './viewStore';
import { navigateToMap } from './navigation';
import type { GenerationContext } from './generationContext';
import type { MapDoc } from './schema';

export interface GenerationDraft {
  seed: number;
  params: Record<string, any>;
  themeName: string;
  placeId?: string;
}
export interface SettingsTarget {
  worldId: string; mapId: string; panelId: string; key: string; mode: 'generation' | 'map';
}
export const generationState = createStore<{
  drafts: Record<string, GenerationDraft>;
  draftSignatures: Record<string, string>;
  siteTypes: Record<string, 'glade' | 'dungeon'>;
  settings: SettingsTarget | null;
  job: { mapId: string; panelId: string } | null;
  error: { mapId: string; message: string } | null;
}>(() => ({ drafts: {}, draftSignatures: {}, siteTypes: {}, settings: null, job: null, error: null }));

export function defaultGenerationDraft(map: MapDoc, context: GenerationContext): GenerationDraft {
  const schema = context.type === 'world' ? WorldParamsSchema : context.type === 'city' ? CityParamsSchema :
    context.type === 'glade' ? OutdoorParamsSchema : DungeonParamsSchema;
  const saved = context.kind === 'result' || context.kind === 'room' ? context.record : undefined;
  const area = map.entities[context.regionId ?? ''];
  return {
    seed: saved?.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!,
    params: schema.parse(saved ? { ...saved.params, ...(context.type === 'city' && area?.type === 'area' ? area.district : {}) } : {
      ...(context.type === 'world' ? { mode: context.mode } : {}),
      ...(context.type === 'dungeon' && map.kind === 'site' ? { mode: 'dungeon' } : {}),
      ...(context.type === 'city' && area?.type === 'area' ? area.district : {}),
    }),
    themeName: saved?.themeName ?? 'default',
  };
}
export function draftKey(worldId: string, mapId: string, context: GenerationContext) {
  return `${worldId}:${mapId}:${context.key}`;
}
export function selectGenerationResult(map: MapDoc, genId: string) {
  const record = map.generators[genId];
  if (!record) return;
  viewStore.setState({ activeTool: 'select', editParts: false, selectedEntityIds: Object.values(map.entities)
    .filter(e => e.genId === genId || e.groupId === (record.groupId ?? genId)).map(e => e.id) });
}

let controller: AbortController | null = null;
export function cancelGeneration() { controller?.abort(); }
export async function prepareTerrainUpgrade(map: MapDoc, context: GenerationContext, draft: GenerationDraft, panelId: string) {
  if (generationState.getState().job || !context.genId) return null;
  const abort = new AbortController();
  controller = abort;
  generationState.setState({ job: { mapId: map.id, panelId }, error: null });
  try {
    const preview = await prepareGeneration([{ name: 'map.repair', input: { mapId: map.id } },
      { name: 'generator.reroll', input: { mapId: map.id, genId: context.genId, seed: draft.seed,
        params: { ...draft.params, algorithmVersion: 2 }, themeName: draft.themeName } }], abort.signal);
    return abort.signal.aborted ? null : preview;
  } catch (error) {
    if (!abort.signal.aborted) generationState.setState({ error: { mapId: map.id, message: String(error) } });
    return null;
  } finally {
    controller = null;
    generationState.setState({ job: null });
  }
}
worldStore.subscribe((state, previous) => {
  if (state.world !== previous.world) generationState.setState({ error: null });
  if (state.activeMapId !== previous.activeMapId || state.world?.meta.id !== previous.world?.meta.id) {
    cancelGeneration();
    generationState.setState({ settings: null, error: null });
    if (state.world?.meta.id !== previous.world?.meta.id) generationState.setState({ drafts: {}, draftSignatures: {}, siteTypes: {} });
  }
});

export async function generateFromContext(map: MapDoc, context: GenerationContext, draft: GenerationDraft,
  panelId: string, action: 'generate' | 'another' | 'apply' | 'thin' | 'more' | 'reroll' | 'dressing' = 'generate') {
  if (generationState.getState().job) return;
  const worldId = worldStore.getState().world?.meta.id;
  if (!worldId || !context.type) return;
  const seed = action === 'another' ? ((context.record?.seed ?? draft.seed) + 1) >>> 0 : draft.seed;
  const params = { ...draft.params };
  // District profiles are saved on the footprint. Commit changed values with the result,
  // never while the user is just adjusting controls.
  const region = map.entities[context.regionId ?? ''];
  const commands: Array<{ name: string; input: unknown }> = [];
  if (context.type === 'city' && region?.type === 'area' && region.role === 'district') commands.push({ name: 'entity.update', input: {
    mapId: map.id, entityId: region.id, patch: { district: { density: params.density, wealth: params.wealth, activity: params.activity, access: params.access } },
  } });
  if (context.kind === 'building') commands.push({ name: 'map.generateInterior', input: {
    parentMapId: map.id, buildingId: context.regionId, placeId: draft.placeId,
    seed, params, themeName: draft.themeName, expectedParentRevision: map.revision,
  } });
  else if (context.kind === 'room' || ['thin', 'more', 'reroll'].includes(action)) commands.push({ name: 'generator.dressArea', input: {
    mapId: map.id, genId: context.genId, areaEntityId: context.regionId, action: action === 'generate' || action === 'apply' ? 'reroll' : action,
    seed: action === 'thin' ? seed : (seed + 1) >>> 0, params, themeName: draft.themeName,
  } });
  else if (context.genId) commands.push({ name: 'generator.reroll', input: {
    mapId: map.id, genId: context.genId, seed, params, themeName: draft.themeName, dressingOnly: action === 'dressing',
  } });
  else commands.push({ name: 'generator.run', input: {
    mapId: map.id, type: context.type, regionEntityId: context.regionId, entireMap: !context.regionId,
    seed, params, themeName: draft.themeName, layerId: resolveTargetLayerId(map, viewStore.getState().activeLayerId),
  } });
  controller = new AbortController();
  generationState.setState({ job: { mapId: map.id, panelId }, error: null });
  try {
    if (!context.genId && context.kind !== 'building' && !resolveTargetLayerId(map, viewStore.getState().activeLayerId)) {
      throw new Error('No visible, unlocked layer is available. Open Layers to choose one.');
    }
    const results = await executeGeneration(commands, controller.signal);
    const result = results.at(-1) as { id?: string; genId?: string } | undefined;
    const state = worldStore.getState();
    if (context.kind === 'building' && result?.id) {
      // Applying the result finished the job; navigation must not cancel a completed worker.
      controller = null;
      navigateToMap(result.id, panelId);
      viewStore.setState({ fitRequest: { panelId, nonce: Date.now() } });
      const child = state.world?.maps[result.id];
      if (child && result.genId) selectGenerationResult(child, result.genId);
    } else if (result?.genId && state.world?.maps[map.id]) selectGenerationResult(state.world.maps[map.id]!, result.genId);
    generationState.setState(s => ({ drafts: Object.fromEntries(Object.entries(s.drafts).filter(([key]) =>
      key !== draftKey(worldId, map.id, context))) }));
  } catch (error) {
    if (!controller?.signal.aborted) generationState.setState({ error: { mapId: map.id, message: String(error) } });
  } finally {
    controller = null;
    generationState.setState({ job: null });
  }
}
