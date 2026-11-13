import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

const REF_MAPS_DIR = 'C:\\Users\\jbrow263\\Documents\\campaign-atlas-bundle\\reference-maps';

test('imports reference maps 02, 03, 04 as world, settlement, and interior and survives restart', async () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-backdrop-'));
  const worldDir = join(tempBase, 'BackdropWorld');
  const userDataDir = join(tempBase, 'userData');

  const img02 = join(REF_MAPS_DIR, '02-world-map.jpg');
  const img03 = join(REF_MAPS_DIR, '03-khartoum-city.jpg');
  const img04 = join(REF_MAPS_DIR, '04-pyramid-interior.jpg');

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

      await mapItems.nth(1).click();
      await expect(win2.getByTestId('panel-map-main')).toContainText('Khartoum (settlement)');
      await expect(win2.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count', '1');

      await mapItems.nth(2).click();
      await expect(win2.getByTestId('panel-map-main')).toContainText('Pyramid (interior)');
      await expect(win2.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count', '1');
    } finally {
      await app2.close();
    }
  } finally {
    rmSync(tempBase, { recursive: true, force: true });
  }
});
