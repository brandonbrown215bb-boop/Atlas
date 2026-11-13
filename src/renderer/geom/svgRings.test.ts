import { describe, expect, it } from 'vitest';
import { svgAreaRings } from './svgRings';

const square = (x: number, y: number, size: number) => [
  { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];

describe('SVG filled contours', () => {
  it('keeps holes, islands inside holes, and separate land masses', () => {
    const result = svgAreaRings([square(0, 0, 100), square(10, 10, 50), square(20, 20, 10), square(200, 0, 10)], 'evenodd');
    expect(result).toHaveLength(3);
    expect(result.map((rings) => rings.length).sort()).toEqual([1, 1, 2]);
  });
  it('uses winding rather than containment for nonzero fills', () => {
    expect(svgAreaRings([square(0, 0, 100), square(10, 10, 50)], 'nonzero')[0]).toHaveLength(1);
    expect(svgAreaRings([square(0, 0, 100), square(10, 10, 50).reverse()], 'nonzero')[0]).toHaveLength(2);
    expect(svgAreaRings([square(0, 0, 100).reverse(), square(10, 10, 50)], 'nonzero')[0]).toHaveLength(2);
  });
  it('handles overlapping contours and ignores lines', () => {
    const overlapping = [square(0, 0, 10), square(5, 0, 10)];
    expect(svgAreaRings(overlapping, 'nonzero')).toHaveLength(1);
    expect(svgAreaRings(overlapping, 'evenodd')).toHaveLength(2);
    expect(svgAreaRings([square(0, 0, 10), [{ x: 0, y: 0 }, { x: 10, y: 0 }]], 'nonzero')).toHaveLength(1);
  });
});
