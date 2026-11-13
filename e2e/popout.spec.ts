import { resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('Dockview popout with PixiJS canvas: popout, minimize main, dock back, and close popout', async () => {
  const electronApp = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js')],
  });

  try {
    const mainWin = await electronApp.firstWindow();
    await mainWin.waitForLoadState('domcontentloaded');

    // Wait for both panels to render initially
    await expect(mainWin.getByTestId('panel-map-1')).toBeVisible();
    await expect(mainWin.getByTestId('panel-map-2')).toBeVisible();

    // 1. Pop out map-2 into a second window
    const popoutPromise = electronApp.waitForEvent('window');
    await mainWin.getByTestId('popout-btn-map-2').click();
    const popoutWin = await popoutPromise;
    await popoutWin.waitForLoadState('domcontentloaded');

    const popoutPanel = popoutWin.getByTestId('panel-map-2');
    await expect(popoutPanel).toBeVisible({ timeout: 10_000 });
    await expect(popoutPanel).toHaveAttribute('data-location-type', 'popout');

    // 2. Verify popout canvas has non-zero size
    const popoutCanvas = popoutWin.locator('[data-testid="canvas-host-map-2"] canvas');
    await expect(popoutCanvas).toBeVisible();
    const box = await popoutCanvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(50);

    // Wait for initial render
    await expect
      .poll(async () => Number(await popoutPanel.getAttribute('data-render-count')))
      .toBeGreaterThan(0);

    // 3. Minimize the main window and verify popout keeps rendering
    await electronApp.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      const main = all.find((w) => w.getTitle() === 'Campaign Atlas');
      main?.minimize();
    });

    const beforeMinimizeRender = Number(await popoutPanel.getAttribute('data-render-count'));
    await popoutCanvas.hover();
    await popoutWin.mouse.wheel(0, -120);

    await expect
      .poll(async () => Number(await popoutPanel.getAttribute('data-render-count')))
      .toBeGreaterThan(beforeMinimizeRender);

    // Restore main window
    await electronApp.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      const main = all.find((w) => w.getTitle() === 'Campaign Atlas');
      main?.restore();
    });

    // 4. Dock back and verify it still renders in main window
    await popoutWin.getByTestId('dockback-btn-map-2').click();
    const mainPanel2 = mainWin.getByTestId('panel-map-2');
    await expect(mainPanel2).toBeVisible({ timeout: 10_000 });
    await expect(mainPanel2).toHaveAttribute('data-location-type', 'grid');

    const mainCanvas2 = mainWin.locator('[data-testid="canvas-host-map-2"] canvas');
    await expect(mainCanvas2).toBeVisible();
    const mainBox2 = await mainCanvas2.boundingBox();
    expect(mainBox2).not.toBeNull();
    expect(mainBox2!.width).toBeGreaterThan(50);
    expect(mainBox2!.height).toBeGreaterThan(50);

    await expect
      .poll(async () => Number(await mainPanel2.getAttribute('data-render-count')))
      .toBeGreaterThan(0);
    const beforeWheelBack = Number(await mainPanel2.getAttribute('data-render-count'));
    await mainCanvas2.hover();
    await mainWin.mouse.wheel(0, -120);
    await expect
      .poll(async () => Number(await mainPanel2.getAttribute('data-render-count')))
      .toBeGreaterThan(beforeWheelBack);

    // 5. Pop out again, then close the popout window -> panel returns to main window
    const popoutPromise2 = electronApp.waitForEvent('window');
    await mainWin.getByTestId('popout-btn-map-2').click();
    const popoutWin2 = await popoutPromise2;
    await expect(popoutWin2.getByTestId('panel-map-2')).toBeVisible({ timeout: 10_000 });

    await popoutWin2.close();
    await expect(mainPanel2).toBeVisible({ timeout: 10_000 });
    await expect(mainPanel2).toHaveAttribute('data-location-type', 'grid');
    await expect(mainCanvas2).toBeVisible();
  } finally {
    await electronApp.close();
  }
});
