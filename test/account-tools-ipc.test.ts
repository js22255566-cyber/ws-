/* eslint-disable global-require -- Load modules after installing fresh privileged Electron mocks. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultTools } from '../src/features/accountTools/config';

describe('privileged account tools IPC', () => {
  let root: string;
  let handlers: Record<string, any>;
  let sessions: Map<string, any>;
  let mainWindow: any;
  let safeStorage: any;
  let event: any;
  let login: any;
  const invoke = (name: string, ...args: any[]) =>
    handlers[`account-tools-${name}`](event, ...args);
  beforeEach(() => {
    jest.resetModules();
    root = mkdtempSync(join(tmpdir(), 'zl-tools-'));
    handlers = {};
    sessions = new Map();
    mainWindow = { webContents: { mainFrame: {} } };
    event = {
      sender: mainWindow.webContents,
      senderFrame: mainWindow.webContents.mainFrame,
    };
    safeStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (text: string) => Buffer.from(`encrypted:${text}`),
      decryptString: (buffer: Buffer) =>
        buffer.toString().replace('encrypted:', ''),
    };
    jest.doMock('electron', () => ({
      app: {
        getPath: () => root,
        on: (_name: string, fn: any) => {
          login = fn;
        },
      },
      ipcMain: {
        handle: (name: string, handler: any) => {
          handlers[name] = handler;
        },
      },
      safeStorage,
      session: {
        fromPartition: (name: string) => {
          if (!sessions.has(name))
            sessions.set(name, {
              setProxy: jest.fn().mockImplementation(async () => {}),
              closeAllConnections: jest.fn().mockImplementation(async () => {}),
              resolveProxy: jest.fn().mockResolvedValue('DIRECT'),
              fetch: jest.fn().mockResolvedValue({ ok: true }),
            });
          return sessions.get(name);
        },
      },
    }));
    jest.doMock('../src/helpers/translation-helpers', () => ({
      translateTo: jest
        .fn()
        .mockResolvedValue({ text: 'translated', error: false }),
    }));
    const init = require('../src/electron/ipc-api/accountTools').default;
    init({ mainWindow });
  });
  afterEach(() => {
    jest.dontMock('electron');
    jest.dontMock('../src/helpers/translation-helpers');
    rmSync(root, { recursive: true, force: true });
  });
  it('rejects webview/subframe IPC access and path-like identifiers', () => {
    event.sender = {};
    expect(() => invoke('get', 'account-1')).toThrow('禁止');
    event.sender = mainWindow.webContents;
    event.senderFrame = {};
    expect(() => invoke('get', 'account-1')).toThrow('禁止');
    event.senderFrame = mainWindow.webContents.mainFrame;
    expect(() => invoke('get', '../../bad')).toThrow('无效账号');
  });
  it('prepares independent Sessions, resets direct on disable, and avoids disturbing another account', async () => {
    await invoke('prepare', 'account-1');
    await invoke('prepare', 'account-2');
    const config = defaultTools();
    config.proxy = {
      ...config.proxy,
      enabled: true,
      host: 'localhost',
      port: '8888',
    };
    await invoke('save', 'account-1', config);
    const first = sessions.get('persist:service-account-1');
    expect(first.setProxy).toHaveBeenLastCalledWith(
      expect.objectContaining({ proxyRules: 'http://localhost:8888' }),
    );
    expect(
      sessions.get('persist:service-account-2').setProxy,
    ).toHaveBeenCalledTimes(1);
    config.proxy.enabled = false;
    await invoke('save', 'account-1', config);
    expect(first.setProxy).toHaveBeenLastCalledWith({ mode: 'direct' });
  });
  it('stores only encrypted passwords, redacts read results and matches proxy authentication to the account Session', async () => {
    const config = defaultTools();
    config.proxy = {
      ...config.proxy,
      enabled: true,
      host: 'localhost',
      port: '8888',
      username: 'tester',
      password: 'synthetic-secret',
    };
    const saved = await invoke('save', 'account-1', config);
    expect(saved.proxy.password).toBeUndefined();
    expect(saved.proxy.hasPassword).toBe(true);
    expect(
      readFileSync(join(root, 'account-tools.json'), 'utf8'),
    ).not.toContain('synthetic-secret');
    const callback = jest.fn();
    const e = { preventDefault: jest.fn() };
    login(
      e,
      { session: {} },
      {},
      { isProxy: true, host: 'localhost', port: 8888 },
      callback,
    );
    expect(callback).not.toHaveBeenCalled();
    login(
      e,
      { session: sessions.get('persist:service-account-1') },
      {},
      { isProxy: true, host: 'localhost', port: 8888 },
      callback,
    );
    expect(callback).toHaveBeenCalledWith('tester', 'synthetic-secret');
  });
  it('refuses password persistence if secure storage is unavailable', async () => {
    safeStorage.isEncryptionAvailable = () => false;
    const c = defaultTools();
    c.proxy.password = 'synthetic-secret';
    await expect(invoke('save', 'account-1', c)).rejects.toThrow(
      '安全存储不可用',
    );
  });
  it('does not translate disabled directions; uses account source and target languages', async () => {
    await expect(
      invoke('translate', 'account-1', 'hello', 'outgoing'),
    ).rejects.toThrow('未启用');
    const c = defaultTools();
    c.translation.outgoing = true;
    c.translation.source = 'es';
    await invoke('save', 'account-1', c);
    expect(await invoke('translate', 'account-1', 'hola', 'outgoing')).toEqual({
      text: 'translated',
      error: false,
    });
    expect(
      require('../src/helpers/translation-helpers').translateTo,
    ).toHaveBeenCalledWith('hola', 'en', 'Google', 'es');
  });
  it('uses independent incoming translation provider, source and target settings', async () => {
    const c = defaultTools();
    c.translation.incoming = true;
    c.translation.receiveEngine = 'LibreTranslate';
    c.translation.receiveSource = 'en';
    c.translation.receiveTarget = 'fr';
    await invoke('save', 'account-1', c);
    await invoke('translate', 'account-1', 'hello', 'incoming');
    expect(
      require('../src/helpers/translation-helpers').translateTo,
    ).toHaveBeenCalledWith('hello', 'fr', 'LibreTranslate', 'en');
  });
  it('does not claim proxy success after a direct-route fallback', async () => {
    const c = defaultTools();
    c.proxy = { ...c.proxy, enabled: true, host: 'localhost', port: '8888' };
    await invoke('save', 'account-1', c);
    await expect(invoke('test-proxy', 'account-1')).rejects.toThrow('未使用');
    expect(
      sessions.get('persist:service-account-1').fetch,
    ).not.toHaveBeenCalled();
  });
  it('deleting an account removes its stored credential/configuration', async () => {
    await invoke('save', 'account-1', defaultTools());
    await invoke('remove', 'account-1');
    expect(
      JSON.parse(readFileSync(join(root, 'account-tools.json'), 'utf8'))
        .accounts,
    ).toEqual({});
  });
});
