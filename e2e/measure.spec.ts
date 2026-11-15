import { chooseTool } from './context-helpers';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, expect, _electron as electron } from '@playwright/test';
import type { MapDoc } from '../src/renderer/model/schema';

type TestWindow = Window & {
  __atlasWorldStore: { getState: () => {
    world: { maps: Record<string, MapDoc> };
    history: { past: unknown[]; future: unknown[] };
    dirtyWorld: boolean; dirtyMapIds: Record<string, true>;
    execute: (name: string, input: unknown) => unknown;
    setActiveMap: (id: string) => void;
    markClean: (options: { world: boolean; mapIds: string[] }) => void;
  } };
  __atlasViewStore: { getState: () => {
    setPanelMap: (panelId: string, mapId: string) => void;
    setPanelCamera: (panelId: string, camera: { x: number; y: number; zoom: number }) => void;
  } };
  atlasApi: { getAgentInfo: () => Promise<{ url: string; token: string }> };
};

test('Phase 2: draws and edits an area with undo/redo, then measures a route and overnight travel without editing the map', async ({}, testInfo) => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-measure-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(tempBase, 'userData')}`] });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, join(tempBase, 'World'));
    await win.getByTestId('btn-new-world').click();
    await expect(win.getByTestId('save-status')).toContainText('New World');
    await win.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.__atlasWorldStore.getState().execute('map.create', { id: 'site', name: 'Drawing', kind: 'site', bounds: { x: 0, y: 0, w: 100, h: 100 } });
      w.__atlasWorldStore.getState().setActiveMap('site');
      w.__atlasViewStore.getState().setPanelMap('map-main', 'site');
      w.__atlasViewStore.getState().setPanelCamera('map-main', { x: 0, y: 0, zoom: 4 });
    });
    const panel = win.getByTestId('panel-map-main');
    const canvas = panel.locator('canvas');
    await expect(panel).toContainText('Drawing (site)');
    await expect.poll(async () => Number(await panel.getAttribute('data-render-count'))).toBeGreaterThan(0);
    await chooseTool(win,'area');
    let box = (await canvas.boundingBox())!;
    for (const [x, y] of [[80, 80], [240, 80], [240, 240], [80, 240]]) await win.mouse.click(box.x + x!, box.y + y!);
    await canvas.press('Enter');
    await expect(panel).toHaveAttribute('data-entity-count', '1');
    const siteSnapshot = () => win.evaluate(() => (window as unknown as TestWindow).__atlasWorldStore.getState().world.maps['site']!);
    const drawn = await siteSnapshot();
    await chooseTool(win,'pointEdit');
    box = (await canvas.boundingBox())!;
    await win.mouse.move(box.x + 240, box.y + 80);
    await win.mouse.down();
    await win.mouse.move(box.x + 280, box.y + 80, { steps: 4 });
    await win.mouse.up();
    const edited = await siteSnapshot();
    expect(edited.entities).not.toEqual(drawn.entities);
    await win.getByTestId('btn-undo').click();
    expect(await siteSnapshot()).toEqual(drawn);
    await win.getByTestId('btn-redo').click();
    expect(await siteSnapshot()).toEqual(edited);

    await win.evaluate(() => {
      const w = window as unknown as TestWindow;
      w.__atlasWorldStore.getState().execute('map.create', { id: 'route', name: 'Travel', kind: 'region', bounds: { x: 0, y: 0, w: 10000, h: 10000 } });
      w.__atlasWorldStore.getState().setActiveMap('route');
      w.__atlasViewStore.getState().setPanelMap('map-main', 'route');
      w.__atlasViewStore.getState().setPanelCamera('map-main', { x: 0, y: 0, zoom: 0.1 });
    });
    await expect(panel).toContainText('Travel (region)');
    await win.getByTestId('tool-btn-measure').click();
    await win.getByTestId('measure-departure').fill('23:50');
    const snapshot = () => win.evaluate(() => {
      const state = (window as unknown as TestWindow).__atlasWorldStore.getState();
      return { map: state.world.maps['route'], past: state.history.past.length, future: state.history.future.length };
    });
    const before = await snapshot();
    box = (await canvas.boundingBox())!;
    for (const [x, y] of [[50, 50], [150, 50], [150, 150]]) await win.mouse.click(box.x + x!, box.y + y!);
    await canvas.press('Enter');
    await expect(win.getByTestId('measure-distance')).toHaveText('1.24 mi');
    await expect(win.getByTestId('measure-duration')).toHaveText('Travel: 25 min');
    await expect(win.getByTestId('measure-arrival')).toHaveText('Arrive: 00:15 (+1 day)');
    await win.mouse.move(box.x + 200, box.y + 200);
    await expect(win.getByTestId('measure-distance')).toHaveText('1.24 mi');
    await win.getByTestId('measure-speed').fill('1.5');
    await expect(win.getByTestId('measure-duration')).toHaveText('Travel: 50 min');
    await expect(win.getByTestId('measure-arrival')).toHaveText('Arrive: 00:40 (+1 day)');
    await win.getByTestId('measure-speed').fill('0');
    await expect(win.getByTestId('measure-arrival')).toHaveCount(0);
    await win.getByTestId('measure-speed').fill('3');
    expect(await snapshot()).toEqual(before);
    await win.screenshot({ path: testInfo.outputPath('measure-route.png') });
    await win.getByLabel('Daily travel schedule',{exact:true}).check();
    await win.getByTestId('measure-departure').fill('08:00');
    await win.getByLabel('Travel hours per day',{exact:true}).fill('0.25');
    await win.getByLabel('Show travel markers',{exact:true}).check();
    await expect(win.getByTestId('measure-arrival')).toHaveText('Arrive: 08:10 (+1 day)');
    await expect(win.getByTestId('measure-elapsed')).toHaveText('Elapsed: 1 d 10 min · 1 rest stop');
    expect(await snapshot()).toEqual(before);
    await win.screenshot({ path: testInfo.outputPath('scheduled-route.png') });

    // Moving the panel into another window keeps the route and its readout.
    const popupPromise = win.waitForEvent('popup');
    await win.getByTestId('popout-btn-map-main').click();
    const popup = await popupPromise;
    await expect(popup.getByTestId('measure-distance')).toHaveText('1.24 mi');
    await expect(popup.getByTestId('measure-arrival')).toHaveText('Arrive: 08:10 (+1 day)');
    await popup.getByTestId('dockback-btn-map-main').click();
    await expect(win.getByTestId('measure-distance')).toHaveText('1.24 mi');
    // A different map does not inherit the old route.
    await win.evaluate(() => (window as unknown as TestWindow).__atlasViewStore.getState().setPanelMap('map-main', 'site'));
    await expect(win.getByTestId('measure-bar')).toHaveAttribute('data-point-count', '0');
    await win.evaluate(() => (window as unknown as TestWindow).__atlasViewStore.getState().setPanelMap('map-main', 'route'));
    await expect(win.getByTestId('measure-bar')).toHaveAttribute('data-point-count', '3');
    await win.getByTestId('measure-clear').click();
    await expect(win.getByTestId('measure-distance')).toHaveText('0 ft');
    expect(await snapshot()).toEqual(before);

    const info = await win.evaluate(() => (window as unknown as TestWindow).atlasApi.getAgentInfo());
    const client = new Client({ name: 'measure-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }));
    try {
      const response = await client.callTool({ name: 'command_run', arguments: { commands: [{ name: 'map.measureRoute', input: {
        mapId: 'route', points: [{ x: 0, y: 0 }, { x: 1609.344, y: 0 }], speedMph: 2, departure: '23:45',
      } }] } });
      expect(response.isError).toBeFalsy();
      const output = JSON.parse((response.content as Array<{ text: string }>)[0]!.text);
      expect(output.results[0]).toMatchObject({ miles: 1, durationSeconds: 1800, arrival: { time: '00:15', dayOffset: 1 } });
      expect(await snapshot()).toEqual(before);
    } finally { await client.close(); }
  } finally {
    await app.close();
    rmSync(tempBase, { recursive: true, force: true });
  }
});
