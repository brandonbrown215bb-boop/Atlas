import { resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

test('launches the app and shows the window title', async () => {
  const electronApp = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js')],
  });

  try {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    const title = await window.title();
    expect(title).toBe('Campaign Atlas');
  } finally {
    await electronApp.close();
  }
});
