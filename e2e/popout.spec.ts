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
    const main = await app.firstWindow(); main.setDefaultTimeout(10_000);
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

    // 1. Open a secondary map HUD and pop it out: canvas has non-zero size and renders
    await main.getByTestId('btn-add-map').click();
    const mapHud = main.locator('[data-testid^="hud-map-"]').first();
    await expect(mapHud).toBeVisible({ timeout: 10_000 });
    const hudTestId = await mapHud.getAttribute('data-testid');
    const panelId = hudTestId!.replace(/^hud-/, '');

    let popoutPromise = app.waitForEvent('window');
    await main.getByTestId(`popout-btn-${panelId}`).click();
    const popout = await popoutPromise;
    const popoutPanel = popout.getByTestId(`panel-${panelId}`);
    await expect(popoutPanel).toBeVisible({ timeout: 10_000 });
    await expect(popoutPanel).toHaveAttribute('data-location-type', 'popout');
    const popoutCanvas = popout.locator(`[data-testid="canvas-host-${panelId}"] canvas`);
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

    // 3. Docks back as a floating HUD and still renders
    await popout.getByTestId(`dockback-btn-${panelId}`).click();
    const mainPanel = main.getByTestId(`panel-${panelId}`);
    await expect(mainPanel).toBeVisible({ timeout: 10_000 });
    await expect(mainPanel).toHaveAttribute('data-location-type', 'grid');
    const mainCanvas = main.locator(`[data-testid="canvas-host-${panelId}"] canvas`);
    await expect(mainCanvas).toBeVisible();
    await expect.poll(() => renders(mainPanel)).toBeGreaterThan(0);
    const beforeWheel = await renders(mainPanel);
    await mainCanvas.hover();
    await main.mouse.wheel(0, -120);
    await expect.poll(() => renders(mainPanel)).toBeGreaterThan(beforeWheel);

    // 4. Closing the popout window closes the secondary map panel cleanly
    popoutPromise = app.waitForEvent('window');
    await main.getByTestId(`popout-btn-${panelId}`).click();
    const popout2 = await popoutPromise;
    await expect(popout2.getByTestId(`panel-${panelId}`)).toBeVisible({ timeout: 10_000 });
    await popout2.close();
    await expect(mainPanel).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await app.close();
    rmSync(tempBase, { recursive: true, force: true });
  }
});
