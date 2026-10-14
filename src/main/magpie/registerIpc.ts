import { BrowserWindow, ipcMain, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { MagpieIpc, type MagpieModelSelection } from '../../shared/magpie/types';
import type { MagpieManager } from './manager';
/** The app supplies its existing trusted-main-frame predicate. No arbitrary URL/HTTP IPC. */
export function registerMagpieIpc(
  manager: MagpieManager,
  trusted: (event: Electron.IpcMainInvokeEvent) => boolean,
): () => Promise<void> {
  let window: BrowserWindow | undefined;
  const handle = (channel: string, handler: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted model management request');
      return handler(...args);
    });
  };
  handle(MagpieIpc.status, () => manager.status());
  handle(MagpieIpc.start, () => manager.start());
  handle(MagpieIpc.stop, () => {
    window?.close();
    return manager.stop();
  });
  handle(MagpieIpc.models, () => manager.models());
  handle(MagpieIpc.agents, () => manager.agents());
  handle(MagpieIpc.setModel, (selection: MagpieModelSelection) => manager.setModel(selection));
  handle(MagpieIpc.openManagement, async () => {
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
      return;
    }
    const connection = manager.managementConnection();
    const isolatedSession = session.fromPartition(`magpie-${randomUUID()}`);
    isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    isolatedSession.setPermissionCheckHandler(() => false);
    await isolatedSession.cookies.set({
      url: connection.url,
      name: connection.cookieName,
      value: connection.key,
      httpOnly: true,
      sameSite: 'lax',
    });
    const current = new BrowserWindow({
      width: 1100,
      height: 800,
      title: '本机 CLI 管理',
      webPreferences: {
        session: isolatedSession,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    window = current;
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    current.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== connection.url) event.preventDefault();
    });
    current.webContents.on('will-redirect', (event, url) => {
      if (new URL(url).origin !== connection.url) event.preventDefault();
    });
    current.on('closed', () => {
      if (window === current) window = undefined;
      void isolatedSession.clearStorageData();
    });
    await current.loadURL(connection.url);
  });
  return async () => {
    for (const channel of Object.values(MagpieIpc)) ipcMain.removeHandler(channel);
    window?.destroy();
    await manager.stop();
  };
}
