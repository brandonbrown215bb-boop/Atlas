import { describe, expect, it } from 'vitest';
import { simplifyRDP, smoothChaikin, snapPointToGrid } from './simplify';

describe('geom simplify & smooth', () => {
  it('simplifies collinear points with Ramer-Douglas-Peucker', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 2, y: 0.05 },
      { x: 5, y: 0 },
      { x: 8, y: -0.02 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const simplified = simplifyRDP(pts, 0.2, false);
    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('preserves at least 3 points for closed polygon simplification', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 5, y: 0.01 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const simplified = simplifyRDP(ring, 0.2, true);
    expect(simplified.length).toBeGreaterThanOrEqual(3);
    expect(simplified.length).toBeLessThan(ring.length);
  });

  it('smooths open and closed curves with Chaikin', () => {
    const open = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const smoothedOpen = smoothChaikin(open, 1, false);
    expect(smoothedOpen[0]).toEqual({ x: 0, y: 0 });
    expect(smoothedOpen[smoothedOpen.length - 1]).toEqual({ x: 10, y: 10 });
    expect(smoothedOpen.length).toBe(6);

    const closed = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const smoothedClosed = smoothChaikin(closed, 1, true);
    expect(smoothedClosed.length).toBe(8);
  });

  it('snaps points to grid', () => {
    expect(snapPointToGrid({ x: 2.3, y: 3.9 }, 1.5)).toEqual({ x: 3, y: 4.5 });
    expect(snapPointToGrid({ x: 2.3, y: 3.9 }, 0)).toEqual({ x: 2.3, y: 3.9 });
  });
});
