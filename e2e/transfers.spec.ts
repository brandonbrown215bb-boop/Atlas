import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { test,expect,_electron as electron } from '@playwright/test';
import { createWorldFolder,openWorldFolder } from '../src/main/worldFs';

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
