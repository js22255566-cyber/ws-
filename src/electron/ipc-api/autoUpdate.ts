/* eslint-disable no-void -- Event checks report their result to the host renderer. */
import {
  app,
  ipcMain,
  net,
  safeStorage,
  shell,
  type BrowserWindow,
} from 'electron';
import { join } from 'node:path';
import GitHubUpdates from '../GitHubUpdates';

export default ({
  mainWindow,
  settings,
}: {
  mainWindow: BrowserWindow;
  settings: any;
}) => {
  const updater = new GitHubUpdates({
    version: app.getVersion(),
    path: join(app.getPath('userData'), 'github-updates.json'),
    secrets: {
      available: () =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== 'linux' ||
          safeStorage.getSelectedStorageBackend() !== 'basic_text'),
      encrypt: value => safeStorage.encryptString(value).toString('base64'),
      decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')),
    },
    fetch: (url, options) => net.fetch(url, options),
    notify: state => {
      if (!mainWindow.isDestroyed())
        mainWindow.webContents.send('autoUpdate', state);
    },
  });
  const permitted = (
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  ) =>
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame;
  const check = (event: Electron.IpcMainInvokeEvent) => {
    if (!permitted(event)) throw new Error('禁止访问更新设置');
  };
  ipcMain.handle('zl-updates-state', event => {
    check(event);
    return updater.state;
  });
  ipcMain.handle('zl-updates-check', event => {
    check(event);
    return updater.check(Boolean(settings.app.get('beta')));
  });
  ipcMain.handle('zl-updates-config', event => {
    check(event);
    return updater.configuration();
  });
  ipcMain.handle('zl-updates-token', (event, value) => {
    check(event);
    return updater.saveToken(value);
  });
  ipcMain.handle('zl-updates-notes', (event, version: string) => {
    check(event);
    return updater.notes(version);
  });
  ipcMain.handle('zl-updates-open', event => {
    check(event);
    return shell.openExternal(updater.releaseUrl());
  });
  ipcMain.on('autoUpdate', (event, args) => {
    if (!permitted(event)) return;
    if (
      args?.action === 'check' &&
      (args.manual || settings.app.get('automaticUpdates'))
    )
      void updater.check(Boolean(settings.app.get('beta')));
    if (args?.action === 'install')
      void shell.openExternal(updater.releaseUrl()).catch(() => {
        if (!mainWindow.isDestroyed())
          mainWindow.webContents.send('autoUpdate', {
            error: {
              message: '无法打开浏览器，请在更新设置点击 GitHub 发布页链接',
            },
          });
      });
  });
};
