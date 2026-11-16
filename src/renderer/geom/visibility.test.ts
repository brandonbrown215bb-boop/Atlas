import { expect, it } from 'vitest';
import { EntitySchema, type Entity } from '../model/schema';
import { collectLightBlockers } from './visibility';

const wall = EntitySchema.parse({ id: 'w', type: 'wall', layerId: 'l', origin: 'manual', rev: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], blocksMove: true, blocksSight: true });
const door = (open: boolean): Entity => EntitySchema.parse({ id: 'd', type: 'door', layerId: 'l', origin: 'manual', rev: 0, a: { x: 4, y: 0 }, b: { x: 6, y: 0 }, kind: 'door', open });

it('an open door leaves a gap in the wall under it; a closed door blocks', () => {
  expect(collectLightBlockers([wall, door(true)])).toEqual([
    { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
    { a: { x: 6, y: 0 }, b: { x: 10, y: 0 } },
  ]);
  expect(collectLightBlockers([wall, door(false)])).toEqual([
    { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    { a: { x: 4, y: 0 }, b: { x: 6, y: 0 } },
  ]);
});
