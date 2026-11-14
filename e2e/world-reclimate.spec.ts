import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, expect, _electron as electron } from '@playwright/test';
import { createWorldFolder, openWorldFolder, saveDirtyWorldFiles } from '../src/main/worldFs';
import { ClimateSchema } from '../src/renderer/model/schema';

test('phase 7: UI moves and MCP copies re-climate biomes while keeping manual work and developed maps', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-reclimate-')), source = join(dir, 'cold'), target = join(dir, 'hot'), agentTarget = join(dir, 'agent-hot');
  for (const path of [target, agentTarget]) {
    const w = createWorldFolder(path, 'Hot world');
    w.meta.climate = ClimateSchema.parse({ temperature: .8, moisture: -.8, northLatitude: 0, southLatitude: 0 });
    w.maps['map-1']!.bounds = { x: 0, y: 0, w: 1000000, h: 800000 };
    saveDirtyWorldFiles(path, w);
  }
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(dir, 'profile')}`] });
  const client = new Client({ name: 'reclimate-test', version: '1' });
  try {
    const main = await app.firstWindow();
    await main.waitForFunction(() => Boolean((window as any).__atlasWorldStore));
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, source);
    await main.getByTestId('btn-new-world').click();
    await expect(main.getByTestId('save-status')).toContainText('New World');
    const before = await main.evaluate(() => {
      const s = (window as any).__atlasWorldStore.getState();
      s.execute('world.setClimate', { climate: { temperature: -.8, northLatitude: 0, southLatitude: 0 } });
      s.execute('map.create', { id: 'region', name: 'Arrival region', kind: 'region', bounds: { x: 0, y: 0, w: 100000, h: 80000 } });
      s.execute('entity.add', { mapId: 'region', entity: { id: 'footprint', type: 'area', role: 'land', origin: 'manual', layerId: 'layer-base', rev: 0,
        rings: [[{ x: 0, y: 0 }, { x: 100000, y: 0 }, { x: 100000, y: 80000 }, { x: 0, y: 80000 }]] } });
      s.execute('generator.run', { mapId: 'region', genId: 'g', type: 'world', seed: 9, params: { cells: 1000, density: 0, settlements: 0 }, regionEntityId: 'footprint', layerId: 'layer-base' });
      s.execute('entity.add', { mapId: 'region', entity: { id: 'manual-biome', name: 'Ancient forest', type: 'area', role: 'biome:ancient', origin: 'manual', layerId: 'layer-base', rev: 0,
        rings: [[{ x: 35000, y: 25000 }, { x: 45000, y: 25000 }, { x: 45000, y: 35000 }, { x: 35000, y: 35000 }]] } });
      s.execute('map.developArea', { parentMapId: 'region', childMapId: 'camp', name: 'Developed camp', kind: 'site', rect: { x: 50000, y: 40000, w: 2000, h: 2000 } });
      s.execute('entity.add', { mapId: 'camp', entity: { id: 'camp-note', type: 'label', text: 'Keep this camp', x: 10, y: 10, size: 12, gmOnly: true, origin: 'manual', layerId: 'layer-base', rev: 0 } });
      s.execute('place.create', { mapId: 'region', name: 'My camp', category: 'camp', notes: 'Public notes', gmNotes: 'Secrets', entityIds: ['manual-biome'], childMapId: 'camp' });
      s.setActiveMap('region');
      return (window as any).__atlasWorldStore.getState().world;
    });
    await main.getByRole('button', { name: 'World transfers', exact: true }).click();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, target);
    await main.getByRole('button', { name: 'Choose target world', exact: true }).click();
    await main.getByLabel('Target parent map').selectOption('map-1');
    await main.getByLabel('Underlying geography').selectOption('merge');
    await main.getByLabel('X (m)', { exact: true }).fill('200000');
    await main.getByLabel('Y (m)', { exact: true }).fill('200000');
    await main.getByLabel('Re-climate on arrival').check();
    await main.getByLabel('Transfer mode').selectOption('move');
    await main.getByRole('button', { name: 'Transfer map tree', exact: true }).click();
    await expect(main.getByRole('status', { name: 'Transfer result' })).toContainText('moved to Hot world');
    const remote = openWorldFolder(target), region = Object.values(remote.maps).find(m => m.name === 'Arrival region')!;
    expect(Object.values(region.entities).some(e => e.type === 'area' && e.origin === 'generated' && e.role === 'biome:desert')).toBe(true);
    expect(Object.values(region.entities).find(e => e.name === 'Ancient forest')).toMatchObject({ origin: 'manual', role: 'biome:ancient', rings: before.maps.region.entities['manual-biome'].rings });
    const place = Object.values(region.entities).find(e => e.type === 'place' && e.name === 'My camp')!;
    expect(place).toMatchObject({ notes: 'Public notes', gmNotes: 'Secrets' });
    if (place.type !== 'place') throw new Error();
    const camp = remote.maps[place.childMapId!]!;
    expect(camp.bounds).toEqual(before.maps.camp.bounds);
    expect(Object.values(camp.entities).find(e => e.type === 'label' && e.text === 'Keep this camp')).toBeDefined();
    expect(openWorldFolder(source).maps.region).toBeUndefined();
    await main.getByTestId('btn-undo').click();
    expect(await main.evaluate(() => (window as any).__atlasWorldStore.getState().world)).toEqual(before);
    await main.getByTestId('btn-save-now').click();
    await expect.poll(() => openWorldFolder(source).maps.region).toEqual(before.maps.region);
    const info = await main.evaluate(() => (window as any).atlasApi.getAgentInfo());
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }));
    const result = await client.callTool({ name: 'world_copy_map', arguments: { targetDir: agentTarget, mapId: 'region', mode: 'copy', placement: {
      parentMapId: 'map-1', x: 200000, y: 200000, rotation: 0, scale: 1, underneath: 'merge', seamMargin: 0, reClimate: true,
    } } });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    const copied = Object.values(openWorldFolder(agentTarget).maps).find(m => m.name === 'Arrival region')!;
    expect(Object.values(copied.entities).some(e => e.type === 'area' && e.origin === 'generated' && e.role === 'biome:desert')).toBe(true);
    expect(openWorldFolder(source).maps.region).toEqual(before.maps.region);
  } finally { await client.close(); await app.close(); }
});
