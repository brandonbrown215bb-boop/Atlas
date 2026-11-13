import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('opens two map panels and an edit made through the store appears in both', async () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-mapview-'));
  const worldDir = join(tempBase, 'MapViewWorld');
  const userDataDir = join(tempBase, 'userData');

  try {
    const app = await electron.launch({
      args: [
        resolve(__dirname, '../out/main/index.js'),
        `--user-data-dir=${userDataDir}`,
      ],
    });

    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');

      await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [dir],
        });
      }, worldDir);

      await win.getByTestId('btn-new-world').click();
      await expect(win.getByTestId('save-status')).toContainText('New World');

      // Open a second map panel
      await win.getByTestId('btn-add-map').click();

      const mapPanels = win.locator('[data-testid^="panel-map-"]');
      await expect(mapPanels).toHaveCount(2);

      // Both start with 0 entities and complete initial render
      await expect(mapPanels.nth(0)).toHaveAttribute('data-entity-count', '0');
      await expect(mapPanels.nth(1)).toHaveAttribute('data-entity-count', '0');
      await expect
        .poll(async () => Number(await mapPanels.nth(0).getAttribute('data-render-count')))
        .toBeGreaterThan(0);
      await expect
        .poll(async () => Number(await mapPanels.nth(1).getAttribute('data-render-count')))
        .toBeGreaterThan(0);

      const rendersBefore = [
        Number(await mapPanels.nth(0).getAttribute('data-render-count')),
        Number(await mapPanels.nth(1).getAttribute('data-render-count')),
      ];

      // Add an entity through the store
      await win.evaluate(() => {
        const store = (
          window as unknown as {
            __atlasWorldStore: {
              getState: () => { execute: (name: string, input: unknown) => unknown };
            };
          }
        ).__atlasWorldStore;
        store.getState().execute('entity.add', {
          mapId: 'map-1',
          entity: {
            id: 'area-1',
            type: 'area',
            layerId: 'layer-base',
            origin: 'manual',
            rev: 0,
            role: 'land',
            rings: [
              [
                { x: 500, y: 500 },
                { x: 2500, y: 500 },
                { x: 2500, y: 2500 },
                { x: 500, y: 2500 },
              ],
            ],
          },
        });
      });

      // Both map panels reflect the new entity and re-render
      await expect(mapPanels.nth(0)).toHaveAttribute('data-entity-count', '1');
      await expect(mapPanels.nth(1)).toHaveAttribute('data-entity-count', '1');
      await expect
        .poll(async () => Number(await mapPanels.nth(0).getAttribute('data-render-count')))
        .toBeGreaterThan(rendersBefore[0]!);
      await expect
        .poll(async () => Number(await mapPanels.nth(1).getAttribute('data-render-count')))
        .toBeGreaterThan(rendersBefore[1]!);
    } finally {
      await app.close();
    }
  } finally {
    rmSync(tempBase, { recursive: true, force: true });
  }
});
