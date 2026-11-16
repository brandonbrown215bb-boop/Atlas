import { geographicEntities } from '../geom/geography';
import { getEntityBounds } from '../geom/hitTest';
import { intersectsExplored, intersectsRevealed } from '../geom/fog';
import type { Entity, MapDoc } from './schema';

function isStructuralEntity(e: Entity): boolean {
  return (
    e.type === 'area' ||
    e.type === 'path' ||
    e.type === 'wall' ||
    e.type === 'door' ||
    (e.type === 'portal' && Boolean(e.connectorKind && e.connectorKind !== 'portal'))
  );
}

/** The only entities allowed into any player-facing render. Places and secret markers stay hidden. */
export function playerRenderList(map: MapDoc, labels = true): Entity[] {
  const layers = new Set(map.layers.filter((l) => l.visible && !l.gmOnly).map((l) => l.id));
  return geographicEntities(map)
    .filter(
      (e) =>
        layers.has(e.layerId) &&
        !e.gmOnly &&
        e.type !== 'place' &&
        !(e.type === 'portal' && (!e.connectorKind || e.connectorKind === 'portal')) &&
        !(e.type === 'door' && e.kind === 'secret') &&
        (labels || e.type !== 'label'),
    )
    .filter((e) => {
      const b = getEntityBounds(e);
      if (!b) return false;
      const rect = {
        x: b.minX,
        y: b.minY,
        w: Math.max(0.001, b.maxX - b.minX),
        h: Math.max(0.001, b.maxY - b.minY),
      };
      return isStructuralEntity(e)
        ? intersectsExplored(map, rect)
        : intersectsRevealed(map, rect);
    });
}
