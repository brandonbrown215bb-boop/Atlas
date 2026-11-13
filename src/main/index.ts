import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { registerAtlasSchemes, setupProtocolHandlers } from './protocol';

registerAtlasSchemes();

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Campaign Atlas',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadURL('app://atlas/index.html');
  }

  return win;
}

void app.whenReady().then(() => {
  setupProtocolHandlers({
    rendererDir: join(__dirname, '../renderer'),
    getAllowedRoots: () => [app.getPath('userData')],
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
