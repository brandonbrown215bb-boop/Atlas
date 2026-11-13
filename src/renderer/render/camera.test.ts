import { describe, expect, it } from 'vitest';
import {
  centerCameraOnPoint,
  fitBoundsCamera,
  mapToScreen,
  screenToMap,
  zoomAtCursor,
  ZOOM_LIMITS,
  type CameraState,
} from './camera';

describe('P1.4 camera maths', () => {
  it('round-trips screen <-> map coordinates accurately', () => {
    const cam: CameraState = { x: 140, y: -65, zoom: 2.5 };
    const mapPt = { x: 312.4, y: 88.9 };
    const screenPt = mapToScreen(cam, mapPt.x, mapPt.y);
    const back = screenToMap(cam, screenPt.x, screenPt.y);
    expect(back.x).toBeCloseTo(mapPt.x, 10);
    expect(back.y).toBeCloseTo(mapPt.y, 10);
  });

  it('keeps the map point under the cursor fixed when zooming', () => {
    const cam: CameraState = { x: 50, y: 80, zoom: 1.5 };
    const cursorX = 420;
    const cursorY = 275;
    const before = screenToMap(cam, cursorX, cursorY);
    const zoomed = zoomAtCursor(cam, cursorX, cursorY, 1.35, 'settlement');
    const after = screenToMap(zoomed, cursorX, cursorY);

    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  it('clamps zoom per map kind', () => {
    const cam: CameraState = { x: 0, y: 0, zoom: 0.01 };
    const zoomedInWorld = zoomAtCursor(cam, 100, 100, 1000, 'world');
    expect(zoomedInWorld.zoom).toBe(ZOOM_LIMITS.world.max);

    const zoomedOutInterior = zoomAtCursor(
      { x: 0, y: 0, zoom: 10 },
      100,
      100,
      0.0001,
      'interior',
    );
    expect(zoomedOutInterior.zoom).toBe(ZOOM_LIMITS.interior.min);
  });

  it('centers bounds in fitBoundsCamera', () => {
    const cam = fitBoundsCamera(
      { x: 0, y: 0, w: 1000, h: 1000 },
      800,
      600,
      'settlement',
    );
    const centerScreen = mapToScreen(cam, 500, 500);
    expect(centerScreen.x).toBeCloseTo(400, 6);
    expect(centerScreen.y).toBeCloseTo(300, 6);
  });

  it('centers a map point in the viewport without changing zoom', () => {
    const cam: CameraState = { x: 10, y: 20, zoom: 2.5 };
    const centered = centerCameraOnPoint(cam, 120, 80, 800, 600);
    expect(centered.zoom).toBe(2.5);
    const screen = mapToScreen(centered, 120, 80);
    expect(screen.x).toBeCloseTo(400, 6);
    expect(screen.y).toBeCloseTo(300, 6);
  });
});
