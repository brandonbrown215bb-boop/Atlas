import { createHash } from 'node:crypto';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { test,expect,_electron as electron } from '@playwright/test';
import { createWorldFolder,openWorldFolder,saveDirtyWorldFiles } from '../src/main/worldFs';

test('UI copies and forks worlds, then moves a map tree with undo and persisted source cleanup',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-transfer-ui-')),source=join(dir,'source'),target=join(dir,'target'),fork=join(dir,'fork');
  createWorldFolder(target,'Target');
  const app=await electron.launch({args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(dir,'profile')}`]});
  try {
    const main=await app.firstWindow();
    await main.waitForFunction(()=>Boolean((window as any).__atlasWorldStore));
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
    await main.getByTestId('btn-new-world').click();
    await expect(main.getByTestId('save-status')).toContainText('New World');
    await main.getByRole('button',{name:'World transfers',exact:true}).click();
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},target);
    await main.getByRole('button',{name:'Choose target world',exact:true}).click();
    await main.getByRole('button',{name:'Transfer map tree',exact:true}).click();
    await expect(main.getByRole('status',{name:'Transfer result'})).toContainText('copied to Target');
    expect(openWorldFolder(target).meta.maps).toHaveLength(2);
    expect(openWorldFolder(source).meta.maps).toHaveLength(1);
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},fork);
    await main.getByRole('button',{name:'Fork world',exact:true}).click();
    await expect(main.getByRole('status',{name:'Transfer result'})).toContainText('Fork saved');
    expect(openWorldFolder(fork).meta.forkedFrom?.worldId).toBe(openWorldFolder(source).meta.id);
    await main.getByLabel('Transfer mode').selectOption('move');
    await main.getByRole('button',{name:'Transfer map tree',exact:true}).click();
    await expect(main.getByRole('status',{name:'Transfer result'})).toContainText('moved to Target');
    expect(openWorldFolder(source).meta.maps).toHaveLength(0);
    expect(openWorldFolder(target).meta.maps).toHaveLength(3);
    await main.getByTestId('btn-undo').click();
    await main.getByTestId('btn-save-now').click();
    await expect.poll(()=>openWorldFolder(source).meta.maps.length).toBe(1);
  } finally {await app.close();}
});

test('linked copy previews conflicts, takes the chosen version with portable assets, and sync is undoable and idempotent',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'atlas-linked-ui-')),source=join(dir,'source'),target=join(dir,'target');
  createWorldFolder(target,'Target');
  const app=await electron.launch({args:[resolve(__dirname,'../out/main/index.js'),`--user-data-dir=${join(dir,'profile')}`]});
  try {
    const main=await app.firstWindow();await main.waitForFunction(()=>Boolean((window as any).__atlasWorldStore));
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
    await main.getByTestId('btn-new-world').click();await expect(main.getByTestId('save-status')).toContainText('New World');
    await main.evaluate(()=>{
      const s=(window as any).__atlasWorldStore.getState();
      s.execute('map.create',{id:'linked-room',name:'Linked room',kind:'interior',bounds:{x:0,y:0,w:20,h:20}});
      s.execute('entity.add',{mapId:'linked-room',entity:{id:'e',type:'label',text:'Original',x:2,y:2,size:12,origin:'manual',rev:0,layerId:'layer-base'}});
      s.setActiveMap('linked-room');
    });
    await main.getByRole('button',{name:'World transfers',exact:true}).click();
    await main.getByLabel('Transfer mode').selectOption('linked');
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},target);
    await main.getByRole('button',{name:'Choose target world',exact:true}).click();
    await main.getByRole('button',{name:'Transfer map tree',exact:true}).click();
    await expect(main.getByRole('status',{name:'Transfer result'})).toContainText('linked to Target');
    const remote=openWorldFolder(target),m=remote.maps['linked-room']!;
    m.revision++;const e=m.entities.e!;if(e.type!=='label')throw new Error();e.text='Theirs';e.rev=m.revision;
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK6cAAAAASUVORK5CYII=','base64'),assetId=createHash('sha1').update(bytes).digest('hex');
    writeFileSync(join(target,'assets',`${assetId}.png`),bytes);
    writeFileSync(join(target,'assets','index.json'),JSON.stringify({[assetId]:{originalName:'New.png',packName:'Other PC',pxPerSquare:200,width:1,height:1,ext:'png'}}));
    m.entities.art={id:'art',type:'prop',assetId,w:1,h:1,x:5,y:5,rotation:0,scale:1,flipX:false,layerId:'layer-base',origin:'manual',rev:m.revision};
    saveDirtyWorldFiles(target,remote);
    await main.evaluate(()=>{(window as any).__atlasWorldStore.getState().execute('entity.update',{mapId:'linked-room',entityId:'e',patch:{text:'Mine'}});});
    await main.getByRole('button',{name:'Preview linked sync',exact:true}).click();
    await expect(main.getByLabel('Resolve e')).toHaveValue('mine');
    await main.getByLabel('Resolve e').selectOption('theirs');
    const history=await main.evaluate(()=>(window as any).__atlasWorldStore.getState().history.past.length);
    await main.getByRole('button',{name:'Apply linked sync',exact:true}).click();
    await expect(main.getByRole('status',{name:'Transfer result'})).toContainText('Linked map synced');
    const state=await main.evaluate(()=>{const s=(window as any).__atlasWorldStore.getState();return {map:s.world.maps['linked-room'],history:s.history.past.length};});
    expect(state.map.entities.e.text).toBe('Theirs');expect(state.history).toBe(history+1);
    expect(openWorldFolder(source).maps['linked-room']!.entities.art).toBeDefined();
    await main.getByRole('button',{name:'Preview linked sync',exact:true}).click();
    await expect(main.getByText('0 incoming entity changes; 0 conflicts.',{exact:false})).toBeVisible();
    await main.getByRole('button',{name:'Apply linked sync',exact:true}).click();
    await expect(main.getByRole('status',{name:'Transfer result'})).toContainText('Linked map synced');
    expect(await main.evaluate(()=>(window as any).__atlasWorldStore.getState().history.past.length)).toBe(history+1);
    await main.getByTestId('btn-undo').click();
    expect(await main.evaluate(()=>(window as any).__atlasWorldStore.getState().world.maps['linked-room'].entities.e.text)).toBe('Mine');
  } finally {await app.close();}
});
