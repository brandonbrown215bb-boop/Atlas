import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import type { AtlasApi } from '../src/preload/index';

declare const window: Window & { atlasApi: AtlasApi };

test('shell persists popout layout per world and toggles theme in all windows', async () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-shell-'));
  const worldDir = join(tempBase, 'ShellWorld');
  const userDataDir = join(tempBase, 'userData');

  try {
    // Session 1: create world, pop out layers panel, toggle theme across both windows
    const app1 = await electron.launch({
      args: [
        resolve(__dirname, '../out/main/index.js'),
        `--user-data-dir=${userDataDir}`,
      ],
    });

    try {
      const win1 = await app1.firstWindow();
      await win1.waitForLoadState('domcontentloaded');

      // Create world via preload API and load it into the UI? Wait: let's check how UI loads it!
      // Instead, mock pickFolder? No, we can create world and trigger open?
      // Actually let's check: if we open via pickFolder or expose a test-only world load,
      // wait: clicking btn-new-world calls pickFolder. Let's check if we can stub dialog or
      // use a small helper, OR even simpler: in Session 1, createWorld via atlasApi and
      // reload? No, worldStore is in renderer! Let's check: if we stub dialog.showOpenDialog in e2e
      // using electronApp.evaluate, clicking New World / Open World tests the REAL UI flow!
      await app1.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [dir],
        });
      }, worldDir);

      await win1.getByTestId('btn-new-world').click();
      await expect(win1.getByTestId('save-status')).toContainText('New World');

      // Pop out the layers panel
      const popoutPromise = app1.waitForEvent('window');
      await win1.getByTestId('popout-btn-layers').click();
      const popoutWin1 = await popoutPromise;
      await expect(popoutWin1.getByTestId('panel-layers')).toBeVisible({ timeout: 10_000 });

      // Toggle theme and verify both main and popout windows update data-theme
      const initialTheme = await win1.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      );
      await win1.getByTestId('btn-toggle-theme').click();
      const nextTheme = initialTheme === 'dark' ? 'light' : 'dark';

      await expect
        .poll(() =>
          win1.evaluate(() => document.documentElement.getAttribute('data-theme')),
        )
        .toBe(nextTheme);
      await expect
        .poll(() =>
          popoutWin1.evaluate(() => document.documentElement.getAttribute('data-theme')),
        )
        .toBe(nextTheme);

      // Wait for debounced layout save (300ms)
      await win1.waitForTimeout(600);
    } finally {
      await app1.close();
    }

    // Session 2: restart app, open the same world, and verify popout window is restored
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
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [dir],
        });
      }, worldDir);

      const restoredPopoutPromise = app2.waitForEvent('window');
      await win2.getByTestId('btn-open-world').click();
      const restoredPopout = await restoredPopoutPromise;
      await expect(restoredPopout.getByTestId('panel-layers')).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await app2.close();
    }
  } finally {
    rmSync(tempBase, { recursive: true, force: true });
  }
});
