import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('creates places from selection, filters, centers map view, edits notes, and toggles category overlay', async () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-places-'));
  const worldDir = join(tempBase, 'PlacesWorld');
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

      // Add two building areas and select the first
      await win.evaluate(() => {
        const w = window as unknown as {
          __atlasWorldStore: {
            getState: () => { execute: (name: string, input: unknown) => unknown };
          };
          __atlasViewStore: {
            getState: () => { setSelection: (ids: string[]) => void };
          };
        };
        const exec = w.__atlasWorldStore.getState().execute;
        exec('entity.add', {
          mapId: 'map-1',
          entity: {
            id: 'bldg-1',
            type: 'area',
            layerId: 'layer-base',
            origin: 'manual',
            rev: 0,
            role: 'building',
            rings: [
              [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            ],
          },
        });
        exec('entity.add', {
          mapId: 'map-1',
          entity: {
            id: 'bldg-2',
            type: 'area',
            layerId: 'layer-base',
            origin: 'manual',
            rev: 0,
            role: 'building',
            rings: [
              [
                { x: 800, y: 800 },
                { x: 900, y: 800 },
                { x: 900, y: 900 },
                { x: 800, y: 900 },
              ],
            ],
          },
        });
        w.__atlasViewStore.getState().setSelection(['bldg-1']);
      });

      // Open Places panel and create first place from selection
      await win.getByTestId('btn-places').click();
      await expect(win.getByTestId('panel-places')).toBeVisible();

      await win.getByTestId('place-create-name').fill('The Rusty Anchor');
      await win.getByTestId('place-create-category').fill('Tavern');
      await win.getByTestId('btn-create-place').click();

      await expect(win.getByTestId('places-list')).toContainText('The Rusty Anchor');

      // Select second building and create second place
      await win.evaluate(() => {
        const w = window as unknown as {
          __atlasViewStore: {
            getState: () => { setSelection: (ids: string[]) => void };
          };
        };
        w.__atlasViewStore.getState().setSelection(['bldg-2']);
      });
      await win.getByTestId('place-create-name').fill('Ironworks');
      await win.getByTestId('place-create-category').fill('Shop');
      await win.getByTestId('btn-create-place').click();

      await expect(win.getByTestId('places-list')).toContainText('Ironworks');

      // Filter by category and search
      await win.getByTestId('places-category-filter').selectOption('Tavern');
      await expect(win.getByTestId('places-list')).toContainText('The Rusty Anchor');
      await expect(win.getByTestId('places-list')).not.toContainText('Ironworks');

      await win.getByTestId('places-category-filter').selectOption('');
      await win.getByTestId('places-search').fill('iron');
      await expect(win.getByTestId('places-list')).toContainText('Ironworks');
      await expect(win.getByTestId('places-list')).not.toContainText('The Rusty Anchor');

      await win.getByTestId('places-search').fill('');

      // Choose The Rusty Anchor -> centers map on (150, 150) and opens editor
      await win.getByTestId('places-list').getByText('The Rusty Anchor').click();
      await expect(win.getByTestId('place-edit-name')).toHaveValue('The Rusty Anchor');

      const centerMapPt = await win.evaluate(() => {
        const w = window as unknown as {
          __atlasViewStore: {
            getState: () => {
              panels: Record<string, { camera: { x: number; y: number; zoom: number } | null }>;
            };
          };
        };
        const panelEl = document.querySelector('[data-testid="panel-map-main"] canvas');
        const rect = panelEl!.getBoundingClientRect();
        const cam = w.__atlasViewStore.getState().panels['map-main']!.camera!;
        return {
          x: (rect.width / 2 - cam.x) / cam.zoom,
          y: (rect.height / 2 - cam.y) / cam.zoom,
        };
      });
      expect(centerMapPt.x).toBeCloseTo(150, 1);
      expect(centerMapPt.y).toBeCloseTo(150, 1);

      // Edit notes and GM notes
      await win.getByTestId('place-edit-notes').fill('Dockside inn');
      await win.getByTestId('place-edit-notes').blur();
      await win.getByTestId('place-edit-gm-notes').fill('Smuggler tunnel below');
      await win.getByTestId('place-edit-gm-notes').blur();

      const savedNotes = await win.evaluate(() => {
        const w = window as unknown as {
          __atlasWorldStore: {
            getState: () => {
              world: {
                maps: Record<
                  string,
                  { entities: Record<string, { type: string; name?: string; notes?: string; gmNotes?: string }> }
                >;
              } | null;
            };
          };
        };
        const entities = Object.values(
          w.__atlasWorldStore.getState().world!.maps['map-1']!.entities,
        );
        return entities.find((e) => e.type === 'place' && e.name === 'The Rusty Anchor');
      });
      expect(savedNotes?.notes).toBe('Dockside inn');
      expect(savedNotes?.gmNotes).toBe('Smuggler tunnel below');

      // Toggle category label overlay on the map
      const rendersBefore = Number(
        await win.getByTestId('panel-map-main').getAttribute('data-render-count'),
      );
      await win.getByTestId('toggle-place-overlay').check();
      await expect
        .poll(async () =>
          Number(await win.getByTestId('panel-map-main').getAttribute('data-render-count')),
        )
        .toBeGreaterThan(rendersBefore);
    } finally {
      await app.close();
    }
  } finally {
    rmSync(tempBase, { recursive: true, force: true });
  }
});
