import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from 'electron';
import { startAgentServer, type AgentServerHandle } from './agent';
import { registerWorldIpc, setReopenAfterCrash } from './ipc';
import { registerAtlasSchemes, setupProtocolHandlers } from './protocol';
import { clampBoundsToDisplays } from './windowBounds';

registerAtlasSchemes();

const popoutWindows = new Map<string, BrowserWindow>();
let lastRendererCrashAt = 0;
let mainWindow: BrowserWindow | null = null;
let closingMain = false;

function sendToMain(channel: string, ...args: unknown[]): void {
  if (!mainWindow || mainWindow.isDestroyed() || closingMain) return;
  const wc = mainWindow.webContents;
  if (wc.isDestroyed() || wc.mainFrame?.isDestroyed()) return;
  try {
    wc.send(channel, ...args);
  } catch {
    // Ignore if renderer frame was disposed mid-teardown
  }
}

function isAllowedPopoutUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  try {
    const parsed = new URL(url);
    const isPopoutPath =
      parsed.pathname === '/popout.html' || parsed.pathname === '/player.html';
    if (devUrl) {
      const devParsed = new URL(devUrl);
      return parsed.origin === devParsed.origin && isPopoutPath;
    }
    return parsed.protocol === 'app:' && parsed.hostname === 'atlas' && isPopoutPath;
  } catch {
    return false;
  }
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
  closingMain = false;
  win.on('close', (e) => {
    // A second close while the save is running must wait for it too.
    e.preventDefault();
    if (closingMain) return;
    closingMain = true;
    if (win.webContents.isDestroyed() || win.webContents.mainFrame?.isDestroyed()) {
      win.destroy();
      return;
    }
    const finish = () => {
      ipcMain.removeListener('atlas:ready-to-close', onReady);
      if (!win.isDestroyed()) win.destroy();
    };
    // Only a hung renderer reaches this; a normal save reports back first.
    const timer = setTimeout(finish, 15_000);
    const onReady = (_event: Electron.IpcMainEvent, result?: { ok: boolean; error?: string }) => {
      clearTimeout(timer);
      if (result?.ok === false && !win.isDestroyed()) {
        const choice = dialog.showMessageBoxSync(win, {
          type: 'warning',
          buttons: ['Keep editing', 'Quit without saving'],
          defaultId: 0,
          cancelId: 0,
          message: 'Your latest changes could not be saved.',
          detail: result.error ?? 'Unknown save error',
        });
        if (choice === 0) {
          ipcMain.removeListener('atlas:ready-to-close', onReady);
          closingMain = false;
          return;
        }
      }
      finish();
    };
    ipcMain.once('atlas:ready-to-close', onReady);
    try {
      win.webContents.send('atlas:before-close');
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
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
      const frameName = details.frameName;
      popoutWindows.set(frameName, childWindow);

      const isOverMain = () => {
        if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || childWindow.isDestroyed()) {
          return { over: false, relX: 0, relY: 0 };
        }
        const cb = childWindow.getBounds();
        const mb = mainWindow.getBounds();
        const cx = cb.x + cb.width / 2;
        const cy = cb.y + cb.height / 2;
        const inset = 24;
        const over =
          cx > mb.x + inset &&
          cx < mb.x + mb.width - inset &&
          cy > mb.y + inset &&
          cy < mb.y + mb.height - inset;
        return { over, relX: cx - mb.x, relY: cy - mb.y };
      };

      if (frameName !== 'atlas-player') {
        const readyAt = Date.now() + 500;
        let wasOver = false;
        let movesAfterReady = 0;
        childWindow.on('move', () => {
          if (Date.now() < readyAt) return;
          movesAfterReady += 1;
          const hit = isOverMain();
          if (hit.over || wasOver) {
            wasOver = hit.over;
            sendToMain('atlas:popout-drag-over-main', {
              id: frameName,
              over: hit.over,
              relX: hit.relX,
              relY: hit.relY,
            });
          }
        });
        childWindow.on('moved', () => {
          if (Date.now() < readyAt || movesAfterReady < 2) {
            movesAfterReady = 0;
            return;
          }
          movesAfterReady = 0;
          const hit = isOverMain();
          if (wasOver) {
            wasOver = false;
            sendToMain('atlas:popout-drag-over-main', {
              id: frameName,
              over: false,
              relX: hit.relX,
              relY: hit.relY,
            });
          }
          if (hit.over) {
            sendToMain('atlas:popout-dock-back', {
              id: frameName,
              relX: hit.relX,
              relY: hit.relY,
            });
          }
        });
      }

      childWindow.on('closed', () => {
        if (popoutWindows.get(frameName) === childWindow) {
          popoutWindows.delete(frameName);
          if (frameName !== 'atlas-player') {
            sendToMain('atlas:popout-closed', frameName);
          }
        }
      });
    }
  });

  // A dead renderer leaves a blank white window with no way back. Log why and reload;
  // edits autosave every two seconds, so at most the last moment of work is lost.
  win.webContents.on('render-process-gone', (_event, details) => {
    const line = `${new Date().toISOString()} renderer gone: ${details.reason}, exit ${details.exitCode}; ` +
      `memory ${JSON.stringify(app.getAppMetrics().map(m => ({ type: m.type, mb: Math.round(m.memory.workingSetSize / 1024) })))}
`;
    console.error(line);
    try { appendFileSync(join(app.getPath('userData'), 'renderer-crashes.log'), line); } catch { /* logging is best effort */ }
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    // Two crashes within a minute: the world itself is probably what kills the renderer (e.g. OOM
    // on open). Reopening it again would loop forever, and every open adds a backup, so a loop
    // would push all the good backups out. Come back with no world open instead.
    const now = Date.now();
    const repeat = now - lastRendererCrashAt < 60_000;
    lastRendererCrashAt = now;
    setReopenAfterCrash(!repeat);
    win.webContents.reload();
    if (repeat) {
      void dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Atlas crashed again',
        message: 'The editor crashed twice in a row, so the world was not reopened.',
        detail: 'Your saved work is still in the world folder. Open it again when you are ready; the crash reason is in renderer-crashes.log in the Atlas settings folder.',
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
  const history = (action: 'undo' | 'redo') => {
    const focused = BrowserWindow.getFocusedWindow();
    const target = focused && focused === mainWindow ? focused : mainWindow ?? focused;
    target?.webContents.send('atlas:history', action);
  };
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

  ipcMain.handle('atlas:get-main-window-bounds', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    return mainWindow.getBounds();
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
