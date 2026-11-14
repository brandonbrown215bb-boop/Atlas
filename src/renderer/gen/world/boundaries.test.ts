import { expect, it } from 'vitest';
import { signedArea, traceCellBoundaries } from './boundaries';

it('traces a coast with a hole and an island without polygon unions', () => {
  const cells = Array.from({ length: 9 }, (_, i) => {
    const x = i % 3, y = Math.floor(i / 3);
    return [{ x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 }];
  });
  const result = traceCellBoundaries(cells, cells.map((_, i) => i === 4 ? 'water' : 'land'));
  expect(result.get('land')).toHaveLength(1);
  expect(result.get('land')![0]).toHaveLength(2);
  expect(result.get('land')![0]!.map(signedArea)).toEqual([9, -1]);
  expect(result.get('water')![0]!.map(signedArea)).toEqual([1]);
  expect(traceCellBoundaries(cells, cells.map((_, i) => i === 0 || i === 8 ? 'land' : null)).get('land')).toHaveLength(2);
});
