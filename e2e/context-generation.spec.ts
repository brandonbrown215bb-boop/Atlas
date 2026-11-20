import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import { chooseTool, generationSettings, generationPanel, openPanel } from './context-helpers';

test('context strip shares draft settings, applies directly, and works in a narrow popout', async ({}, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-context-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(dir, 'profile')}`] });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(10_000);
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(dir, 'world'));
    await page.getByTestId('btn-new-world').click();
    const strip = (await generationPanel(page));
    await expect(strip.getByRole('button',{name:'Generate terrain', exact: true })).toBeVisible();
    await expect(page.getByTestId('btn-generator')).toHaveCount(0);
    await expect(page.getByTestId('tool-btn-fog')).not.toBeVisible();
    await chooseTool(page, 'fog');
    await expect(page.getByTestId('current-tool')).toHaveText('Fog');
    await chooseTool(page, 'select');
    // Creating maps uses the ordinary map UI; no footprint or layer setup.
    await openPanel(page, 'newMap');
    await page.getByTestId('input-new-map-name').fill('Forest');
    await openPanel(page, 'newMap');
    await page.getByTestId('select-new-map-kind').selectOption('site');
    await page.getByTestId('btn-create-map').click();
    await expect(strip.getByRole('button', { name: 'Woodland', exact: true })).toBeVisible();
    await strip.getByRole('button', { name: 'Woodland', exact: true }).click();
    await strip.getByLabel('Clearing count').fill('3');
    const before = await page.evaluate(() => { const s = (window as any).__atlasWorldStore.getState(); return { world: s.world, history: s.history }; });
    const settings = await generationSettings(page);
    await expect(settings.getByLabel('Clearing count')).toHaveValue('3');
    await settings.getByLabel('Outdoor water').uncheck();
    await settings.getByLabel('Generator seed').fill('5');
    expect(await page.evaluate(() => { const s = (window as any).__atlasWorldStore.getState(); return { world: s.world, history: s.history }; })).toEqual(before);
    await strip.getByRole('button',{name:'Generate woodland', exact: true }).click();
    await expect(strip).toHaveAttribute('aria-busy', 'false');
    await expect(strip.getByRole('button',{name:'Try another', exact: true })).toBeVisible();
    const snapshot = () => page.evaluate(() => { const s = (window as any).__atlasWorldStore.getState(); return s.world.maps[s.activeMapId]; });
    const generated = await snapshot();
    expect(Object.values(generated.entities).filter((e: any) => e.type === 'label')).toHaveLength(3);
    await strip.getByLabel('Clearing count').fill('4');
    await strip.getByRole('button',{name:'Apply changes', exact: true }).click();
    await expect(strip).toHaveAttribute('aria-busy', 'false');
    const updated = await snapshot();
    expect(Object.values(updated.generators)[0]).toMatchObject({ seed: 5, params: { clearings: 4 } });
    await page.getByTestId('btn-undo').click();
    expect(await snapshot()).toEqual(generated);
    // A locked target is explained, with access to Layers, and changes nothing.
    await page.evaluate(() => { const s = (window as any).__atlasWorldStore.getState(); s.execute('layer.update', { mapId: s.activeMapId, layerId: 'layer-base', patch: { locked: true } }); });
    const locked = await snapshot();
    await strip.getByRole('button',{name:'Try another', exact: true }).click();
    await expect(strip.getByRole('alert')).toBeVisible();
    expect(await snapshot()).toEqual(locked);
    await page.getByTestId('btn-undo').click();
    await page.getByTestId('fit-map').click();
    await page.getByTestId('panel-map-main').screenshot({ path: testInfo.outputPath('docked-context.png') });
    const opened = app.waitForEvent('window');
    // The map is the window background now; the Generator panel is what pops out.
    await page.getByTestId('popout-btn-generator').click();
    const popout = await opened;
    popout.setDefaultTimeout(10_000);
    const popStrip = popout.getByTestId('generation-settings');
    await expect(popStrip).toBeVisible();
    const popoutWindow = await app.browserWindow(popout);
    await popoutWindow.evaluate(win => win.setContentSize(500, 700));
    await expect(popStrip.getByRole('button',{name:'Try another', exact: true })).toBeVisible();
    await popout.screenshot({ path: testInfo.outputPath('narrow-popout-context.png') });
    await popStrip.getByRole('button',{name:'Try another', exact: true }).click();
    await expect(popStrip).toHaveAttribute('aria-busy', 'false');
    await expect(popStrip.getByRole('alert')).toHaveCount(0);
    await popout.getByTestId('dockback-btn-generator').click();
    await expect(page.getByTestId('panel-generator').getByTestId('generation-settings')).toBeVisible();
  } finally { await app.close(); }
});

test('cancel and navigation discard in-flight generation without changing the document', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-generation-cancel-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(dir, 'profile')}`] });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(10_000);
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(dir, 'world'));
    await page.getByTestId('btn-new-world').click();
    await openPanel(page, 'newMap');
    await page.getByTestId('input-new-map-name').fill('Other map');
    await openPanel(page, 'newMap');
    await page.getByTestId('select-new-map-kind').selectOption('interior');
    await page.getByTestId('btn-create-map').click();
    const otherId = await page.evaluate(() => (window as any).__atlasWorldStore.getState().activeMapId);
    const rootId = await page.evaluate(() => Object.keys((window as any).__atlasWorldStore.getState().world.maps).find(id => id !== (window as any).__atlasWorldStore.getState().activeMapId)!);
    await page.getByTestId(`map-tree-item-${rootId}`).click();
    const snapshot = () => page.evaluate(() => { const s = (window as any).__atlasWorldStore.getState(); return { world: s.world, history: s.history }; });
    const before = await snapshot(), strip = (await generationPanel(page));
    await strip.getByRole('button',{name:'Generate terrain', exact: true }).click();
    await strip.getByRole('button', { name: 'Cancel generation', exact: true }).click();
    await expect(strip).toHaveAttribute('aria-busy', 'false');
    expect(await snapshot()).toEqual(before);
    await strip.getByRole('button',{name:'Generate terrain', exact: true }).click();
    await page.getByTestId(`map-tree-item-${otherId}`).click();
    await expect(strip).toContainText('Whole map');
    await page.getByTestId(`map-tree-item-${rootId}`).click();
    await expect(strip).toHaveAttribute('aria-busy', 'false');
    expect(await snapshot()).toEqual(before);
  } finally { await app.close(); }
});

