import { viewStore } from '../model/viewStore';
import { executeAssetCommands } from '../assets/commands';
import { snapPointToGrid } from '../geom/simplify';
import { resolveTargetLayerId, type MapTool } from './types';

export function createPropTool(): MapTool {
  let busy = false;
  return {
    id: 'prop',
    onPointerDown(pt, e, ctx) {
      if (e.button !== 0 || busy) return false;
      const vs = viewStore.getState();
      const layerId = resolveTargetLayerId(ctx.map, vs.activeLayerId);
      if (!layerId || !vs.selectedPackAssetId) {
        viewStore.setState({ assetError: 'Choose an asset in Assets and an unlocked layer.' });
        return false;
      }
      const pos = vs.snapToGrid ? snapPointToGrid(pt, ctx.map.grid.size) : pt;
      busy = true;
      void executeAssetCommands([{ name: 'prop.stamp', input: { mapId: ctx.map.id, layerId, packAssetId: vs.selectedPackAssetId,
        ...pos, scale: vs.propScale, rotation: vs.propRotation * Math.PI / 180, flipX: vs.propFlipX } }], 'Stamp prop')
        .then(results => { ctx.setSelectedIds([(results[0] as { id: string }).id]); viewStore.setState({ assetError: '' }); })
        .catch(e => viewStore.setState({ assetError: String(e) }))
        .finally(() => { busy = false; ctx.requestRedraw(); });
      return true;
    },
    onPointerMove() {}, onPointerUp() {}, onKey() { return false; }, drawOverlay() {},
  };
}
