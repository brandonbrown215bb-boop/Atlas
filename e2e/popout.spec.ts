import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron, type Locator } from '@playwright/test';

// P0.3 "Done when", kept as a regression test against the real shell.
test('map panel pops out, renders while main is minimised, docks back, and returns on close', async () => {
  const tempBase = mkdtempSync(join(tmpdir(), 'atlas-e2e-popout-'));
  const app = await electron.launch({
    args: [
      resolve(__dirname, '../out/main/index.js'),
      `--user-data-dir=${join(tempBase, 'userData')}`,
    ],
  });

  try {
    const main = await app.firstWindow();
    await main.waitForLoadState('domcontentloaded');
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, join(tempBase, 'PopoutWorld'));
    await main.getByTestId('btn-new-world').click();
    await expect(main.getByTestId('save-status')).toContainText('New World');

    const renders = async (panel: Locator) =>
      Number(await panel.getAttribute('data-render-count'));
    const setMainMinimized = (minimized: boolean) =>
      app.evaluate(({ BrowserWindow }, min) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Campaign Atlas');
        if (min) win?.minimize();
        else win?.restore();
      }, minimized);

    // 1. Pop out: canvas has non-zero size and renders
    let popoutPromise = app.waitForEvent('window');
    await main.getByTestId('popout-btn-map-main').click();
    const popout = await popoutPromise;
    const popoutPanel = popout.getByTestId('panel-map-main');
    await expect(popoutPanel).toBeVisible({ timeout: 10_000 });
    await expect(popoutPanel).toHaveAttribute('data-location-type', 'popout');
    const popoutCanvas = popout.locator('[data-testid="canvas-host-map-main"] canvas');
    const box = await popoutCanvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(50);
    await expect.poll(() => renders(popoutPanel)).toBeGreaterThan(0);

    // 2. Keeps rendering while the main window is minimised
    await setMainMinimized(true);
    const beforeMinimized = await renders(popoutPanel);
    await popoutCanvas.hover();
    await popout.mouse.wheel(0, -120);
    await expect.poll(() => renders(popoutPanel)).toBeGreaterThan(beforeMinimized);
    await setMainMinimized(false);

    // 3. Docks back and still renders
    await popout.getByTestId('dockback-btn-map-main').click();
    const mainPanel = main.getByTestId('panel-map-main');
    await expect(mainPanel).toBeVisible({ timeout: 10_000 });
    await expect(mainPanel).toHaveAttribute('data-location-type', 'grid');
    const mainCanvas = main.locator('[data-testid="canvas-host-map-main"] canvas');
    await expect(mainCanvas).toBeVisible();
    await expect.poll(() => renders(mainPanel)).toBeGreaterThan(0);
    const beforeWheel = await renders(mainPanel);
    await mainCanvas.hover();
    await main.mouse.wheel(0, -120);
    await expect.poll(() => renders(mainPanel)).toBeGreaterThan(beforeWheel);

    // 4. Closing the popout window returns the panel to the main window
    popoutPromise = app.waitForEvent('window');
    await main.getByTestId('popout-btn-map-main').click();
    const popout2 = await popoutPromise;
    await expect(popout2.getByTestId('panel-map-main')).toBeVisible({ timeout: 10_000 });
    await popout2.close();
    await expect(mainPanel).toBeVisible({ timeout: 10_000 });
    await expect(mainPanel).toHaveAttribute('data-location-type', 'grid');
    await expect(mainCanvas).toBeVisible();
  } finally {
    await app.close();
    rmSync(tempBase, { recursive: true, force: true });
  }
});
