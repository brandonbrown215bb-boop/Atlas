import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, expect, _electron as electron } from '@playwright/test';
import type { MapDoc } from '../src/renderer/model/schema';
import { pointInPolygon } from '../src/renderer/geom/hitTest';

test('phase 7: continent commands, UI settings, manual lake reroll, undo and save', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-continent-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(dir, 'profile')}`] });
  const client = new Client({ name: 'continent-test', version: '1' });
  try {
    const main = await app.firstWindow();
    await main.waitForFunction(() => Boolean((window as any).__atlasWorldStore));
    const info = await main.evaluate(() => (window as any).atlasApi.getAgentInfo());
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).toBeFalsy();
      return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    };
    const command = (name: string, input: Record<string, unknown>) => call('command_run', { commands: [{ name, input }] });
    await call('world_create', { worldDir: join(dir, 'world'), name: 'Continent world' });
    await command('map.create', { id: 'continent', name: 'Continent', kind: 'world', bounds: { x: 0, y: 0, w: 1000000, h: 800000 } });
    await command('entity.add', { mapId: 'continent', entity: { id: 'footprint', type: 'area', role: 'land', origin: 'manual', layerId: 'layer-base', rev: 0,
      rings: [[{ x: 0, y: 0 }, { x: 1000000, y: 0 }, { x: 1000000, y: 800000 }, { x: 0, y: 800000 }]] } });
    await command('generator.run', { mapId: 'continent', genId: 'terrain', type: 'world', seed: 9, params: {}, regionEntityId: 'footprint', layerId: 'layer-base' });
    const generated: MapDoc = await call('map_get', { mapId: 'continent' });
    expect(Object.values(generated.entities).some(e => e.type === 'area' && e.role === 'land' && e.origin === 'generated')).toBe(true);
    expect(Object.values(generated.entities).some(e => e.type === 'area' && e.role.startsWith('biome:'))).toBe(true);
    expect(Object.values(generated.entities).some(e => e.type === 'path' && e.role === 'river')).toBe(true);
    await command('entity.add', { mapId: 'continent', entity: { id: 'lake', type: 'area', role: 'water', origin: 'manual', layerId: 'layer-base', rev: 0,
      rings: [[{ x: 400000, y: 300000 }, { x: 600000, y: 300000 }, { x: 600000, y: 500000 }, { x: 400000, y: 500000 }]] } });
    const before: MapDoc = await call('map_get', { mapId: 'continent' });
    await main.evaluate(() => {
      const w = window as any;
      w.__atlasWorldStore.getState().setActiveMap('continent');
      w.__atlasViewStore.getState().setPanelMap('map-main', 'continent');
      w.__atlasViewStore.getState().setSelection(['footprint']);
    });
    await main.getByTestId('btn-generator').click();
    await main.getByLabel('Generator run').selectOption('terrain');
    await expect(main.getByLabel('Generator type')).toHaveValue('world');
    await expect(main.getByLabel('Sea level')).toHaveValue('0.45');
    await expect(main.getByLabel('World decoration density')).toHaveValue('1');
    await expect(main.getByLabel('Settlement suggestion count')).toHaveValue('12');
    const suggestions = main.getByTestId('settlement-suggestion');
    await expect(suggestions).toHaveCount(12);
    await suggestions.first().getByLabel('Settlement name').fill('Rookhaven');
    await suggestions.first().getByRole('button', { name: 'Accept settlement', exact: true }).click();
    await expect(suggestions).toHaveCount(11);
    const accepted: MapDoc = await call('map_get', { mapId: 'continent' });
    const place = Object.values(accepted.entities).find(e => e.type === 'place' && e.name === 'Rookhaven')!;
    expect(place).toBeDefined();
    await suggestions.first().getByRole('button', { name: 'Dismiss settlement', exact: true }).click();
    await expect(suggestions).toHaveCount(10);
    await call('undo'); await expect(suggestions).toHaveCount(11);
    await call('undo'); await expect(suggestions).toHaveCount(12);
    await main.getByText('World climate and biome table', { exact: true }).click();
    await main.getByLabel('Temperature bias').fill('-0.4');
    await main.getByRole('button', { name: 'Add custom biome rule', exact: true }).click();
    await main.getByLabel('Biome 1 name', { exact: true }).fill('crystal wastes');
    await main.getByRole('button', { name: 'Apply world climate', exact: true }).click();
    await expect(main.getByTestId('panel-generator').getByRole('alert')).toHaveCount(0);
    // The climate command is a separate undo step from the terrain reroll.
    await main.getByLabel('Sea level').fill('0.5');
    await main.getByText('World climate and biome table', { exact: true }).click();
    await main.getByRole('button', { name: 'Reroll', exact: true }).click();
    await expect(main.getByTestId('panel-generator').getByRole('alert')).toHaveCount(0);
    const rerolled: MapDoc = await call('map_get', { mapId: 'continent' });
    expect(rerolled.entities.lake).toEqual(before.entities.lake);
    expect(rerolled.generators.terrain).toMatchObject({ type: 'world', seed: 10, params: { seaLevel: .5 } });
    expect(Object.values(rerolled.entities).some(e => e.type === 'area' && e.role === 'land' && e.origin === 'generated' && pointInPolygon({ x: 500000, y: 400000 }, e.rings))).toBe(false);
    await main.evaluate(() => {
      const rect = document.querySelector('[data-testid="panel-map-main"]')!.getBoundingClientRect();
      const zoom = Math.min(rect.width / 1000000, rect.height / 800000) * .9;
      (window as any).__atlasViewStore.getState().setPanelCamera('map-main', { x: rect.width / 2 - 500000 * zoom, y: rect.height / 2 - 400000 * zoom, zoom });
    });
    await expect.poll(() => main.getByTestId('panel-map-main').getAttribute('data-entity-count')).toBe(String(Object.keys(rerolled.entities).length));
    await main.screenshot({ path: resolve(__dirname, '../test-results/continent-generator.png') });
    await call('undo'); expect(await call('map_get', { mapId: 'continent' })).toEqual(before);
    await call('redo'); expect(await call('map_get', { mapId: 'continent' })).toEqual(rerolled);
    await main.getByTestId('btn-save-now').click();
    await expect(main.getByTestId('save-status')).toContainText('Saved');
    expect(JSON.parse(readFileSync(join(dir, 'world', 'maps', 'continent.json'), 'utf8'))).toEqual(rerolled);
    const savedClimate = JSON.parse(readFileSync(join(dir, 'world', 'world.json'), 'utf8')).climate;
    expect(savedClimate.temperature).toBe(-.4);
    expect(savedClimate.biomes[0].name).toBe('crystal wastes');
    const marker = Object.values(rerolled.entities).find(e => e.type === 'prop' && e.suggestedSettlement)!;
    expect(marker).toBeDefined();
    await command('settlement.resolveSuggestion', { mapId: 'continent', entityId: marker.id, action: 'accept', name: 'Permanent town' });
    const withTown: MapDoc = await call('map_get', { mapId: 'continent' });
    await command('generator.reroll', { mapId: 'continent', genId: 'terrain', seed: 11 });
    const withTownRerolled: MapDoc = await call('map_get', { mapId: 'continent' });
    expect(withTownRerolled.entities[marker.id]).toEqual(withTown.entities[marker.id]);
  } finally { await client.close(); await app.close(); }
});
