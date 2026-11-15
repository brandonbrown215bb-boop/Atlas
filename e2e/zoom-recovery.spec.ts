import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('opening a world before its map panel is visible fits the map when it appears', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-hidden-map-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(root, 'profile')}`] });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const hidden = await page.addStyleTag({ content: '[data-testid="canvas-host-map-main"] { display: none !important; }' });
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, join(root, 'world'));
    await page.getByTestId('btn-new-world').click();
    await expect(page.getByTestId('save-status')).toContainText('New World');
    await page.evaluate(() => {
      const state = (window as any).__atlasWorldStore.getState();
      const map = state.world.maps[state.activeMapId];
      state.execute('entity.add', { mapId: map.id, entity: {
        id: 'land', type: 'area', role: 'land', origin: 'manual', rev: 0, layerId: map.layers[0].id,
        rings: [[{ x: 200000, y: 200000 }, { x: 1200000, y: 200000 }, { x: 1200000, y: 1200000 }, { x: 200000, y: 1200000 }]],
      } });
    });
    // Wait for Pixi initialization while the restored/hidden panel has no viewport.
    await expect.poll(() => page.getByTestId('panel-map-main').getAttribute('data-render-count').then(Number)).toBeGreaterThan(0);
    await hidden.evaluate(element => element.parentNode!.removeChild(element));
    const host = page.getByTestId('canvas-host-map-main');
    const camera = () => page.evaluate(() => (window as any).__atlasViewStore.getState().panels['map-main']?.camera);
    await expect.poll(async () => {
      const cam = await camera();
      const box = await host.boundingBox();
      return cam && box ? cam.zoom * 1609344 / Math.min(box.width, box.height) : 0;
    }).toBeCloseTo(.9, 2);
    const box = (await host.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + box.width * .8, box.y + box.height * .7, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    const beforeZoom = (await camera()).zoom;
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await camera()).zoom).toBeGreaterThan(beforeZoom);
    await page.getByTestId('fit-map').click();
    await expect(page.getByTestId('menu-bar')).toBeVisible();
    await expect(page.getByRole('alert', { name: 'Panel error' })).toHaveCount(0);
    await expect(page.getByTestId('error-banner')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('an error outside the dock panels shows recovery controls and keeps the world in memory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-app-recovery-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(root, 'profile')}`] });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, join(root, 'world'));
    await page.getByTestId('btn-new-world').click();
    await expect(page.getByTestId('save-status')).toContainText('New World');
    const source = await page.evaluate(() => {
      const store = (window as any).__atlasWorldStore;
      const state = store.getState(), map = state.world.maps[state.activeMapId];
      state.execute('entity.add', { mapId: map.id, entity: {
        id: 'unsaved-label', type: 'label', text: 'Keep this edit', x: 500, y: 500, size: 12,
        origin: 'manual', rev: 0, layerId: map.layers[0].id,
      } });
      const source = structuredClone(store.getState().world);
      const broken = structuredClone(source);
      broken.meta.maps[0].name = { invalid: 'app render fault' };
      // Only the valid edited map is dirty; the injected bad metadata is never saved.
      store.setState({ world: broken, dirtyWorld: false });
      return source;
    });
    await expect(page.getByRole('alert', { name: 'Atlas error' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save world', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => Object.keys((window as any).__atlasWorldStore.getState().world.maps))).toEqual(Object.keys(source.maps));
    await page.getByRole('button', { name: 'Save world', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('World saved.');
    const saved = JSON.parse(readFileSync(join(root, 'world', 'maps', `${source.meta.maps[0].id}.json`), 'utf8'));
    expect(saved.entities['unsaved-label'].text).toBe('Keep this edit');
    await page.evaluate(source => { (window as any).__atlasWorldStore.setState({ world: source }); }, source);
    await page.getByRole('button', { name: 'Reset view and retry', exact: true }).click();
    await expect(page.getByTestId('menu-bar')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('New World');
    await expect(page.getByRole('alert', { name: 'Atlas error' })).toHaveCount(0);
    await expect.poll(() => page.getByTestId('panel-map-main').getAttribute('data-render-count').then(Number)).toBeGreaterThan(0);
  } finally { await app.close(); }
});
