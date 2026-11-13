import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
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
      const roots = [app.getPath('userData')];
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
