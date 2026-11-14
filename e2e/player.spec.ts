import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('player window shares live map state and hides private content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-player-'));
  const app = await electron.launch({args:[resolve(__dirname,'../out/main/index.js'), `--user-data-dir=${join(dir,'profile')}`]});
  try {
    const main = await app.firstWindow();
    await app.evaluate(({dialog}, path) => {dialog.showOpenDialog = async () => ({canceled:false,filePaths:[path]});},join(dir,'world'));
    await main.getByTestId('btn-new-world').click();
    await expect(main.getByTestId('save-status')).toContainText('New World');
    const playerReady = app.waitForEvent('window');
    await main.getByTestId('btn-player-window').click();
    const player = await playerReady;
    await expect(player.getByTestId('player-image')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const before = await player.getByTestId('player-image').getAttribute('src');
    await main.evaluate(() => {
      const store = (window as any).__atlasWorldStore;
      const state = store.getState();
      const map = state.world.maps[state.activeMapId];
      state.execute('entity.add',{mapId:map.id, entity:{id:'public',type:'label',origin:'manual',rev:0,layerId:map.layers[0].id,x:10,y:10,text:'Visible',size:12}});
    });
    await expect.poll(() => player.getByTestId('player-image').getAttribute('src')).not.toBe(before);
    const publicImage = await player.getByTestId('player-image').getAttribute('src');
    await main.evaluate(() => {
      const state = (window as any).__atlasWorldStore.getState();
      const map = state.world.maps[state.activeMapId];
      state.execute('entity.add',{mapId:map.id, entity:{id:'private',type:'label',origin:'manual',rev:0,layerId:map.layers[0].id,gmOnly:true,x:10,y:10,text:'SECRET',size:120}});
    });
    await expect(player.getByTestId('player-image')).toHaveAttribute('src', publicImage!);
    await main.getByRole('button',{name:'Hide all',exact:true}).click();
    await expect.poll(async () => {
      const src = await player.getByTestId('player-image').getAttribute('src');
      if (!src) return false;
      return app.evaluate(({nativeImage}, data) => {
        const pixels=nativeImage.createFromDataURL(data).toBitmap();
        for(let i=0;i<pixels.length;i+=4) if(pixels[i] || pixels[i+1] || pixels[i+2]) return false;
        return true;
      },src);
    }).toBe(true);
    await main.getByRole('button',{name:'Reveal all',exact:true}).click();
    await expect.poll(() => player.getByTestId('player-image').getAttribute('src')).not.toBeNull();
    const held = await player.getByTestId('player-image').getAttribute('src');
    await main.evaluate(() => {
      const state=(window as any).__atlasWorldStore.getState();
      state.execute('map.create',{id:'another',name:'Another GM map',kind:'interior'});
      state.setActiveMap('another');
    });
    await expect(main.getByLabel('Player map')).toHaveValue('map-1');
    await expect(player.getByTestId('player-image')).toHaveAttribute('src',held!);
    await player.close();
    const again = app.waitForEvent('window');
    await main.getByTestId('btn-player-window').click();
    await expect((await again).getByTestId('player-image')).toHaveAttribute('src', /^data:image\/png;base64,/);
  } finally { await app.close(); }
});
