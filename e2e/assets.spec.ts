import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import type { AtlasApi } from '../src/preload';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('indexes an asset folder, browses nested folders, searches tags and loads cached thumbnails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-e2e-assets-'));
  const images = join(root, 'Art', 'Trees'); mkdirSync(images, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL9sAAAAASUVORK5CYII=', 'base64');
  writeFileSync(join(images, 'Oak_Green.png'), png);
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(root,'userData')}`] });
  try {
    const win = await app.firstWindow();
    await win.evaluate(async path => { await (window as unknown as { atlasApi: AtlasApi }).atlasApi.registerPack(path); }, join(root,'Art'));
    await win.getByTestId('btn-assets').click();
    const panel = win.getByTestId('assets-panel');
    await expect(panel.getByText('1 assets', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '▸ Trees' }).click();
    await expect(panel.getByRole('button', { name: 'Oak_Green.png' })).toBeVisible();
    await expect(panel.locator('img')).toHaveJSProperty('naturalWidth', 96);
    await panel.getByLabel('Asset tag', { exact: true }).fill('stone');
    await expect(panel.getByText('0 assets', { exact: true })).toBeVisible();
    await panel.getByLabel('Asset tag', { exact: true }).fill('oak');
    await expect(panel.getByText('1 assets', { exact: true })).toBeVisible();
    await panel.getByLabel('Asset biome', { exact: true }).selectOption('forest');
    await expect(panel.getByText('1 assets', { exact: true })).toBeVisible();
    await panel.getByLabel('Asset purpose', { exact: true }).selectOption('tree');
    await expect(panel.getByText('1 assets', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Oak_Green.png' }).click();
    await panel.getByLabel('Selected asset themes', { exact: true }).fill('fey');
    await panel.getByRole('button', { name: 'Save tags', exact: true }).click();
    await panel.getByLabel('Asset theme', { exact: true }).selectOption('fey');
    await expect(panel.getByText('1 assets', { exact: true })).toBeVisible();
  } finally { await app.close(); }
});

test('MCP stamps portable props and textures with one undo step; UI can stamp the selected asset', async ({}, testInfo) => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-e2e-stamp-'));
  const art = join(root,'Art'); mkdirSync(art);
  const worldDir = join(root,'World');
  const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(root,'userData')}`] });
  try {
    const win = await app.firstWindow();
    const source = join(art,'Tree.png');
    const bytes = await app.evaluate(({ nativeImage }) => {
      const pixels = Buffer.alloc(200*400*4);
      for (let i=0;i<pixels.length;i+=4) { pixels[i]=40;pixels[i+1]=180;pixels[i+2]=40;pixels[i+3]=255; }
      return nativeImage.createFromBitmap(pixels,{ width:200,height:400 }).toPNG().toString('base64');
    });
    writeFileSync(source,Buffer.from(bytes,'base64'));
    await win.evaluate(async path => { await (window as unknown as { atlasApi: AtlasApi }).atlasApi.registerPack(path); },art);
    await win.getByTestId('btn-settings').click();
    const info = await win.evaluate(() => (window as unknown as { atlasApi: AtlasApi }).atlasApi.getAgentInfo());
    const client = new Client({ name:'asset-test',version:'1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url),{ requestInit:{ headers:{Authorization:`Bearer ${info.token}`} } }));
    try {
      const call = async (name: string, args: Record<string,unknown> = {}) => {
        const r = await client.callTool({name,arguments:args});
        expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
        return JSON.parse((r.content as Array<{text:string}>)[0]!.text);
      };
      await call('world_create',{worldDir,name:'Assets'});
      const found = await call('asset_search',{query:'tree'});
      expect(found.total).toBe(1);
      const packAssetId = found.assets[0].id;
      expect((await call('theme_get')).resolved.tree).toEqual(['builtin:tree']);
      await call('command_run',{commands:[
        {name:'map.create',input:{id:'site',name:'Site',kind:'site',bounds:{x:0,y:0,w:20,h:20}}},
      ]});
      const site = await call('map_get',{mapId:'site'});
      const layerId = site.layers[0].id;
      await call('command_run',{commands:[
        {name:'entity.add',input:{mapId:'site',entity:{id:'floor',type:'area',layerId,origin:'manual',rev:0,role:'floor',rings:[[{x:1,y:1},{x:8,y:1},{x:8,y:8},{x:1,y:8}],[{x:3,y:3},{x:5,y:3},{x:5,y:5},{x:3,y:5}]]}}},
        {name:'entity.add',input:{mapId:'site',entity:{id:'path',type:'path',layerId,origin:'manual',rev:0,role:'road',points:[{x:1,y:12},{x:8,y:12},{x:8,y:17}],width:1,closed:false}}},
        {name:'entity.add',input:{mapId:'site',entity:{id:'wall',type:'wall',layerId,origin:'manual',rev:0,points:[{x:12,y:12},{x:18,y:12}],blocksMove:true,blocksSight:true}}},
      ]});
      await call('command_run',{commands:[
        {name:'prop.stamp',input:{mapId:'site',layerId,id:'tree',packAssetId,x:12,y:5}},
        {name:'entity.setTexture',input:{mapId:'site',entityIds:['floor','path','wall'],packAssetId}},
        {name:'theme.setRole',input:{themeName:'default',role:'tree',packAssetIds:[packAssetId]}},
      ]});
      const map = await call('map_get',{mapId:'site'});
      expect(map.entities.tree.w).toBe(1.524); expect(map.entities.tree.h).toBe(3.048);
      expect(map.entities.floor.texture.assetId).toBe(map.entities.tree.assetId);
      expect((await call('theme_get')).roles.tree).toEqual([map.entities.tree.assetId]);
      expect(existsSync(join(worldDir,'assets',`${map.entities.tree.assetId}.png`))).toBe(true);
      const idx = JSON.parse(readFileSync(join(worldDir,'assets','index.json'),'utf8'));
      expect(idx[map.entities.tree.assetId]).toMatchObject({packName:'Art',pxPerSquare:200,width:200,height:400});
      const png = await client.callTool({name:'render_png',arguments:{mapId:'site',width:400,height:400}});
      expect(png.isError).toBeFalsy();
      const colors = await app.evaluate(({nativeImage}, data) => {
        const pixels = nativeImage.createFromBuffer(Buffer.from(data,'base64')).toBitmap();
        let green = 0;
        for (let i=0;i<pixels.length;i+=4) if(pixels[i+1]! > 120 && pixels[i]! < 80 && pixels[i+2]! < 80) green++;
        return green;
      }, (png.content as Array<{data:string}>)[0]!.data);
      expect(colors).toBeGreaterThan(8_000);
      const exported = await call('export_player_image', { mapId: 'site', pixelsPerSquare: 30 });
      expect(await app.evaluate(({nativeImage},data)=>{
        const pixels=nativeImage.createFromBuffer(Buffer.from(data,'base64')).toBitmap();
        let green=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]!>120&&pixels[i+2]!<80)green++;
        return green;
      },exported.data)).toBeGreaterThan(8_000);
      await win.evaluate(() => {
        const w = window as any;
        w.__atlasWorldStore.getState().setActiveMap('site');
        const v = w.__atlasViewStore.getState();
        v.setPanelMap('map-main', 'site'); v.setPanelCamera('map-main', { x: 20, y: 20, zoom: 18 });
      });
      const greenPixels = async (page: import('@playwright/test').Page) => app.evaluate(({ nativeImage }, data) => {
        const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64')), width = image.getSize().width, pixels = image.toBitmap();
        const greenAt = (x: number, y: number) => pixels[(y * width + x) * 4 + 1]! > 120 && pixels[(y * width + x) * 4 + 2]! < 80;
        return { floor: greenAt(56, 56), hole: greenAt(92, 92), path: greenAt(92, 236), wall: greenAt(290, 236), prop: greenAt(236, 110) };
      }, (await page.getByTestId('panel-map-main').locator('canvas').screenshot()).toString('base64'));
      const visibleArt = { floor: true, hole: false, path: true, wall: true, prop: true };
      await expect.poll(() => greenPixels(win)).toEqual(visibleArt);
      await win.getByTestId(`layer-visible-${layerId}`).click();
      await expect.poll(() => greenPixels(win)).toEqual({ floor: false, hole: false, path: false, wall: false, prop: false });
      await win.getByTestId(`layer-visible-${layerId}`).click();
      await expect.poll(() => greenPixels(win)).toEqual(visibleArt);
      const popupReady = win.waitForEvent('popup');
      await win.getByTestId('popout-btn-map-main').click();
      const popup = await popupReady;
      await expect.poll(() => greenPixels(popup)).toEqual(visibleArt);
      await popup.getByTestId('panel-map-main').screenshot({ path: testInfo.outputPath('textured-popout.png') });
      await win.getByTestId(`layer-visible-${layerId}`).click();
      await expect.poll(() => greenPixels(popup)).toEqual({ floor: false, hole: false, path: false, wall: false, prop: false });
      await win.getByTestId(`layer-visible-${layerId}`).click();
      await expect.poll(() => greenPixels(popup)).toEqual(visibleArt);
      await popup.getByTestId('dockback-btn-map-main').click();
      await expect.poll(() => greenPixels(win)).toEqual(visibleArt);
      // Visibility changes have their own undo steps; return to the stamping transaction.
      for (let i = 0; i < 4; i++) await call('undo');
      await call('undo'); const undone = await call('map_get',{mapId:'site'});
      expect(undone.entities.tree).toBeUndefined(); expect(undone.entities.floor.texture).toBeUndefined();
      expect((await call('theme_get')).resolved.tree).toEqual(['builtin:tree']);
      await call('redo');
      await win.getByTestId('btn-assets').click();
      await win.getByTestId('assets-panel').getByRole('button',{name:'Tree.png',exact:true}).click();
      await win.getByRole('button',{name:'Stamp on map'}).click();
      // Docking put Map alongside Assets; activate its tab before stamping.
      await win.locator('.dv-tab').filter({hasText:/^Map$/}).click();
      const canvas = win.getByTestId('canvas-host-map-main').locator('canvas');
      await canvas.click({position:{x:100,y:100}});
      await expect.poll(async () => Object.values((await call('map_get',{mapId:'site'})).entities).filter((e:any) => e.type==='prop').length).toBe(2);
      await win.getByTestId('btn-assets').click();
      await win.getByLabel('Theme role',{exact:true}).selectOption('rock');
      await win.getByRole('button',{name:'Add selected asset to role'}).click();
      await expect(win.getByTestId('theme-editor').getByRole('listitem')).toContainText('Tree.png');
      await expect.poll(async () => (await call('theme_get')).roles.rock?.length ?? 0).toBe(1);
      await win.getByRole('button',{name:'Remove Tree.png from role'}).click();
      await expect(win.getByTestId('theme-placeholder')).toContainText('rock');
      await call('undo');
      await expect(win.getByTestId('theme-editor').getByRole('listitem')).toContainText('Tree.png');
      await win.getByText('Built-in flat props',{exact:true}).click();
      await win.getByTestId('assets-panel').getByRole('button',{name:'bed',exact:true}).click();
      await win.getByRole('button',{name:'Stamp on map'}).click();
      await win.locator('.dv-tab').filter({hasText:/^Map$/}).click();
      await canvas.click({position:{x:150,y:120}});
      await expect.poll(async () => Object.values((await call('map_get',{mapId:'site'})).entities).some((e:any) => e.builtin==='bed')).toBe(true);
      await win.getByTestId('btn-save-now').click();
      await expect(win.getByTestId('save-status')).toContainText('Saved');
    } finally { await client.close(); }
  } finally { await app.close(); }
  // A fresh machine profile has no registered packs; copied art still renders.
  const app2 = await electron.launch({ args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(root,'second-machine')}`] });
  try {
    const win = await app2.firstWindow();
    await expect(win.getByTestId('btn-settings')).toBeVisible();
    const info = await win.evaluate(() => (window as unknown as {atlasApi:AtlasApi}).atlasApi.getAgentInfo());
    const client = new Client({name:'portable-test',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url),{requestInit:{headers:{Authorization:`Bearer ${info.token}`}}}));
    try {
      const opened = await client.callTool({name:'world_open',arguments:{worldDir}});
      expect(opened.isError,JSON.stringify(opened.content)).toBeFalsy();
      const theme=await client.callTool({name:'theme_get',arguments:{}});
      expect(JSON.parse((theme.content as Array<{text:string}>)[0]!.text).roles.tree).toHaveLength(1);
      const png = await client.callTool({name:'render_png',arguments:{mapId:'site',width:400,height:400}});
      expect(png.isError).toBeFalsy();
      const green = await app2.evaluate(({nativeImage},data) => {
        const pixels = nativeImage.createFromBuffer(Buffer.from(data,'base64')).toBitmap();
        let count=0; for(let i=0;i<pixels.length;i+=4) if(pixels[i+1]!>120 && pixels[i]!<80 && pixels[i+2]!<80) count++;
        return count;
      },(png.content as Array<{data:string}>)[0]!.data);
      expect(green).toBeGreaterThan(8_000);
    } finally { await client.close(); }
  } finally { await app2.close(); }
});

test('imports a Dungeondraft fixture through Settings and leaves the library unchanged for an invalid pack', async () => {
  const root=mkdtempSync(join(tmpdir(),'atlas-e2e-pck-'));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL9sAAAAASUVORK5CYII=','base64');
  const path=Buffer.from('res://packs/demo/textures/objects/Oak.png');
  const header=Buffer.alloc(88); header.write('GDPC');header.writeUInt32LE(1,4);header.writeUInt32LE(3,8);header.writeUInt32LE(1,84);
  const entry=Buffer.alloc(4+path.length+32);entry.writeUInt32LE(path.length);path.copy(entry,4);
  entry.writeBigUInt64LE(BigInt(88+entry.length),4+path.length);entry.writeBigUInt64LE(BigInt(png.length),12+path.length);
  const source=join(root,'Demo.dungeondraft_pack');writeFileSync(source,Buffer.concat([header,entry,png]));
  const bad=join(root,'Bad.dungeondraft_pack');writeFileSync(bad,'not a pack');
  const app=await electron.launch({args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(root,'userData')}`]});
  try {
    const win=await app.firstWindow();await win.getByTestId('btn-settings').click();
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
    await win.getByRole('button',{name:'Import Dungeondraft pack'}).click();
    await expect(win.getByLabel('Demo pixels per square')).toHaveValue('256');
    const before=await win.evaluate(()=>(window as unknown as {atlasApi:AtlasApi}).atlasApi.listPacks());
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},bad);
    await win.getByRole('button',{name:'Import Dungeondraft pack'}).click();
    await expect(win.getByRole('alert').filter({hasText:'Corrupt or unsupported'})).toBeVisible();
    expect(await win.evaluate(()=>(window as unknown as {atlasApi:AtlasApi}).atlasApi.listPacks())).toEqual(before);
    await win.getByTestId('btn-assets').click();
    await expect(win.getByTestId('assets-panel').getByRole('button',{name:'Oak.png'})).toBeVisible();
  } finally {await app.close();}
});
