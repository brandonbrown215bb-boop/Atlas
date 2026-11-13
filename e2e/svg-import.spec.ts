import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, expect, _electron as electron } from '@playwright/test';
import type { MapDoc } from '../src/renderer/model/schema';

interface TestStore { getState: () => { world: { maps: Record<string, MapDoc> } } }

declare global {
  interface Window { __svgTestStore?: TestStore }
}

test('SVG import preserves holes, transforms and separate paths; roles, cancel, undo, errors and MCP use the same command', async ({}, testInfo) => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-svg-'));
  const worldDir = join(tempBase, 'World');
  const svgPath = join(tempBase, 'drawing.svg');
  writeFileSync(svgPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100">
    <path id="island" fill-rule="evenodd" d="M10 20H110V100H10Z M30 40H50V60H30Z"/>
    <g transform="translate(110 20) scale(2)"><path id="stream" fill="none" stroke-width="2" d="M0 0 C10 0 10 20 20 20 m5 5 l10 0"/></g>
    <rect id="house" x="140" y="60" width="20" height="10"/>
    <circle id="skip-me" cx="180" cy="70" r="5"/>
    <rect id="hidden" style="display:none" x="0" y="0" width="100" height="100"/>
    <script>window.__svgExecuted = true</script>
    <image href="https://example.invalid/must-not-load.png"/>
  </svg>`);
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(tempBase, 'userData')}`] });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, worldDir);
    await win.getByTestId('btn-new-world').click();
    await expect(win.getByTestId('save-status')).toContainText('New World');
    await win.evaluate(() => {
      window.__svgTestStore = (window as unknown as { __atlasWorldStore: TestStore }).__atlasWorldStore;
    });
    const snapshot = () => win.evaluate(() => window.__svgTestStore!.getState().world!.maps['map-1']!);
    const before = await snapshot();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, svgPath);
    const requests: string[] = [];
    win.on('request', (request) => { if (request.url().includes('must-not-load')) requests.push(request.url()); });
    await win.getByTestId('btn-import-svg').click();
    const dialog = win.getByRole('dialog', { name: 'Import SVG', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('select[data-testid^="svg-role-"]')).toHaveCount(4);
    await win.getByTestId('svg-width').fill('656.1679790026246'); // 200 metres
    await win.getByTestId('svg-role-0').selectOption('area:water');
    await win.getByTestId('svg-role-1').selectOption('path:river');
    await win.getByTestId('svg-role-2').selectOption('area:building');
    await win.getByTestId('svg-role-3').selectOption('skip');
    await win.screenshot({ path: testInfo.outputPath('svg-dialog.png') });
    expect(await snapshot()).toEqual(before);
    await win.getByTestId('btn-confirm-svg').click();
    await expect(dialog).not.toBeVisible();
    const imported = await snapshot();
    const entities = Object.values(imported.entities);
    expect(entities).toHaveLength(4);
    const island = entities.find((e) => e.name === 'island')!;
    expect(island.type).toBe('area');
    if (island.type !== 'area') throw new Error('Expected an area');
    expect(island.role).toBe('water');
    expect(island.rings).toHaveLength(2);
    const streams = entities.filter((e) => e.type === 'path');
    expect(streams).toHaveLength(2);
    expect(streams[0]!.points[0]!.x).toBeCloseTo(100, 2);
    expect(streams[0]!.points[0]!.y).toBeCloseTo(0, 2);
    expect(streams[0]!.width).toBeCloseTo(4, 2);
    expect(streams[0]!.points.length).toBeGreaterThan(3);
    // The relative moveto begins at the previous curve endpoint, without a connector.
    expect(streams[1]!.points[0]!.x).toBeCloseTo(150, 2);
    expect(streams[1]!.points[0]!.y).toBeCloseTo(50, 2);
    expect(streams[1]!.points.at(-1)!.x).toBeCloseTo(170, 2);
    expect(entities.every((e) => e.origin === 'manual')).toBe(true);
    expect(await win.evaluate(() => '__svgExecuted' in window)).toBe(false);
    expect(requests).toEqual([]);
    await win.getByTestId('btn-undo').click();
    expect(await snapshot()).toEqual(before);
    await win.getByTestId('btn-redo').click();
    expect(await snapshot()).toEqual(imported);
    await win.getByTestId('btn-import-svg').click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await snapshot()).toEqual(imported);
    writeFileSync(svgPath, '<svg><path></svg>');
    await win.getByTestId('btn-import-svg').click();
    await expect(win.getByRole('alert').filter({ hasText: 'not a valid SVG' })).toBeVisible();
    expect(await snapshot()).toEqual(imported);

    const info = await win.evaluate(() => (window as unknown as { atlasApi: { getAgentInfo: () => Promise<{ url: string; token: string }> } }).atlasApi.getAgentInfo());
    const client = new Client({ name: 'svg-import-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }));
    try {
      const response = await client.callTool({ name: 'command_run', arguments: { commands: [{ name: 'map.importSvg', input: {
        mapId: 'map-1', layerId: 'layer-base', shapes: [{ type: 'path', role: 'trail', name: 'Agent trail', width: 1, closed: false, points: [{ x: 1, y: 2 }, { x: 5, y: 6 }] }],
      } }] } });
      expect(response.isError).toBeFalsy();
      expect(Object.values((await snapshot()).entities).some((e) => e.name === 'Agent trail')).toBe(true);
      await client.callTool({ name: 'undo', arguments: {} });
      expect(await snapshot()).toEqual(imported);
    } finally { await client.close(); }
  } finally {
    await app.close();
    rmSync(tempBase, { recursive: true, force: true });
  }
});