test('room furniture is contextual, preserves the layout, and undoes in one step', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-room-actions-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(dir, 'profile')}`] });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(10_000);
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(dir, 'world'));
    await page.getByTestId('btn-new-world').click();
    await openPanel(page, 'newMap');
    await page.getByTestId('input-new-map-name').fill('Rooms');
    await openPanel(page, 'newMap');
    await page.getByTestId('select-new-map-kind').selectOption('interior');
    await page.getByTestId('btn-create-map').click();
    const strip = (await generationPanel(page));
    await strip.getByLabel('Room purpose', { exact: true }).selectOption('tavern');
    await strip.getByRole('button',{name:'Generate rooms', exact: true }).click();
    await expect(strip.getByRole('button',{name:'Edit parts', exact: true })).toBeVisible();
    await strip.getByRole('button',{name:'Edit parts', exact: true }).click();
    const roomId = await page.evaluate(() => {
      const w = window as any, s = w.__atlasWorldStore.getState(), map = s.world.maps[s.activeMapId];
      const floor = (Object.values(map.entities) as any[]).find(e => e.type === 'area' && e.role === 'floor');
      w.__atlasViewStore.getState().setSelection([floor.id]);
      return floor.id as string;
    });
    await expect(strip.getByText('Furniture…', { exact: true })).toBeVisible();
    await expect(strip.getByRole('button',{name:'Try another', exact: true })).toHaveCount(0);
    const snapshot = () => page.evaluate(() => { const s = (window as any).__atlasWorldStore.getState(); return s.world.maps[s.activeMapId]; });
    const before = await snapshot();
    await strip.getByLabel('Selected room purpose').selectOption('storage');
    expect(await snapshot()).toEqual(before);
    await strip.getByText('Furniture…', { exact: true }).click();
    await strip.getByRole('button', { name: 'Rearrange', exact: true }).click();
    await expect(strip).toHaveAttribute('aria-busy', 'false');
    // "Not busy" can be true before the job starts; wait for the result itself.
    await expect.poll(async () => (await snapshot()).entities[roomId].roomPurpose).toBe('storage');
    await expect(strip).toHaveAttribute('aria-busy', 'false');
    await expect(strip.getByRole('alert')).toHaveCount(0);
    const after = await snapshot();
    expect(after.entities[roomId].rev).toBe(after.revision);
    for (const e of Object.values(before.entities) as any[]) {
      if (e.type === 'area') expect(after.entities[e.id].rings).toEqual(e.rings);
      if (e.type === 'wall' || e.type === 'door') expect(after.entities[e.id]).toEqual(e);
    }
    await page.getByTestId('btn-undo').click();
    expect(await snapshot()).toEqual(before);
    await strip.getByRole('button', { name: 'Done editing parts', exact: true }).click();
    await expect(strip.getByRole('button',{name:'Try another', exact: true })).toBeVisible();
  } finally { await app.close(); }
});
