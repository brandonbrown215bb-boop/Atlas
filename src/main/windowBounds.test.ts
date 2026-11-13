import { describe, expect, it } from 'vitest';
import { clampBoundsToDisplays, type DisplayArea, type Rect } from './windowBounds';

describe('P1.3 clampBoundsToDisplays', () => {
  const primary: Rect = { x: 0, y: 0, width: 1920, height: 1040 };
  const displays: DisplayArea[] = [
    { workArea: primary },
    { workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
  ];

  it('keeps bounds unchanged when visible on a current monitor', () => {
    const onSecondMonitor: Rect = { x: 2100, y: 120, width: 800, height: 600 };
    expect(clampBoundsToDisplays(onSecondMonitor, displays, primary)).toEqual(
      onSecondMonitor,
    );
  });

  it('moves an off-screen window onto the primary monitor', () => {
    const disconnectedMonitor: Rect = { x: 4200, y: 100, width: 800, height: 600 };
    const result = clampBoundsToDisplays(disconnectedMonitor, [displays[0]!], primary);
    expect(result.x).toBeGreaterThanOrEqual(primary.x);
    expect(result.y).toBeGreaterThanOrEqual(primary.y);
    expect(result.x + result.width).toBeLessThanOrEqual(primary.x + primary.width);
    expect(result.y + result.height).toBeLessThanOrEqual(primary.y + primary.height);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it('clamps oversized windows to fit the primary monitor', () => {
    const hugeOffscreen: Rect = { x: -5000, y: -5000, width: 3000, height: 2000 };
    const result = clampBoundsToDisplays(hugeOffscreen, [displays[0]!], primary);
    expect(result.width).toBe(primary.width);
    expect(result.height).toBe(primary.height);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});
