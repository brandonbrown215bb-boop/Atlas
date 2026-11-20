import { chooseTool, clearStage, openPanel } from './context-helpers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('fog strokes, holes and undo render correctly in GM and player windows', async ({}, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-fog-check-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(dir, 'profile')}`] });
  try {
    const main = await app.firstWindow(); main.setDefaultTimeout(10_000);
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(dir, 'world'));
    await main.getByTestId('btn-new-world').click();
    await expect(main.getByTestId('save-status')).toContainText('New World');
    await main.evaluate(() => {
      const w = window as any, s = w.__atlasWorldStore.getState(), v = w.__atlasViewStore.getState();
      s.execute('map.create', { id: 'fog-site', name: 'Fog check', kind: 'site', bounds: { x: 0, y: 0, w: 100, h: 80 } });
      s.execute('entity.add', { mapId: 'fog-site', entity: { id: 'floor', type: 'area', role: 'floor', fill: '#dca25f', layerId: 'layer-base', origin: 'manual', rev: 0,
        rings: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }]] } });
      s.setActiveMap('fog-site'); v.setPanelMap('map-main', 'fog-site'); v.setActiveMapPanelId('map-main');
      v.setPanelCamera('map-main', { x: 20, y: 20, zoom: 5 });
    });
    const playerReady = app.waitForEvent('window');
    await main.getByTestId('btn-player-window').click();
    const player = await playerReady;
    await main.getByRole('button', { name: 'Send my view', exact: true }).click();
    const canvas = main.getByTestId('panel-map-main').locator('canvas');
    const snapshot = () => main.evaluate(() => { const s = (window as any).__atlasWorldStore.getState(); return { fog: s.world.maps['fog-site'].fog, history: s.history.past.length }; });
    const playerPixel = async (x: number, y: number) => {
      const src = await player.getByTestId('player-image').getAttribute('src');
      if (!src) return -1;
      return app.evaluate(({ nativeImage }, { src, x, y }) => {
        const image = nativeImage.createFromDataURL(src), width = image.getSize().width;
        return image.toBitmap()[(y * width + x) * 4 + 2]!;
      }, { src, x, y });
    };
    await expect.poll(() => playerPixel(120, 145)).toBeGreaterThan(150);
    const exposed = await playerPixel(120, 145);
    await main.getByRole('button', { name: 'Hide all', exact: true }).click();
    await expect.poll(() => playerPixel(120, 145)).toBeLessThan(60); // fog is dark, with paper grain on top
    await chooseTool(main,'fog');
    await main.getByLabel('Fog brush radius').fill('10');
    await clearStage(main); // the strokes and GM pixel checks sit where the Tools panel floats
    const box = (await canvas.boundingBox())!;
    const before = await snapshot();
    await main.mouse.move(box.x + 120, box.y + 145);
    await main.mouse.down();
    await main.mouse.move(box.x + 320, box.y + 145, { steps: 12 });
    await main.mouse.up();
    await main.mouse.move(5, 5);
    await expect.poll(() => playerPixel(120, 145)).toBeGreaterThan(150); // exposed: textured floor varies a little from spot to spot
    await expect.poll(() => playerPixel(420, 245)).toBeLessThan(60);
    const revealed = await snapshot();
    expect(revealed.history).toBe(before.history + 1);
    await openPanel(main, 'player'); // fog brush settings live in Player & fog
    await main.getByLabel('Fog brush mode').selectOption('hide');
    await main.getByLabel('Fog brush radius').fill('3');
    await clearStage(main);
    await main.mouse.click(box.x + 220, box.y + 145);
    await main.mouse.move(5, 5);
    await expect.poll(() => playerPixel(220, 145)).toBeLessThan(60);
    await expect.poll(() => playerPixel(170, 145)).toBeGreaterThan(150); // exposed: textured floor varies a little from spot to spot
    expect((await snapshot()).fog.revealed[0].length).toBe(2);
    await main.getByTestId('btn-undo').click();
    expect((await snapshot()).fog).toEqual(revealed.fog);
    await expect.poll(() => playerPixel(220, 145)).toBeGreaterThan(150); // exposed: textured floor varies a little from spot to spot
    await main.getByTestId('btn-redo').click();
    await expect.poll(() => playerPixel(220, 145)).toBeLessThan(60);
    const gmPixels = await app.evaluate(({ nativeImage }, data) => {
      const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64')), width = image.getSize().width, pixels = image.toBitmap();
      return [170, 220].map(x => pixels[(145 * width + x) * 4 + 2]!);
    }, (await canvas.screenshot()).toString('base64'));
    expect(gmPixels[0]).toBeGreaterThan(150);
    // The GM sees hidden areas through half-strength fog (textured floor, so roughly half).
    expect(gmPixels[1]!).toBeGreaterThan(gmPixels[0]! * .3);
    expect(gmPixels[1]!).toBeLessThan(gmPixels[0]! * .7);
    await main.screenshot({ path: testInfo.outputPath('gm-fog.png') });
    await player.screenshot({ path: testInfo.outputPath('player-fog.png') });
    await openPanel(main, 'player');
    await main.getByRole('button', { name: 'Reveal all', exact: true }).click();
    await expect.poll(() => playerPixel(420, 245)).toBeGreaterThan(150); // exposed: textured floor varies a little from spot to spot
  } finally { await app.close(); }
});
