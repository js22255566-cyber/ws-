import { app, ipcMain, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import CustomerStore from '../CustomerStore';

export default function initCustomers(mainWindow: BrowserWindow) {
  let store: CustomerStore | undefined;
  const getStore = () => {
    store ??= new CustomerStore(
      join(app.getPath('userData'), 'customers.json'),
    );
    return store;
  };
  const check = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error('禁止访问客户资料');
  };
  ipcMain.handle('customers-bind', (event, identities: string[]) => {
    check(event);
    return getStore().bind(identities);
  });
  ipcMain.handle('customers-link', (event, owner: string, ids: string[]) => {
    check(event);
    getStore().link(owner, ids);
    return getStore().bundle(owner);
  });
  ipcMain.handle('customers-profile', (event, owner: string, id: string) => {
    check(event);
    return getStore().profile(owner, id);
  });
  ipcMain.handle(
    'customers-update',
    (event, owner: string, id: string, input: unknown) => {
      check(event);
      return getStore().update(owner, id, input);
    },
  );
  ipcMain.handle(
    'customers-patch',
    (event, owner: string, id: string, input: unknown) => {
      check(event);
      return getStore().patch(owner, id, input);
    },
  );
  ipcMain.handle(
    'customers-pin',
    (
      event,
      owner: string,
      id: string,
      action: 'pin' | 'unpin' | 'up' | 'down',
    ) => {
      check(event);
      return getStore().pin(owner, id, action);
    },
  );
}
