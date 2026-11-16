import { _electron as electron } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Usage: node visual-review/rook-review.mjs [outDir] [caseNameRegex]
const dir = resolve(process.argv[2] ?? 'visual-review/rook-current');
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
mkdirSync(dir, { recursive: true });
const app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(dir, 'profile')}`] });
const client = new Client({ name: 'rook-visual-review', version: '1' });
try {
  const main = await app.firstWindow();
  await main.waitForFunction(() => Boolean(window.__atlasWorldStore));
  const info = await main.evaluate(() => window.atlasApi.getAgentInfo());
  await client.connect(new StreamableHTTPClientTransport(new URL(info.url), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }));
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
    return result.content;
  }
  async function command(name, input) { return call('command_run', { commands: [{ name, input }] }); }
  await call('world_create', { worldDir: join(dir, 'world'), name: 'Rook review' });
  const cases = [
    ['01-world', 'world', 'world', {}, undefined],
    ['02-settlement-city', 'settlement', 'city', { scale: 'city' }, undefined],
    ['02-settlement-town', 'settlement', 'city', { scale: 'town' }, undefined],
    ['02-settlement-village', 'settlement', 'city', { scale: 'village' }, undefined],
    ['02-settlement-hamlet', 'settlement', 'city', { scale: 'hamlet' }, undefined],
    ['03-site-woodland', 'site', 'glade', { clearings: 4, density: 1, water: true }, undefined],
    ['04-site-dungeon', 'site', 'dungeon', { mode: 'dungeon', rooms: 10 }, undefined],
    ['05-interior-tavern', 'interior', 'dungeon', { mode: 'building', rooms: 5, purpose: 'tavern' }, undefined],
    // Regions are developed from this seed's world and populated, like the app's Create location flow.
    ['06-region-coast', 'region', 'world', { mode: 'populate' }, { x: 740000, y: 290000, w: 260000, h: 260000 }],
    ['07-region-inland', 'region', 'world', { mode: 'populate' }, { x: 574000, y: 447000, w: 260000, h: 260000 }],
    // A one-mile settlement developed around the coastal region's first inherited world town (else its first town).
    ['08-settlement-from-region', 'settlement', 'city', {}, 'from:06-region-coast'],
  ];
  const summaries = [];
  for (const seed of [42, 7]) {
    for (const [name, kind, type, params, bounds] of cases) {
      const id = `${name}-${seed}`;
      if (only && name !== '01-world' && !only.test(name) && !(name === '06-region-coast' && only.test('08-settlement-from-region'))) continue;
      if (typeof bounds === 'string') {
        const parentMapId = `${bounds.slice(5)}-${seed}`;
        const parent = JSON.parse((await call('map_get', { mapId: parentMapId }))[0].text);
        const towns = Object.values(parent.entities).filter(e => e.type === 'prop' && e.symbolKind === 'settlement');
        const town = towns.find(e => e.origin === 'inherited') ?? towns[0];
        if (!town) { summaries.push({ id, error: 'no inherited town' }); continue; }
        const mile = 1609.344;
        await command('map.developArea', { parentMapId, childMapId: id, name: town.name, kind, rect: { x: town.x - mile / 2, y: town.y - mile / 2, w: mile, h: mile } });
      } else if (kind === 'region') await command('map.developArea', { parentMapId: `01-world-${seed}`, childMapId: id, name: id, kind, rect: bounds });
      else await command('map.create', { id, name: id, kind, ...(bounds ? { bounds } : {}) });
      const start = Date.now();
      try {
        await command('generator.run', { mapId: id, genId: 'review', type, seed, params, entireMap: true, layerId: 'layer-base' });
        const map = JSON.parse((await call('map_get', { mapId: id }))[0].text);
        writeFileSync(join(dir, `${id}.json`), JSON.stringify(map, null, 2));
        const png = await call('render_png', { mapId: id, width: 1200, height: kind === 'interior' ? 800 : 1200, view: 'gm' });
        writeFileSync(join(dir, `${id}.png`), Buffer.from(png[0].data, 'base64'));
        const counts = {};
        for (const e of Object.values(map.entities)) { const role = e.role ?? e.type; counts[role] = (counts[role] ?? 0) + 1; }
        summaries.push({ id, ms: Date.now() - start, counts });
        console.log(JSON.stringify(summaries.at(-1)));
      } catch (error) {
        summaries.push({ id, error: String(error) });
        console.log(JSON.stringify(summaries.at(-1)));
      }
    }
  }
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summaries, null, 2));
} finally {
  await client.close();
  await app.close();
}
