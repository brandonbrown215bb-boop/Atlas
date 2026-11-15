import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { MapDoc } from '../src/renderer/model/schema';

const REF_MAPS_DIR = resolve(__dirname, '../docs/bundle/reference-maps');

async function expectBackdropRendered(app: ElectronApplication, page: Page) {
  const canvas = page.getByTestId('panel-map-main').locator('canvas');
  const size = await canvas.boundingBox();
  if (!size) throw new Error('Map canvas is missing');

  // Frame the image so this checks pixels, rather than just the saved entity count.
  await page.evaluate(({ width, height }) => {
    const stores = window as unknown as {
      __atlasWorldStore: {
        getState: () => { world: { maps: Record<string, MapDoc> }; activeMapId: string };
      };
      __atlasViewStore: {
        getState: () => {
          setPanelCamera: (id: string, camera: { x: number; y: number; zoom: number }) => void;
        };
      };
    };
    const state = stores.__atlasWorldStore.getState();
    const map = state.world!.maps[state.activeMapId!]!;
    const image = Object.values(map.entities).find((entity) => entity.type === 'image');
    if (!image || image.type !== 'image') throw new Error('Backdrop is missing');
    const zoom = Math.min((width - 40) / image.w, (height - 40) / image.h);
    stores.__atlasViewStore.getState().setPanelCamera('map-main', {
      x: 20 - image.x * zoom, y: 20 - image.y * zoom, zoom,
    });
  }, size);

  await expect.poll(async () => {
    const png = (await canvas.screenshot()).toString('base64');
    return app.evaluate(({ nativeImage }, data) => {
      const pixels = nativeImage.createFromBuffer(Buffer.from(data, 'base64')).toBitmap();
      const colors = new Set<number>();
      for (let i = 0; i < pixels.length; i += 4) {
        colors.add((pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!);
        if (colors.size > 256) break;
      }
      return colors.size;
    }, png);
  }, { message: 'Backdrop should display image pixels, not a grey placeholder' }).toBeGreaterThan(256);
}

async function calibrateBackdrop(page: Page, unit: 'ft' | 'mi' | 'm', distance: number) {
  const snapshot = () => page.evaluate(() => {
    const w = window as any;
    const s = w.__atlasWorldStore.getState();
    const image = Object.values(s.world.maps[s.activeMapId].entities).find((e: any) => e.type === 'image') as any;
    return { image, zoom: w.__atlasViewStore.getState().panels['map-main'].camera.zoom };
  });
  const before = await snapshot();
  await page.getByTestId('btn-calibrate-scale').click();
  const canvas = page.getByTestId('panel-map-main').locator('canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 110);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 110, { steps: 5 });
  await page.mouse.up();
  const bar = page.getByTestId('calibration-bar');
  await bar.locator('input').fill(String(distance));
  await bar.locator('select').selectOption(unit);
  await bar.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(bar).toHaveCount(0);
  const after = (await snapshot()).image;
  const metres = distance * (unit === 'ft' ? .3048 : unit === 'mi' ? 1609.344 : 1);
  expect(after.w).toBeCloseTo(before.image.w * metres * before.zoom / 120, 5);
  expect(after.h / after.w).toBeCloseTo(before.image.h / before.image.w, 8);
  await page.getByTestId('btn-undo').click();
  expect((await snapshot()).image).toEqual(before.image);
  await page.getByTestId('btn-redo').click();
  expect((await snapshot()).image).toEqual(after);
  return after;
}

test('imports and calibrates reference maps 02, 03, 04; rendered images and dimensions survive restart', async ({}, testInfo) => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-backdrop-'));
  const worldDir = join(tempBase, 'BackdropWorld');
  const userDataDir = join(tempBase, 'userData');

  const img02 = join(REF_MAPS_DIR, '02-world-map.jpg');
  const img03 = join(REF_MAPS_DIR, '03-khartoum-city.jpg');
  const img04 = join(REF_MAPS_DIR, '04-pyramid-interior.jpg');
  const calibrated: unknown[] = [];

  try {
    const app1 = await electron.launch({
      args: [
        resolve(__dirname, '../out/main/index.js'),
        `--user-data-dir=${userDataDir}`,
      ],
    });

    try {
      const win1 = await app1.firstWindow();
      await win1.waitForLoadState('domcontentloaded');

      // 1. Create world
      await app1.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      }, worldDir);
      await win1.getByTestId('btn-new-world').click();
      await expect(win1.getByTestId('save-status')).toContainText('New World');

      // 2. Import 02-world-map.jpg onto the default world map (map-1)
      await app1.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, img02);
      await win1.getByTestId('btn-import-backdrop').click();
      await expect(win1.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count', '1');
      await expectBackdropRendered(app1, win1);
      calibrated.push(await calibrateBackdrop(win1, 'mi', 100));
      await expectBackdropRendered(app1, win1);
      await win1.getByTestId('panel-map-main').screenshot({ path: testInfo.outputPath('world-backdrop.png') });

      // 3. Create settlement map & import 03-khartoum-city.jpg
      await win1.getByTestId('input-new-map-name').fill('Khartoum');
      await win1.getByTestId('select-new-map-kind').selectOption('settlement');
      await win1.getByTestId('btn-create-map').click();
      await expect(win1.getByTestId('panel-map-main')).toContainText('Khartoum (settlement)');

      await app1.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, img03);
      await win1.getByTestId('btn-import-backdrop').click();
      await expect(win1.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count', '1');
      await expectBackdropRendered(app1, win1);
      calibrated.push(await calibrateBackdrop(win1, 'm', 100));
      await expectBackdropRendered(app1, win1);
      await win1.getByTestId('panel-map-main').screenshot({ path: testInfo.outputPath('city-backdrop.png') });

      // 4. Create interior map & import 04-pyramid-interior.jpg
      await win1.getByTestId('input-new-map-name').fill('Pyramid');
      await win1.getByTestId('select-new-map-kind').selectOption('interior');
      await win1.getByTestId('btn-create-map').click();
      await expect(win1.getByTestId('panel-map-main')).toContainText('Pyramid (interior)');

      await app1.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, img04);
      await win1.getByTestId('btn-import-backdrop').click();
      await expect(win1.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count', '1');
      await expectBackdropRendered(app1, win1);
      calibrated.push(await calibrateBackdrop(win1, 'ft', 100));
      await expectBackdropRendered(app1, win1);
      await win1.getByTestId('panel-map-main').screenshot({ path: testInfo.outputPath('pyramid-backdrop.png') });

      // Save now
      await win1.getByTestId('btn-save-now').click();
      await expect(win1.getByTestId('save-status')).toContainText('Saved');
    } finally {
      await app1.close();
    }

    // Session 2: restart and verify all 3 maps and their image entities survived
    const app2 = await electron.launch({
      args: [
        resolve(__dirname, '../out/main/index.js'),
        `--user-data-dir=${userDataDir}`,
      ],
    });

    try {
      const win2 = await app2.firstWindow();
      await win2.waitForLoadState('domcontentloaded');

      await app2.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      }, worldDir);
      await win2.getByTestId('btn-open-world').click();
      await expect(win2.getByTestId('save-status')).toContainText('New World');

      // Verify all 3 map items exist in the Maps panel and each has 1 entity
      const mapItems = win2.locator('[data-testid^="map-tree-item-"]');
      await expect(mapItems).toHaveCount(3);

      await mapItems.nth(0).click();
      await expect(win2.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count', '1');
      await expectBackdropRendered(app2, win2);
      const images = await win2.evaluate(() => Object.values((window as any).__atlasWorldStore.getState().world.maps)
        .map((m: any) => Object.values(m.entities).find((e: any) => e.type === 'image')));
      expect(images).toEqual(calibrated);

      await mapItems.nth(1).click();
      await expect(win2.getByTestId('panel-map-main')).toContainText('Khartoum (settlement)');
      await expect(win2.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count', '1');
      await expectBackdropRendered(app2, win2);

      await mapItems.nth(2).click();
      await expect(win2.getByTestId('panel-map-main')).toContainText('Pyramid (interior)');
      await expect(win2.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count', '1');
      await expectBackdropRendered(app2, win2);
    } finally {
      await app2.close();
    }
  } finally {
    rmSync(tempBase, { recursive: true, force: true });
  }
});
