import { chooseTool, clearStage, restoreStage, openPanel } from './context-helpers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('traces the city reference, searches three shop places and reopens their pyramid interior after restart', async ({}, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-reference-check-'));
  const args = [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${join(dir, 'profile')}`];
  let app = await electron.launch({ args });
  try {
    const main = await app.firstWindow(); main.setDefaultTimeout(10_000);
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(dir, 'world'));
    await main.getByTestId('btn-new-world').click();
    await expect(main.getByTestId('save-status')).toContainText('New World');
    await openPanel(main, 'newMap');
    await main.getByTestId('input-new-map-name').fill('Khartoum');
    await openPanel(main, 'newMap');
    await main.getByTestId('select-new-map-kind').selectOption('settlement');
    await main.getByTestId('btn-create-map').click();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, resolve(__dirname, '../docs/bundle/reference-maps/03-khartoum-city.jpg'));
    await openPanel(main, 'newMap');
    await main.getByTestId('btn-import-backdrop').click();
    await expect(main.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count', '1');
    const townId = await main.evaluate(() => (window as any).__atlasWorldStore.getState().activeMapId);
    const canvas = main.getByTestId('panel-map-main').locator('canvas');
    const draw = async (tool: string, points: number[][]) => {
      await chooseTool(main,tool);
      if (tool === 'area') await main.getByTestId('select-area-role').selectOption('building');
      await clearStage(main); // the trace spans the whole canvas, under where panels float
      const box = (await canvas.boundingBox())!;
      const side = Math.min(box.width, box.height) - 40;
      await main.evaluate(side => {
        const v = (window as any).__atlasViewStore;
        v.setState({ snapToGrid: false, wallSnapToGrid: false });
        v.getState().setPanelCamera('map-main', { x: 20, y: 20, zoom: side / 400 });
      }, side);
      for (const [x, y] of points) await main.mouse.click(box.x + 20 + x! / 1280 * side, box.y + 20 + y! / 1280 * side);
      await canvas.press('Enter');
      await restoreStage(main);
      return main.evaluate(() => (window as any).__atlasViewStore.getState().selectedEntityIds[0] as string);
    };
    const coast = await draw('path', [[0,1166],[120,1140],[260,1080],[355,1032],[415,1025],[590,1028],[676,1020],[676,934],[629,932],[683,912],[710,877],[682,830],[660,775],[664,695],[687,644],[723,619],[770,622],[813,651],[853,687],[925,732],[950,782],[1000,803],[1070,770],[1120,718],[1175,704],[1280,690]]);
    const wall = await draw('wall', [[268,834],[278,690],[283,555],[293,474],[331,403],[387,355],[450,335],[535,322],[627,320],[718,330],[803,337],[854,327],[895,296],[916,250],[900,205],[864,154],[819,118],[720,95],[610,67],[480,48],[370,40],[270,41],[187,66],[123,113],[91,184],[85,300],[91,414],[91,570],[84,727],[92,785],[132,824],[202,837],[268,834]]);
    const shops: string[] = [];
    for (const points of [
      [[441,510],[498,510],[501,570],[443,574]],
      [[523,473],[570,473],[570,523],[523,523]],
      [[580,590],[627,590],[627,644],[580,644]],
    ]) shops.push(await draw('area', points));
    const town = await main.evaluate(id => (window as any).__atlasWorldStore.getState().world.maps[id], townId);
    expect(town.entities[coast].type).toBe('path');
    expect(town.entities[wall].type).toBe('wall');
    expect(shops.every(id => town.entities[id].role === 'building')).toBe(true);
    expect(new Set(shops).size).toBe(3);
    await main.getByTestId('btn-places').click();
    for (let i = 0; i < shops.length; i++) {
      await main.evaluate(id => (window as any).__atlasViewStore.getState().setSelection([id]), shops[i]!);
      await main.getByTestId('place-create-name').fill(['Pyramid Curios', 'Harbor Smith', 'Spice House'][i]!);
      await main.getByTestId('place-create-category').fill('Shop');
      await main.getByTestId('btn-create-place').click();
    }
    await main.getByTestId('places-category-filter').selectOption('Shop');
    for (const name of ['Pyramid Curios', 'Harbor Smith', 'Spice House']) {
      await main.getByTestId('places-search').fill(name);
      await expect(main.getByTestId('places-list').getByText(name, { exact: true })).toBeVisible();
    }
    await main.getByTestId('places-search').fill('Pyramid');
    await main.getByTestId('places-list').getByText('Pyramid Curios', { exact: true }).click();
    await main.getByTestId('place-edit-notes').fill('A stairway descends beneath the shop.');
    await main.getByTestId('place-edit-notes').blur();
    const frame=(await canvas.boundingBox())!;
    await main.evaluate(side=>(window as any).__atlasViewStore.getState().setPanelCamera('map-main',{x:20,y:20,zoom:side/400}),Math.min(frame.width,frame.height)-40);
    await main.getByTestId('panel-map-main').screenshot({ path: testInfo.outputPath('city-tracing.png') });
    // The Places button toggles; it's already open from the search above.
    await main.evaluate(() => (window as any).__atlasHudStore.getState().openOrFocusPanel('places'));
    await main.getByTestId('btn-open-interior').click();
    await expect(main.getByTestId('active-map-title')).toContainText('Pyramid Curios Interior');
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, resolve(__dirname, '../docs/bundle/reference-maps/04-pyramid-interior.jpg'));
    await openPanel(main, 'newMap');
    await main.getByTestId('btn-import-backdrop').click();
    await expect.poll(()=>main.evaluate(()=>{
      const s=(window as any).__atlasWorldStore.getState();
      return Object.values(s.world.maps[s.activeMapId].entities).filter((e:any)=>e.type==='image').length;
    })).toBe(1);
    await main.getByTestId('btn-save-now').click();
    await expect(main.getByTestId('save-status')).toContainText('Saved');
    const saved = await main.evaluate(() => (window as any).__atlasWorldStore.getState().world);
    await app.close();
    app = await electron.launch({ args });
    const reopened = await app.firstWindow(); reopened.setDefaultTimeout(10_000);
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(dir, 'world'));
    await reopened.getByTestId('btn-open-world').click();
    await expect(reopened.getByTestId('save-status')).toContainText('New World');
    expect(await reopened.evaluate(() => (window as any).__atlasWorldStore.getState().world)).toEqual(saved);
    await reopened.getByTestId(`map-tree-item-${townId}`).click();
    await reopened.getByTestId('btn-places').click();
    await reopened.evaluate(() => (window as any).__atlasHudStore.getState().openOrFocusPanel('places'));
    await reopened.getByTestId('places-search').fill('Pyramid');
    await reopened.getByTestId('places-list').getByText('Pyramid Curios', { exact: true }).click();
    await expect(reopened.getByTestId('place-edit-notes')).toHaveValue('A stairway descends beneath the shop.');
    await reopened.getByTestId('btn-open-interior').click();
    await expect(reopened.getByTestId('active-map-title')).toContainText('Pyramid Curios Interior');
  } finally { await app.close(); }
});
