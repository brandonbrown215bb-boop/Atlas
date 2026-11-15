import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import { startAgentServer, type AgentServerHandle } from './agent';
import { registerWorldIpc } from './ipc';
import { registerAtlasSchemes, setupProtocolHandlers } from './protocol';
import { clampBoundsToDisplays } from './windowBounds';

registerAtlasSchemes();

const popoutWindows = new Map<string, BrowserWindow>();
let mainWindow: BrowserWindow | null = null;

function isAllowedPopoutUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    try {
      const parsed = new URL(url);
      const devParsed = new URL(devUrl);
      return (
        parsed.origin === devParsed.origin &&
        (parsed.pathname === '/popout.html' || parsed.pathname === '/player.html')
      );
    } catch {
      return false;
    }
  }
  return url === 'app://atlas/popout.html' || url === 'app://atlas/player.html';
}

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

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedPopoutUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 650,
          title: 'Campaign Atlas — Panel',
          webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
          },
        },
      };
    }
    return { action: 'deny' };
  });

  win.webContents.on('did-create-window', (childWindow, details) => {
    const clamped = clampBoundsToDisplays(
      childWindow.getBounds(),
      screen.getAllDisplays(),
      screen.getPrimaryDisplay().workArea,
    );
    childWindow.setBounds(clamped);

    if (details.frameName) {
      popoutWindows.set(details.frameName, childWindow);
      childWindow.on('closed', () => {
        popoutWindows.delete(details.frameName);
      });
    }
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadURL('app://atlas/index.html');
  }

  return win;
}

let agentServer: AgentServerHandle | null = null;

void app.whenReady().then(async () => {
  const history = (action: 'undo' | 'redo') => BrowserWindow.getFocusedWindow()?.webContents.send('atlas:history', action);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CommandOrControl+Z', click: () => history('undo') },
      { label: 'Redo', accelerator: 'CommandOrControl+Y', click: () => history('redo') },
      { label: 'Redo', accelerator: 'CommandOrControl+Shift+Z', visible: false, click: () => history('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  ipcMain.on('atlas:history-text', (event, action: unknown) => {
    if (action === 'undo') event.sender.undo();
    if (action === 'redo') event.sender.redo();
  });
  const worldIpc = registerWorldIpc(() => mainWindow);

  agentServer = await startAgentServer({
    userDataDir: app.getPath('userData'),
    getMainWindow: () => mainWindow,
    createWorld: worldIpc.createWorld,
    openWorld: worldIpc.openWorld,
  });

  setupProtocolHandlers({
    rendererDir: join(__dirname, '../renderer'),
    getAllowedRoots: () => {
      const roots = [app.getPath('userData'), ...worldIpc.getPackRoots()];
      const worldDir = worldIpc.getCurrentWorldDir();
      if (worldDir) {
        roots.push(worldDir);
      }
      return roots;
    },
  });

  ipcMain.handle('atlas:close-popout', (_event, frameName: string) => {
    const child = popoutWindows.get(frameName);
    if (child && !child.isDestroyed()) {
      child.close();
    }
  });

  ipcMain.handle('atlas:displays', () => screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || `Monitor ${i + 1}` })));
  ipcMain.handle('atlas:player-fullscreen', (_event, displayId: number | null) => {
    const player = popoutWindows.get('atlas-player');
    if (!player || player.isDestroyed()) throw new Error('Open the player window first.');
    if (displayId === null) { player.setFullScreen(false); return; }
    const display = screen.getAllDisplays().find(d => d.id === displayId);
    if (!display) throw new Error('That monitor is no longer connected.');
    player.setFullScreen(false);
    player.setBounds(display.bounds);
    player.setFullScreen(true);
  });
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  if (agentServer) {
    void agentServer.close();
    agentServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
