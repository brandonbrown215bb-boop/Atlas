import { describe, expect, it } from 'vitest';
import type { Entity } from '../model/schema';
import {
  booleanAreaRings,
  deleteVertexPatch,
  findNearestSegment,
  findNearestVertex,
  insertVertexPatch,
  moveVertexPatch,
} from './pointEdit';
import { applyEntityPatch } from './transform';

const squareArea: Entity = {
  id: 'a1',
  layerId: 'l1',
  origin: 'manual',
  rev: 1,
  type: 'area',
  role: 'land',
  rings: [
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
  ],
};

describe('geom pointEdit', () => {
  it('finds vertices and segments, moves, inserts, and deletes vertices', () => {
    const vHit = findNearestVertex(squareArea, { x: 19.8, y: 0.2 }, 0.5);
    expect(vHit).toEqual({
      ringIndex: 0,
      pointIndex: 1,
      point: { x: 20, y: 0 },
    });

    const moved = applyEntityPatch(
      squareArea,
      moveVertexPatch(squareArea, 0, 1, { x: 25, y: 0 }),
    );
    expect(moved.type === 'area' && moved.rings[0]![1]).toEqual({ x: 25, y: 0 });

    const sHit = findNearestSegment(squareArea, { x: 10, y: 0.1 }, 0.5);
    expect(sHit).toEqual({
      ringIndex: 0,
      insertIndex: 1,
      projected: { x: 10, y: 0 },
    });

    const inserted = applyEntityPatch(
      squareArea,
      insertVertexPatch(squareArea, 0, 1, { x: 10, y: 0 })!,
    );
    expect(inserted.type === 'area' && inserted.rings[0]).toHaveLength(5);

    const deleted = applyEntityPatch(
      inserted,
      deleteVertexPatch(inserted, 0, 1)!,
    );
    expect(deleted.type === 'area' && deleted.rings[0]).toHaveLength(4);

    // Cannot delete below 3 points on outer ring
    const tri: Entity = {
      ...squareArea,
      rings: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
    };
    expect(deleteVertexPatch(tri, 0, 0)).toBeNull();
  });

  it('carves a hole using polygon-clipping difference and merges using union', () => {
    const holeClip = [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ];
    const carved = booleanAreaRings(
      (squareArea as Extract<Entity, { type: 'area' }>).rings,
      holeClip,
      'difference',
    );
    expect(carved).toHaveLength(1);
    expect(carved[0]).toHaveLength(2); // outer + 1 hole

    const extensionClip = [
      { x: 15, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
      { x: 15, y: 20 },
    ];
    const merged = booleanAreaRings(
      (squareArea as Extract<Entity, { type: 'area' }>).rings,
      extensionClip,
      'union',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toHaveLength(1);
    const xs = merged[0]![0]!.map((p) => p.x);
    expect(Math.max(...xs)).toBe(30);
  });
});
