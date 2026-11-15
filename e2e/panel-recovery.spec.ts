import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import coast from '../src/renderer/geom/fixtures/trace-coast.json';

test('renders the traced coastline that overflowed polygon ring nesting', async () => {
  const root=mkdtempSync(join(tmpdir(),'atlas-trace-coast-'));
  const app=await electron.launch({args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(root,'profile')}`]});
  try {
    const page=await app.firstWindow();
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},join(root,'world'));
    await page.getByTestId('btn-new-world').click();
    await page.evaluate(coast=>{
      const s=(window as any).__atlasWorldStore.getState(),map=s.world.maps[s.activeMapId];
      const base={type:'area',layerId:map.layers[0].id,origin:'manual',rev:0};
      const rings=(shape:number[][][][])=>shape[0]!.map(r=>r.map(([x,y])=>({x,y})));
      s.execute('map.setExtent',{mapId:map.id,bounds:{x:148000,y:90000,w:28000,h:11000}});
      s.execute('entity.add',{mapId:map.id,entity:{...base,id:'traced-land',role:'land',rings:rings(coast.land)}});
      s.execute('entity.add',{mapId:map.id,entity:{...base,id:'ocean',role:'water',waterKind:'ocean',rings:rings(coast.ocean)}});
    },coast);
    await page.getByTestId('fit-map').click();
    const panel=page.getByTestId('panel-map-main');
    await expect.poll(async()=>Number(await panel.getAttribute('data-entity-count'))).toBeGreaterThan(1);
    await expect.poll(async()=>Number(await panel.getAttribute('data-render-count'))).toBeGreaterThan(0);
    const png=await panel.locator('canvas').screenshot();
    const colors=await app.evaluate(({nativeImage},data)=>{
      const pixels=nativeImage.createFromBuffer(Buffer.from(data,'base64')).toBitmap();let land=0,water=0;
      for(let i=0;i<pixels.length;i+=4){const b=pixels[i]!,g=pixels[i+1]!,r=pixels[i+2]!;if(g>r*1.2&&g>b*1.05)land++;if(b>r*1.5&&b>g*1.1)water++;}
      return {land,water};
    },png.toString('base64'));
    expect(colors.land).toBeGreaterThan(100);expect(colors.water).toBeGreaterThan(100);
    await expect(page.getByRole('alert',{name:'Panel error'})).toHaveCount(0);
    await expect(page.getByTestId('error-banner')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {await app.close();}
});

test('a panel render failure keeps the toolbar and world alive and can be retried', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-panel-recovery-'));
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(root, 'profile')}`] });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(root, 'world'));
    await page.getByTestId('btn-new-world').click();
    await expect(page.getByTestId('panel-map-main')).toBeVisible();
    const source = await page.evaluate(() => {
      const store = (window as any).__atlasWorldStore;
      const state = store.getState(), source = structuredClone(state.world);
      // Disable persistence for the injected, deliberately invalid render input.
      const maps = structuredClone(source.maps);
      maps[state.activeMapId].layers[0].name = { invalid: 'render fault' };
      state.loadWorld(source.meta, maps, null);
      return source;
    });
    const retry = page.getByRole('button', { name: 'Retry panel' });
    await expect(retry).toBeVisible();
    await expect(page.getByRole('alert', { name: 'Panel error' })).toContainText(/React error #31|Objects are not valid as a React child/);
    await expect(page.getByTestId('btn-save-now')).toBeVisible();
    await expect(page.getByTestId('btn-open-world')).toBeVisible();
    await page.evaluate(world => { (window as any).__atlasWorldStore.getState().loadWorld(world.meta, world.maps, null); }, source);
    await retry.click();
    await expect(page.getByTestId('panel-map-main')).toBeVisible();
    await expect(page.getByTestId('panel-layers')).toBeVisible();
    await expect(retry).toHaveCount(0);
    await page.evaluate(() => { setTimeout(() => { throw new Error('Canvas callback failed'); }, 0); });
    await expect(page.getByTestId('error-banner')).toContainText('Canvas callback failed');
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.getByTestId('error-banner')).toHaveCount(0);
    await expect(page.getByTestId('panel-map-main')).toBeVisible();
  } finally { await app.close(); }
});
