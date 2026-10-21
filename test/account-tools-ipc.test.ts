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
  let beforeQuit: () => void;
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
        on: (name: string, fn: any) => {
          if (name === 'login') login = fn;
          if (name === 'before-quit') beforeQuit = fn;
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
    jest.doMock('../src/electron/accountTranslation', () => ({
      translateAccount: jest
        .fn()
        .mockResolvedValue({ text: 'translated', error: false }),
    }));
    const init = require('../src/electron/ipc-api/accountTools').default;
    init({ mainWindow });
  });
  afterEach(() => {
    beforeQuit?.();
    jest.dontMock('electron');
    jest.dontMock('../src/electron/accountTranslation');
    rmSync(root, { recursive: true, force: true });
  });
  it('persists and restores bulk settings without storing recipients, content or an old scheduled date', () => {
    const saved = invoke('bulk-preferences', {
      type: 'video',
      scheduled: true,
      randomInterval: true,
      intervalMin: 4.5,
      intervalMax: 8,
      typingSeconds: 3,
      mentionAll: true,
      failure: 'continue',
      kind: 'group',
      text: 'must not persist',
      targets: ['private'],
      scheduledAt: '2026-10-21',
    });
    require('../src/electron/ipc-api/accountTools').default({ mainWindow });
    expect(invoke('bulk-preferences')).toEqual(saved);
    const raw = readFileSync(join(root, 'account-tools.json'), 'utf8');
    expect(raw).not.toContain('must not persist');
    expect(raw).not.toContain('scheduledAt');
    expect(
      invoke('bulk-preferences', {
        intervalMin: -2,
        typingSeconds: 100,
        failure: 'bad',
      }),
    ).toMatchObject({ intervalMin: 1.5, typingSeconds: 0, failure: 'stop' });
    event.senderFrame = {};
    expect(() => invoke('bulk-preferences')).toThrow('禁止');
  });
  it('reuses translations across preview toggles and reloads, with separate account and target caches', async () => {
    const config = defaultTools();
    config.translation.incoming = true;
    await invoke('save', 'account-1', config);
    const translate =
      require('../src/electron/accountTranslation').translateAccount;
    await invoke('translate', 'account-1', 'cache source', 'incoming');
    await invoke('translate', 'account-1', 'cache source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(1);
    config.translation.preview = true;
    await invoke('save', 'account-1', config);
    await invoke('translate', 'account-1', 'cache source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(1);
    beforeQuit();
    require('../src/electron/ipc-api/accountTools').default({ mainWindow });
    await invoke('translate', 'account-1', 'cache source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(1);
    config.translation.receiveTarget = 'en';
    await invoke('save', 'account-1', config);
    await invoke('translate', 'account-1', 'cache source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(2);
    await invoke('save', 'account-2', config);
    await invoke('translate', 'account-2', 'cache source', 'incoming');
    expect(translate).toHaveBeenCalledTimes(3);
  });
  it('does not associate a new model response with an old cache key while session preparation is pending', async () => {
    const config = defaultTools();
    config.translation.incoming = true;
    await invoke('save', 'account-1', config);
    let release!: () => void;
    let entered!: () => void;
    const preparing = new Promise<void>(resolve => {
      entered = resolve;
    });
    sessions.get('persist:service-account-1').setProxy.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
          entered();
        }),
    );
    const preparation = invoke('prepare', 'account-1');
    await preparing;
    const request = invoke(
      'translate',
      'account-1',
      'pending model',
      'incoming',
    );
    await invoke('save', 'account-1', {
      ...config,
      providers: { Google: { model: 'changed-model' } },
    });
    release();
    await preparation;
    expect(await request).toMatchObject({ error: true });
    expect(
      require('../src/electron/accountTranslation').translateAccount,
    ).not.toHaveBeenCalled();
  });
  it('deleting selected local history preserves other records and account settings', async () => {
    await invoke('save', 'account-1', defaultTools());
    const record = {
      id: 'one',
      started: new Date().toISOString(),
      text: 'test',
      status: '已完成',
      total: 1,
      success: 1,
      failed: 0,
      details: [],
    };
    invoke('history', record);
    invoke('history', { ...record, id: 'two' });
    expect(invoke('history-delete', ['one'])).toEqual([
      { ...record, id: 'two' },
    ]);
    expect(
      JSON.parse(readFileSync(join(root, 'account-tools.json'), 'utf8'))
        .accounts['account-1'],
    ).toBeDefined();
    expect(() => invoke('history-delete', 'all')).toThrow('无效');
    event.senderFrame = {};
    expect(() => invoke('history-delete', ['two'])).toThrow('禁止');
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
  it('allocates distinct authenticated SOCKS bridges per account and releases only the disabled account', async () => {
    const c = defaultTools();
    c.proxy = {
      ...c.proxy,
      enabled: true,
      protocol: 'socks5',
      host: '127.0.0.1',
      port: '9',
      username: 'synthetic',
      password: 'synthetic-secret',
    };
    await invoke('save', 'account-1', c);
    await invoke('save', 'account-2', c);
    const first = sessions.get('persist:service-account-1');
    const second = sessions.get('persist:service-account-2');
    const a = first.setProxy.mock.calls.at(-1)[0];
    const b = second.setProxy.mock.calls.at(-1)[0];
    expect(a.proxyRules).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(a.proxyRules).not.toBe(b.proxyRules);
    c.proxy.enabled = false;
    await invoke('save', 'account-1', c);
    expect(first.setProxy).toHaveBeenLastCalledWith({ mode: 'direct' });
    expect(second.setProxy).toHaveBeenCalledTimes(1);
    const saved = await invoke('get', 'account-2');
    expect(saved.proxy.password).toBeUndefined();
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
      require('../src/electron/accountTranslation').translateAccount,
    ).toHaveBeenCalledWith(
      expect.any(Function),
      'hola',
      'en',
      'Google',
      'es',
      '',
      '',
    );
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
      require('../src/electron/accountTranslation').translateAccount,
    ).toHaveBeenCalledWith(
      expect.any(Function),
      'hello',
      'fr',
      'LibreTranslate',
      'en',
      '',
      '',
    );
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
  it('encrypts and redacts API keys, preserves saved keys on blank UI, and supports clearing them', async () => {
    const c = defaultTools();
    c.providers = {
      OpenAI: { apiKey: 'synthetic-provider-key', model: 'gpt-4.1-mini' },
    };
    const saved = await invoke('save', 'account-1', c);
    expect(saved.providers.OpenAI).toEqual({
      model: 'gpt-4.1-mini',
      hasApiKey: true,
    });
    expect(
      readFileSync(join(root, 'account-tools.json'), 'utf8'),
    ).not.toContain('synthetic-provider-key');
    const preserved = await invoke('save', 'account-1', saved);
    expect(preserved.providers.OpenAI.hasApiKey).toBe(true);
    preserved.providers.OpenAI.apiKey = '';
    const cleared = await invoke('save', 'account-1', preserved);
    expect(cleared.providers.OpenAI.hasApiKey).toBe(false);
  });
  it.each(['OpenAI', 'Gemini'] as const)(
    'uses the user-supplied %s key only in privileged provider requests',
    async engine => {
      const c = defaultTools();
      c.translation.outgoing = true;
      c.translation.engine = engine;
      c.providers = {
        [engine]: { apiKey: 'synthetic-user-key', model: 'synthetic-model' },
      };
      const saved = await invoke('save', 'account-1', c);
      expect(JSON.stringify(saved)).not.toContain('synthetic-user-key');
      await invoke('translate', 'account-1', 'hello', 'outgoing');
      expect(
        require('../src/electron/accountTranslation').translateAccount,
      ).toHaveBeenCalledWith(
        expect.any(Function),
        'hello',
        'en',
        engine,
        'auto',
        'synthetic-user-key',
        'synthetic-model',
      );
    },
  );
  it('deleting an account removes its stored credential/configuration', async () => {
    await invoke('save', 'account-1', defaultTools());
    await invoke('remove', 'account-1');
    expect(
      JSON.parse(readFileSync(join(root, 'account-tools.json'), 'utf8'))
        .accounts,
    ).toEqual({});
  });
});
