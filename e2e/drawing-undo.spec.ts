import { chooseTool, stageOrigin, openPanel } from './context-helpers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('drawing Undo removes points without undoing the map or layer, and Redo restores points', async () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-drawing-undo-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(tempBase, 'userData')}`] });
  try {
    const win = await app.firstWindow(); win.setDefaultTimeout(10_000);
    await win.waitForLoadState('domcontentloaded');
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, join(tempBase, 'World'));
    await win.getByTestId('btn-new-world').click();
    await expect(win.getByTestId('save-status')).toContainText('New World');
    await openPanel(win, 'newMap');
    await win.getByTestId('input-new-map-name').fill('Tracing');
    await openPanel(win, 'newMap');
    await win.getByTestId('select-new-map-kind').selectOption('site');
    await win.getByTestId('btn-create-map').click();
    await win.getByPlaceholder('New layer name...').fill('Land');
    await win.getByTestId('btn-add-layer').click();
    const panel = win.getByTestId('panel-map-main');
    const canvas = panel.locator('canvas');
    await expect(win.getByTestId('active-map-title')).toContainText('Tracing (site)');
    await expect.poll(async () => Number(await panel.getAttribute('data-render-count'))).toBeGreaterThan(0);
    const snapshot = () => win.evaluate(() => {
      const state = (window as any).__atlasWorldStore.getState();
      return { maps: state.world.maps, past: state.history.past.length, future: state.history.future.length };
    });
    const before = await snapshot();
    const mapId = Object.keys(before.maps).find(id => before.maps[id].name === 'Tracing')!;
    await chooseTool(win,'area');
    const box = (await canvas.boundingBox())!;
    for (const [x, y] of [[80, 80], [240, 80], [240, 240], [80, 240]]) {
      await win.mouse.click(stageOrigin(box).x + x!, stageOrigin(box).y + y!);
    }
    // Undo past the first point must stay in the draft, never reach layer.add.
    for (let i = 0; i < 6; i++) await canvas.press('Control+z');
    expect(await snapshot()).toEqual(before);
    await canvas.press('Enter');
    await expect(panel).toHaveAttribute('data-entity-count', '0');
    for (let i = 0; i < 3; i++) await canvas.press('Control+y');
    await canvas.press('Control+Shift+Z');
    expect(await snapshot()).toEqual(before);
    await canvas.press('Enter');
    await expect(panel).toHaveAttribute('data-entity-count', '1');
    const drawn = await snapshot();
    const area = Object.values(drawn.maps[mapId].entities)[0] as any;
    expect(area.rings[0]).toHaveLength(4);
    // A finished shape uses world history normally, preserving its map/layer.
    await canvas.press('Control+z');
    await expect(panel).toHaveAttribute('data-entity-count', '0');
    expect((await snapshot()).maps).toEqual(before.maps);
    await canvas.press('Control+y');
    expect(await snapshot()).toEqual(drawn);
    // Escape releases an empty draft's history protection.
    await win.mouse.click(stageOrigin(box).x + 300, stageOrigin(box).y + 300);
    await canvas.press('Control+z');
    await canvas.press('Escape');
    await canvas.press('Control+z');
    await expect(panel).toHaveAttribute('data-entity-count', '0');
    expect((await snapshot()).maps).toEqual(before.maps);
  } finally {
    await app.close();
  }
});
