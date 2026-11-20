import { generationSettings, generationPanel } from './context-helpers';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, expect, _electron as electron } from '@playwright/test';
import type { MapDoc } from '../src/renderer/model/schema';

test('phase 6: MCP woodland generation, UI settings, reroll, accept, undo and portable save', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-outdoor-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(dir, 'profile')}`] });
  const client = new Client({ name: 'outdoor-test', version: '1' });
  try {
    const main = await app.firstWindow(); main.setDefaultTimeout(10_000);
    await main.waitForFunction(() => Boolean((window as any).__atlasWorldStore));
    const info = await main.evaluate(() => (window as unknown as { atlasApi: import('../src/preload').AtlasApi }).atlasApi.getAgentInfo());
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).toBeFalsy();
      return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    };
    const command = (name: string, input: Record<string, unknown>) => call('command_run', { commands: [{ name, input }] });
    await call('world_create', { worldDir: join(dir, 'world'), name: 'Woodland world' });
    await call('command_run', { commands: [
      { name: 'map.create', input: { id: 'forest', name: 'Woodland', kind: 'site', bounds: { x: 0, y: 0, w: 80, h: 65 } } },
      { name: 'entity.add', input: { mapId: 'forest', entity: { id: 'footprint', type: 'area', role: 'land', origin: 'manual', layerId: 'layer-base', rev: 0,
        rings: [[{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 65 }, { x: 0, y: 65 }]] } } },
      { name: 'generator.run', input: { mapId: 'forest', genId: 'woods', type: 'glade', seed: 1, params: { clearings: 6, density: 1, water: true }, regionEntityId: 'footprint', layerId: 'layer-base' } },
    ] });
    const generated: MapDoc = await call('map_get', { mapId: 'forest' });
    expect(Object.values(generated.entities).filter(e => e.type === 'label')).toHaveLength(6);
    expect(Object.values(generated.entities).some(e => e.name === 'Stream bridge')).toBe(true);
    expect(Object.values(generated.entities).some(e => e.name === 'Pond')).toBe(true);
    const tree = Object.values(generated.entities).find(e => e.type === 'prop' && e.name === 'Tree')!;
    await command('entity.update', { mapId: 'forest', entityId: tree.id, patch: { name: 'Keep this tree' } });
    const before: MapDoc = await call('map_get', { mapId: 'forest' });
    await command('generator.reroll', { mapId: 'forest', genId: 'woods', seed: 4, params: { clearings: 6, density: 1, water: false } });
    const rerolled: MapDoc = await call('map_get', { mapId: 'forest' });
    expect(rerolled.entities[tree.id]).toEqual(before.entities[tree.id]);
    expect(Object.values(rerolled.entities).some(e => e.name === 'Stream' || e.name === 'Pond')).toBe(false);
    await call('undo'); expect(await call('map_get', { mapId: 'forest' })).toEqual(before);
    await main.evaluate(() => {
      const w = window as any;
      w.__atlasWorldStore.getState().setActiveMap('forest');
      w.__atlasViewStore.getState().setPanelMap('map-main', 'forest');
      w.__atlasViewStore.getState().setSelection(['footprint']);
    });
    await generationSettings(main);
    await main.evaluate(() => {
      const host = document.querySelector('[data-testid="panel-map-main"]')!, rect = host.getBoundingClientRect();
      const zoom = Math.min(rect.width / 80, rect.height / 65) * .85;
      (window as any).__atlasViewStore.getState().setPanelCamera('map-main', { x: rect.width / 2 - 40 * zoom, y: rect.height / 2 - 32.5 * zoom, zoom });
    });
    await expect(main.getByTestId('generation-settings').getByLabel('Clearing count')).toHaveValue('6');
    await expect(main.getByLabel('Outdoor water')).toBeChecked();
    await expect(main.getByRole('button', { name: 'Reroll dressing only', exact: true })).toHaveCount(0);
    await main.getByTestId('generation-settings').getByText('Entrances',{exact:true}).click();
    await main.getByRole('button', { name: 'Add entrance', exact: true }).click();
    await main.getByLabel('Entrance 1 x (ft)').fill('0');
    await main.getByLabel('Entrance 1 y (ft)').fill('50');
    await main.getByLabel('Outdoor water').uncheck();
    await (await generationPanel(main)).getByRole('button', { name: 'Try another', exact: true }).click();
    await expect((await generationPanel(main))).toHaveAttribute('aria-busy','false');
    await expect((await generationPanel(main)).getByRole('alert')).toHaveCount(0);
    const fromUI: MapDoc = await call('map_get', { mapId: 'forest' });
    expect(fromUI.generators.woods).toMatchObject({ type: 'glade', seed: 2, params: { water: false, entrances: [{ x: 0, y: 15.24 }] } });
    await generationSettings(main);
    await expect(main.getByLabel('Entrance 1 y (ft)')).toHaveValue('50');
    await call('undo');
    // Visual QA uses the fully rendered map with the built-in tree and bridge roles.
    await expect.poll(() => main.getByTestId('panel-map-main').getAttribute('data-entity-count')).toBe(String(Object.keys(before.entities).length));
    await main.screenshot({ path: resolve(__dirname, '../test-results/outdoor-generator.png') });
    await (await generationPanel(main)).getByText('More…',{exact:true}).click();
    await (await generationPanel(main)).getByRole('button', { name: 'Make independent', exact: true }).click();
    const accepted: MapDoc = await call('map_get', { mapId: 'forest' });
    expect(accepted.generators).toEqual({});
    expect(Object.values(accepted.entities).every(e => e.origin === 'manual')).toBe(true);
    await call('undo'); expect(await call('map_get', { mapId: 'forest' })).toEqual(before);
    await main.getByTestId('btn-save-now').click();
    await expect(main.getByTestId('save-status')).toContainText('Saved');
    expect(JSON.parse(readFileSync(join(dir, 'world', 'maps', 'forest.json'), 'utf8'))).toEqual(before);
    const rejected = await client.callTool({ name: 'command_run', arguments: { commands: [{ name: 'generator.run', input: { mapId: 'forest', type: 'glade', seed: 1, params: { clearings: 0 }, regionEntityId: 'footprint', layerId: 'layer-base' } }] } });
    expect(rejected.isError).toBe(true);
    expect(await call('map_get', { mapId: 'forest' })).toEqual(before);
  } finally { await client.close(); await app.close(); }
});
