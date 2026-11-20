import { generationSettings, generationPanel } from './context-helpers';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, expect, _electron as electron } from '@playwright/test';
import type { Entity, MapDoc } from '../src/renderer/model/schema';

test('city: drawn constraints, district UI, named building preservation, interior and portable save',async({},testInfo)=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-city-'));
  const app=await electron.launch({args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(dir,'profile')}`]});
  const client=new Client({name:'city-test',version:'1'});
  try {
    const main=await app.firstWindow(); main.setDefaultTimeout(10_000);
    await main.waitForFunction(()=>Boolean((window as any).__atlasWorldStore));
    const info=await main.evaluate(()=>(window as any).atlasApi.getAgentInfo());
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url),{requestInit:{headers:{Authorization:`Bearer ${info.token}`}}}));
    const call=async(name:string,args:Record<string,unknown>={})=>{
      const result=await client.callTool({name,arguments:args});
      expect(result.isError,`${name}: ${JSON.stringify(result.content)}`).toBeFalsy();
      return JSON.parse((result.content as Array<{text:string}>)[0]!.text);
    };
    const command=(name:string,input:Record<string,unknown>)=>call('command_run',{commands:[{name,input}]});
    await call('world_create',{worldDir:join(dir,'world'),name:'City world'});
    await command('map.create',{id:'city',name:'Rookhaven',kind:'settlement',bounds:{x:0,y:0,w:650,h:450}});
    const base={origin:'manual',rev:0,layerId:'layer-base'};
    const rectangle=(x:number,y:number,w:number,h:number)=>[[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]];
    const entities=[
      {...base,id:'land',type:'area',role:'land',rings:rectangle(0,0,650,450),fill:'#7b855e'},
      {...base,id:'water',type:'area',role:'water',rings:rectangle(580,0,70,450)},
      {...base,id:'wall',type:'path',role:'cityWall',points:rectangle(40,30,500,390)[0],width:4,closed:true},
      {...base,id:'gate',type:'door',a:{x:40,y:217},b:{x:40,y:233},kind:'door',open:false},
      {...base,id:'east-gate',type:'door',a:{x:540,y:217},b:{x:540,y:233},kind:'door',open:false},
      {...base,id:'road',type:'path',role:'road',points:[{x:0,y:225},{x:580,y:225}],width:10,closed:false},
      {...base,id:'plateau',type:'area',role:'plateau',rings:rectangle(60,45,190,110),elevation:20},
      {...base,id:'left',name:'Old town',type:'area',role:'district',rings:rectangle(0,0,300,450),district:{density:.8,wealth:.4,activity:.8,access:'open'}},
      {...base,id:'right',name:'Garden quarter',type:'area',role:'district',rings:rectangle(300,0,280,450)},
      {...base,id:'inn',name:'The Anchor',type:'area',role:'building',rings:rectangle(260,250,25,20)},
    ];
    await call('command_run',{commands:entities.map(entity=>({name:'entity.add',input:{mapId:'city',entity}}))});
    await main.evaluate(()=>{
      const w=window as any;
      w.__atlasWorldStore.getState().setActiveMap('city');
      w.__atlasViewStore.getState().setPanelMap('map-main','city');
      w.__atlasViewStore.getState().setPanelCamera('map-main',{x:-20,y:-10,zoom:1});
      w.__atlasViewStore.getState().setSelection(['left']);
    });
    await (await generationPanel(main)).getByRole('button',{name:'Generate district',exact:true}).click();
    await expect((await generationPanel(main))).toHaveAttribute('aria-busy','false');
    expect(await (await generationPanel(main)).getByRole('alert').allTextContents()).toEqual([]);
    let map:MapDoc=await call('map_get',{mapId:'city'});
    const leftId=Object.keys(map.generators)[0]!;
    expect(map.generators[leftId]?.type).toBe('city');
    const art=join(dir,'Art');mkdirSync(art);
    const bytes=await app.evaluate(({nativeImage})=>{
      const pixels=Buffer.alloc(32*32*4);
      for(let y=0;y<32;y++)for(let x=0;x<32;x++) {const at=(y*32+x)*4;pixels[at]=x<16?230:20;pixels[at+1]=x<16?40:220;pixels[at+2]=x<16?40:230;pixels[at+3]=255;}
      return nativeImage.createFromBitmap(pixels,{width:32,height:32}).toPNG().toString('base64');
    });
    writeFileSync(join(art,'Roof.png'),Buffer.from(bytes,'base64'));
    await main.evaluate(path=>(window as any).atlasApi.registerPack(path),art);
    const found=await call('asset_search',{query:'roof'});
    await command('theme.setRole',{themeName:'roof-test',role:'roof',packAssetIds:[found.assets[0].id]});
    await main.evaluate(()=>(window as any).__atlasViewStore.getState().setSelection(['right']));
    await (await generationSettings(main)).getByLabel('Generator theme',{exact:true}).selectOption('roof-test');
    await (await generationPanel(main)).getByLabel('District preset',{exact:true}).selectOption('estates');
    await (await generationPanel(main)).getByRole('button',{name:'Generate district',exact:true}).click();
    await expect((await generationPanel(main))).toHaveAttribute('aria-busy','false');
    map=await call('map_get',{mapId:'city'});
    expect(Object.keys(map.generators)).toHaveLength(2);
    expect(map.entities.right).toMatchObject({district:{density:.35,wealth:.9,access:'restricted'}});
    const buildings=Object.values(map.entities).filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='building'&&e.origin==='generated');
    expect(buildings.length).toBeGreaterThan(40);
    const building=buildings.find(e=>e.genId===leftId)!;
    const roof=buildings.find(e=>e.texture?.fitToArea)!;
    expect(roof).toBeDefined();
    const ring=roof.rings[0]!,minX=Math.min(...ring.map(p=>p.x)),minY=Math.min(...ring.map(p=>p.y));
    const w=Math.max(...ring.map(p=>p.x))-minX,h=Math.max(...ring.map(p=>p.y))-minY;
    const samples=[.25,.75].map(f=>({x:ring[0]!.x+(ring[1]!.x-ring[0]!.x)*f+(ring[3]!.x-ring[0]!.x)*.5,y:ring[0]!.y+(ring[1]!.y-ring[0]!.y)*f+(ring[3]!.y-ring[0]!.y)*.5}));
    const png=await client.callTool({name:'render_png',arguments:{mapId:'city',width:300,height:300,rect:{x:minX,y:minY,w,h}}});
    expect(png.isError).toBeFalsy();
    const data=(png.content as Array<{data:string}>)[0]!.data;
    writeFileSync(testInfo.outputPath('roof-fit.png'),Buffer.from(data,'base64'));
    const colors=await app.evaluate(({nativeImage},{data,samples,minX,minY,w,h})=>{
      const pixels=nativeImage.createFromBuffer(Buffer.from(data,'base64')).toBitmap(),zoom=Math.min(300/w,300/h);
      return samples.map(p=>{const at=(Math.floor((p.y-minY)*zoom)*300+Math.floor((p.x-minX)*zoom))*4;return [...pixels.subarray(at,at+3)];});
    },{data,samples,minX,minY,w,h});
    expect(colors[0]![0]).toBeGreaterThan(150);expect(colors[0]![2]).toBeLessThan(80);
    expect(colors[1]![2]).toBeGreaterThan(150);expect(colors[1]![0]).toBeLessThan(80);
    await command('place.create',{mapId:'city',id:'shop',name:'The Map Shop',entityIds:[building.id],notes:'Maps and charts',gmNotes:'The old route is missing'});
    await command('map.generateInterior',{parentMapId:'city',buildingId:building.id,placeId:'shop',childMapId:'shop-interior',seed:5,params:{mode:'chamber',density:0}});
    const before:MapDoc=await call('map_get',{mapId:'city'});
    await command('generator.reroll',{mapId:'city',genId:leftId,seed:17});
    const after:MapDoc=await call('map_get',{mapId:'city'});
    expect(after.entities[building.id]).toEqual(before.entities[building.id]);
    expect(after.entities.shop).toEqual(before.entities.shop);
    expect(after.entities.inn).toEqual(before.entities.inn);
    for(const e of Object.values(before.entities).filter(e=>e.genId&&e.genId!==leftId)) expect(after.entities[e.id]).toEqual(e);
    await call('undo');expect(await call('map_get',{mapId:'city'})).toEqual(before);await call('redo');
    const panel=main.getByTestId('panel-map-main');
    const renders=()=>panel.getAttribute('data-render-count').then(Number);
    const initialCount=await renders();
    await main.evaluate(()=>(window as any).__atlasViewStore.getState().setSelection([]));
    await expect.poll(renders).toBeGreaterThan(initialCount);
    const beforeSelection=await panel.locator('canvas').screenshot({path:testInfo.outputPath('before-selection.png')});
    const count=await renders();
    await main.evaluate(()=>(window as any).__atlasViewStore.getState().setSelection(['right']));
    await expect.poll(renders).toBeGreaterThan(count);
    const selectedCount=await renders();
    await main.evaluate(()=>(window as any).__atlasViewStore.getState().setSelection([]));
    await expect.poll(renders).toBeGreaterThan(selectedCount);
    const afterSelection=await panel.locator('canvas').screenshot({path:testInfo.outputPath('after-selection.png')});
    const changed=await app.evaluate(({nativeImage},{before,after})=>{
      const a=nativeImage.createFromBuffer(Buffer.from(before,'base64')).toBitmap(),b=nativeImage.createFromBuffer(Buffer.from(after,'base64')).toBitmap();
      let count=0;for(let i=0;i<a.length;i+=4) if(Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]!-b[i+c]!)))>8)count++;
      return {count,pixels:a.length/4};
    },{before:beforeSelection.toString('base64'),after:afterSelection.toString('base64')});
    expect(changed.count/changed.pixels).toBeLessThan(.001);
    await main.evaluate(()=>(window as any).__atlasViewStore.getState().setPanelCamera('map-main',{x:-20,y:-10,zoom:.58}));
    await main.getByTestId('btn-save-now').click();
    await expect(main.getByTestId('save-status')).toContainText('Saved');
    expect(JSON.parse(readFileSync(join(dir,'world','maps','city.json'),'utf8'))).toEqual(after);
    expect(JSON.parse(readFileSync(join(dir,'world','maps','shop-interior.json'),'utf8')).parent.footprintEntityId).toBe(building.id);
    await panel.screenshot({path:testInfo.outputPath('city.png')});
  } finally {await client.close();await app.close();}
});
