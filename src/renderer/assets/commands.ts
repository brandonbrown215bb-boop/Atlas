import { getCommand } from '../model/commands';
import { worldStore, type CommandCall } from '../model/store';
import { viewStore } from '../model/viewStore';

// Resolve copy-on-use before the synchronous, undoable world command.
export async function executeAssetCommands(calls: readonly CommandCall[], label?: string): Promise<unknown[]> {
  const state = worldStore.getState();
  if (!state.world || !state.worldPath) throw new Error('Open a world first.');
  const worldId = state.world.meta.id;
  const parsed = calls.map(c => {
    const command = getCommand(c.name);
    if (!command) throw new Error(`Unknown command: ${c.name}`);
    return { ...c, input: command.input.parse(c.input) as Record<string, unknown> };
  });
  for (const call of parsed) {
    const id = call.input.packAssetId;
    if (!['prop.stamp','entity.setTexture'].includes(call.name) || typeof id !== 'string' || call.input.clear) continue;
    const result = await window.atlasApi.usePackAsset(state.worldPath, id);
    if (worldStore.getState().world?.meta.id !== worldId) throw new Error('The open world changed.');
    viewStore.getState().setAssetsIndex(result.index);
    call.input = { ...call.input, assetId: result.assetId,
      w: call.input.w ?? result.w, h: call.input.h ?? result.h, metersPerPixel: call.input.metersPerPixel ?? result.metersPerPixel };
  }
  if (worldStore.getState().world?.meta.id !== worldId) throw new Error('The open world changed.');
  return worldStore.getState().executeBatch(parsed, label);
}
