import { getEntityBounds } from '../geom/hitTest';
import { intersectsRevealed } from '../geom/fog';
import type { Entity, MapDoc } from './schema';

/** The only entities allowed into any player-facing render. Places contain private notes. */
export function playerRenderList(map: MapDoc, labels = true): Entity[] {
  const layers = new Set(map.layers.filter(l => l.visible && !l.gmOnly).map(l => l.id));
  return Object.values(map.entities).filter(e => layers.has(e.layerId) && !e.gmOnly &&
    e.type !== 'place' && e.type !== 'portal' && !(e.type === 'door' && e.kind === 'secret') &&
    (labels || e.type !== 'label')).filter(e => {
      const b = getEntityBounds(e);
      return b && intersectsRevealed(map, { x:b.minX,y:b.minY,w:Math.max(0.001,b.maxX-b.minX),h:Math.max(0.001,b.maxY-b.minY) });
    });
}
