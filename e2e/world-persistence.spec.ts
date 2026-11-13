import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import type { AtlasApi } from '../src/preload/index';

declare const window: Window & { atlasApi: AtlasApi };

test('creates a world, adds an entity, restarts the app, and finds the entity', async () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-world-'));
  const worldDir = join(tempBase, 'PersistenceTestWorld');
  const userDataDir = join(tempBase, 'userData');

  try {
    // Session 1: create world, add entity, wait for autosave
    const app1 = await electron.launch({
      args: [
        resolve(__dirname, '../out/main/index.js'),
        `--user-data-dir=${userDataDir}`,
      ],
    });

    try {
      const win1 = await app1.firstWindow();
      await win1.waitForLoadState('domcontentloaded');

      await app1.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      }, worldDir);
      await win1.getByTestId('btn-new-world').click();
      await expect(win1.getByTestId('save-status')).toContainText('Saved');

      // Add through the store, then let autosave (2 s debounce) write it: no manual save
      await win1.evaluate(() => {
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
            id: 'ent-persist-1',
            type: 'label',
            layerId: 'layer-base',
            origin: 'manual',
            rev: 0,
            text: 'Khartoum',
            x: 200,
            y: 300,
            size: 18,
          },
        });
      });
      await expect(win1.getByTestId('save-status')).toContainText('Unsaved');
      await expect(win1.getByTestId('save-status')).toContainText('— Saved', { timeout: 10_000 });
    } finally {
      await app1.close();
    }

    // Session 2: restart app, check recent worlds, reopen world, verify entity is present
    const app2 = await electron.launch({
      args: [
        resolve(__dirname, '../out/main/index.js'),
        `--user-data-dir=${userDataDir}`,
      ],
    });

    try {
      const win2 = await app2.firstWindow();
      await win2.waitForLoadState('domcontentloaded');

      const found = await win2.evaluate(async () => {
        const recent = await window.atlasApi.listRecentWorlds();
        if (recent.length === 0) {
          return null;
        }
        const opened = await window.atlasApi.openWorld(recent[0]!.path);
        if (!opened.ok) {
          return null;
        }
        return opened.maps['map-1']?.entities['ent-persist-1'] ?? null;
      });

      expect(found).not.toBeNull();
      expect(found?.type).toBe('label');
      if (found?.type === 'label') {
        expect(found.text).toBe('Khartoum');
      }
    } finally {
      await app2.close();
    }
  } finally {
    rmSync(tempBase, { recursive: true, force: true });
  }
});
