import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('develops a child area, zooms through parent <-> child, opens place interior, and follows a portal', async () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-childmaps-'));
  const worldDir = join(tempBase, 'ChildMapsWorld');
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
      win.on('pageerror', (err) => console.error('PAGEERROR:', err));
      await win.waitForLoadState('domcontentloaded');

      await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [dir],
        });
      }, worldDir);

      await win.getByTestId('btn-new-world').click();
      await expect(win.getByTestId('save-status')).toContainText('New World');
      await expect
        .poll(async () =>
          Number(await win.getByTestId('panel-map-main').getAttribute('data-render-count')),
        )
        .toBeGreaterThan(0);

      // Set region bounds to 10km x 10km and add a large land area on map-1
      await win.evaluate(() => {
        const w = window as unknown as {
          __atlasWorldStore: {
            getState: () => { execute: (name: string, input: unknown) => unknown };
          };
        };
        w.__atlasWorldStore.getState().execute('map.create', {
          id: 'region-1',
          name: 'Big Region',
          kind: 'region',
          bounds: { x: 0, y: 0, w: 10000, h: 10000 },
        });
        w.__atlasWorldStore.getState().execute('entity.add', {
          mapId: 'region-1',
          entity: {
            id: 'land-1',
            type: 'area',
            layerId: 'layer-base',
            origin: 'manual',
            rev: 0,
            role: 'land',
            rings: [
              [
                { x: 1000, y: 1000 },
                { x: 9000, y: 1000 },
                { x: 9000, y: 9000 },
                { x: 1000, y: 9000 },
              ],
            ],
          },
        });
      });

      await win.evaluate(() => {
        const w = window as unknown as {
          __atlasWorldStore: { getState: () => { setActiveMap: (id: string) => void } };
          __atlasViewStore: { getState: () => { setPanelMap: (p: string, m: string) => void } };
        };
        w.__atlasWorldStore.getState().setActiveMap('region-1');
        w.__atlasViewStore.getState().setPanelMap('map-main', 'region-1');
      });
      await expect(win.getByTestId('panel-map-main')).toContainText('Big Region (region)');

      // Use Develop Area tool by dragging a rectangle on the canvas
      await win.getByTestId('tool-btn-developArea').click();
      const canvas = win.locator('[data-testid="panel-map-main"] canvas');
      const box = (await canvas.boundingBox())!;
      await win.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await win.mouse.down();
      await win.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7);
      await win.mouse.up();

      await expect(win.getByTestId('btn-confirm-develop')).toBeVisible();
      await win.getByTestId('develop-area-name').fill('Town Square');
      await win.getByTestId('select-develop-kind').selectOption('settlement');
      await win.getByTestId('btn-confirm-develop').click();

      // Panel switched to the new child map and inherited the clipped land area
      await expect(win.getByTestId('panel-map-main')).toContainText('Town Square (settlement)');
      await expect(win.getByTestId('panel-map-main')).toHaveAttribute('data-entity-count', '1');

      // Zoom out past child bounds -> switches back to parent region-1
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 12; i++) {
        await win.mouse.wheel(0, 120);
      }
      await expect(win.getByTestId('panel-map-main')).toContainText('Big Region (region)');

      // Zoom back in over the center -> switches into Town Square
      for (let i = 0; i < 16; i++) {
        await win.mouse.wheel(0, -120);
      }
      await expect(win.getByTestId('panel-map-main')).toContainText('Town Square (settlement)');

      // Create a building + place on Town Square and open its interior
      await win.evaluate(() => {
        const w = window as unknown as {
          __atlasWorldStore: {
            getState: () => {
              activeMapId: string | null;
              execute: (name: string, input: unknown) => unknown;
            };
          };
          __atlasViewStore: {
            getState: () => { setSelection: (ids: string[]) => void };
          };
        };
        const childId = w.__atlasWorldStore.getState().activeMapId!;
        w.__atlasWorldStore.getState().execute('entity.add', {
          mapId: childId,
          entity: {
            id: 'inn-area',
            type: 'area',
            layerId: 'layer-base',
            origin: 'manual',
            rev: 0,
            role: 'building',
            rings: [
              [
                { x: 20, y: 20 },
                { x: 50, y: 20 },
                { x: 50, y: 40 },
                { x: 20, y: 40 },
              ],
            ],
          },
        });
        w.__atlasViewStore.getState().setSelection(['inn-area']);
      });

      await win.getByTestId('btn-places').click();
      await win.getByTestId('place-create-name').fill('Wayfarer Inn');
      await win.getByTestId('btn-create-place').click();
      await win.getByTestId('btn-open-interior').click();

      // Switch back to the Map tab (Places opened in the same tab group)
      await win.getByRole('tab', { name: 'Map', exact: true }).click();
      await expect(win.getByTestId('panel-map-main')).toContainText(
        'Wayfarer Inn Interior (interior)',
      );

      // Add a portal back to map-1 and follow it via Inspector
      await win.getByTestId('tool-btn-portal').click();
      await win.getByTestId('select-portal-target').selectOption('map-1');
      await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

      await expect(win.getByTestId('btn-follow-portal')).toBeVisible();
      await win.getByTestId('btn-follow-portal').click();
      await expect(win.getByTestId('panel-map-main')).toContainText('Overworld (world)');
    } finally {
      await app.close();
    }
  } finally {
    rmSync(tempBase, { recursive: true, force: true });
  }
});
