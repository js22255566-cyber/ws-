// ZL-WA: privileged proxy, credential and translation operations stay in the host.
import {
  app,
  ipcMain,
  safeStorage,
  session,
  type BrowserWindow,
} from 'electron';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultTools,
  translationEngines,
  type TranslationEngine,
  proxyRules,
  type ToolsConfig,
  type SendRecord,
} from '../../features/accountTools/config';
import { translateAccount } from '../accountTranslation';
import { createSocksBridge } from '../socksProxy';
import { accountTransport } from '../accountTransport';
import TranslationQueue from '../../features/accountTools/TranslationQueue';
import initBulkMedia from './bulkMedia';
import TranslationCache from '../TranslationCache';
import {
  normalizeBulkPreferences,
  type BulkPreferences,
} from '../../features/accountTools/bulkPreferences';

type StoredConfig = ToolsConfig & {
  encryptedPassword?: string;
  encryptedKeys?: Partial<Record<TranslationEngine, string>>;
};
const decrypt = (value?: string) =>
  value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : '';
const encrypt = (value: string) => {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
    throw new Error('系统安全存储不可用，不能保存密钥或代理密码');
  return safeStorage.encryptString(value).toString('base64');
};
export default ({ mainWindow }: { mainWindow: BrowserWindow }) => {
  initBulkMedia(mainWindow);
  const path = join(app.getPath('userData'), 'account-tools.json');
  const translations = new TranslationQueue();
  const translationCache = new TranslationCache(
    join(app.getPath('userData'), 'translation-cache.json'),
  );
  let data: {
    accounts: Record<string, StoredConfig>;
    history: SendRecord[];
    bulkPreferences?: BulkPreferences;
  } = { accounts: {}, history: [] };
  if (existsSync(path)) {
    try {
      data = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error('账号工具配置损坏，请备份并检查 account-tools.json');
    }
  }
  const save = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify(data), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  };
  const check = (event: Electron.IpcMainInvokeEvent, id?: string) => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error('禁止访问账号工具');
    if (id !== undefined && !/^[\da-z-]{1,100}$/i.test(id))
      throw new Error('无效账号');
  };
  const get = (id: string): StoredConfig => {
    const saved = data.accounts[id];
    const defaults = defaultTools();
    return {
      ...defaults,
      ...saved,
      proxy: { ...defaults.proxy, ...saved?.proxy },
      translation: { ...defaults.translation, ...saved?.translation },
    };
  };
  const publicConfig = (id: string): ToolsConfig => {
    const c = get(id);
    return {
      proxy: {
        ...c.proxy,
        password: undefined,
        hasPassword: Boolean(c.encryptedPassword),
      },
      translation: {
        ...c.translation,
        cacheRevision: TranslationCache.key([c.providers, c.encryptedKeys]),
      },
      providers: Object.fromEntries(
        translationEngines.map(engine => [
          engine,
          {
            model: c.providers?.[engine]?.model,
            hasApiKey: Boolean(c.encryptedKeys?.[engine]),
          },
        ]),
      ),
    };
  };
  const bridges = new Map<
    string,
    Awaited<ReturnType<typeof createSocksBridge>>
  >();
  app.on('before-quit', () => {
    translationCache.flush();
    for (const bridge of bridges.values()) bridge.close();
    bridges.clear();
  });
  const prepared = new Map<string, Promise<void>>();
  const apply = (id: string, config: StoredConfig) => {
    const pending = (prepared.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const s = session.fromPartition(`persist:service-${id}`);
        // acceptLanguages also applies to WhatsApp login/new account pages.
        if (typeof s.setUserAgent === 'function')
          s.setUserAgent(s.getUserAgent(), 'zh-CN,zh,en-US,en');
        let rules = proxyRules(config.proxy);
        let bridge: Awaited<ReturnType<typeof createSocksBridge>> | undefined;
        if (
          config.proxy.enabled &&
          config.proxy.mode === 'manual' &&
          config.proxy.protocol === 'socks5' &&
          (config.proxy.username || config.encryptedPassword)
        ) {
          bridge = await createSocksBridge(
            config.proxy,
            decrypt(config.encryptedPassword),
          );
          rules = {
            mode: 'fixed_servers',
            proxyRules: `http://127.0.0.1:${bridge.port}`,
            proxyBypassRules: '<-loopback>',
          };
        }
        try {
          await s.setProxy(rules);
          await s.closeAllConnections();
        } catch (error) {
          bridge?.close();
          throw error;
        }
        bridges.get(id)?.close();
        bridges.delete(id);
        if (bridge) bridges.set(id, bridge);
      });
    prepared.set(id, pending);
    return pending;
  };
  // Authentication is scoped to this account's Session and exact configured proxy.
  const authenticated = new Set<string>();
  const attachAuth = (id: string) => {
    if (authenticated.has(id)) return;
    authenticated.add(id);
    const s = session.fromPartition(`persist:service-${id}`);
    app.on('login', (event, contents, _details, auth, callback) => {
      if (contents?.session !== s) return;
      const c = get(id);
      if (
        !auth.isProxy ||
        !c.proxy.enabled ||
        c.proxy.mode !== 'manual' ||
        auth.host !== c.proxy.host.replaceAll(/^\[|]$/g, '') ||
        auth.port !== Number(c.proxy.port)
      )
        return;
      event.preventDefault();
      try {
        callback(
          c.proxy.username,
          c.encryptedPassword
            ? safeStorage.decryptString(
                Buffer.from(c.encryptedPassword, 'base64'),
              )
            : '',
        );
      } catch {
        callback();
      }
    });
  };
  ipcMain.handle('account-tools-remove', async (event, id: string) => {
    check(event, id);
    translationCache.removeAccount(id);
    data.accounts = Object.fromEntries(
      Object.entries(data.accounts).filter(([key]) => key !== id),
    );
    await apply(id, defaultTools());
    save();
  });
  ipcMain.handle('account-tools-get', (event, id: string) => {
    check(event, id);
    return publicConfig(id);
  });
  ipcMain.handle('account-tools-prepare', async (event, id: string) => {
    check(event, id);
    attachAuth(id);
    try {
      await (prepared.has(id) ? prepared.get(id) : apply(id, get(id)));
    } catch (error) {
      prepared.delete(id);
      throw error;
    }
    return publicConfig(id);
  });
  ipcMain.handle(
    'account-tools-save',
    async (event, id: string, input: ToolsConfig) => {
      check(event, id);
      const previous = get(id);
      proxyRules(input.proxy);
      if (
        !translationEngines.includes(input.translation.engine) ||
        !translationEngines.includes(input.translation.receiveEngine) ||
        ![
          input.translation.source,
          input.translation.receiveSource,
          input.translation.sendTarget,
          input.translation.receiveTarget,
        ].every(l => /^(?:auto|[a-z]{2,3}(?:-[A-Za-z]{2,4})?)$/.test(l))
      )
        throw new Error('无效的翻译配置');
      let { encryptedPassword } = previous;
      if (input.proxy.password !== undefined)
        encryptedPassword = input.proxy.password
          ? encrypt(input.proxy.password)
          : undefined;
      const encryptedKeys = { ...previous.encryptedKeys };
      const providers: ToolsConfig['providers'] = {};
      for (const engine of translationEngines) {
        const credential = input.providers?.[engine];
        if (credential?.apiKey !== undefined)
          encryptedKeys[engine] = credential.apiKey
            ? encrypt(credential.apiKey.trim())
            : undefined;
        const model =
          credential?.model ?? previous.providers?.[engine]?.model ?? '';
        if (
          typeof model !== 'string' ||
          model.length > 100 ||
          (model && !/^[\w.-]+$/.test(model))
        )
          throw new Error('模型名称无效');
        providers[engine] = { model };
      }
      // Build an explicit allow-list: no plaintext credential can enter persistent JSON.
      const config: StoredConfig = {
        proxy: {
          enabled: Boolean(input.proxy.enabled),
          mode: input.proxy.mode,
          protocol: input.proxy.protocol,
          host: input.proxy.host.trim(),
          port: input.proxy.port.trim(),
          username: input.proxy.username,
        },
        translation: {
          outgoing: Boolean(input.translation.outgoing),
          incoming: Boolean(input.translation.incoming),
          preview: Boolean(input.translation.preview),
          engine: input.translation.engine,
          receiveEngine: input.translation.receiveEngine,
          source: input.translation.source,
          receiveSource: input.translation.receiveSource,
          sendTarget: input.translation.sendTarget,
          receiveTarget: input.translation.receiveTarget,
        },
        providers,
        encryptedKeys,
        encryptedPassword,
      };
      const old = previous;
      data.accounts[id] = config;
      try {
        attachAuth(id);
        if (
          JSON.stringify(previous.proxy) !== JSON.stringify(config.proxy) ||
          previous.encryptedPassword !== config.encryptedPassword
        )
          await apply(id, config);
        save();
      } catch (error) {
        data.accounts[id] = old;
        await apply(id, old);
        throw error;
      }
      return publicConfig(id);
    },
  );
  ipcMain.handle('account-tools-test-proxy', async (event, id: string) => {
    check(event, id);
    attachAuth(id);
    await (prepared.has(id) ? prepared.get(id) : apply(id, get(id)));
    const s = session.fromPartition(`persist:service-${id}`);
    const started = Date.now();
    // session.fetch also permits Chromium fallback to DIRECT; resolveProxy must agree first.
    const route = await s.resolveProxy('https://web.whatsapp.com/');
    if (
      get(id).proxy.enabled &&
      get(id).proxy.mode === 'manual' &&
      !/^(PROXY|HTTPS|SOCKS)/.test(route)
    )
      throw new Error('当前会话未使用配置的代理');
    const config = get(id);
    const response = await accountTransport(s, config.proxy, () =>
      decrypt(config.encryptedPassword),
    )('https://web.whatsapp.com/', {
      method: 'HEAD',
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`连接失败：HTTP ${response.status}`);
    return { route, milliseconds: Date.now() - started };
  });
  ipcMain.handle(
    'account-tools-translate',
    async (
      event,
      id: string,
      text: string,
      direction: 'incoming' | 'outgoing',
    ) => {
      check(event, id);
      if (
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > 12_000 ||
        !['incoming', 'outgoing'].includes(direction)
      )
        throw new Error('翻译内容为空或超过 12000 字符');
      const t = get(id).translation;
      if (!t[direction]) throw new Error('当前账号未启用此方向翻译');
      const engine = direction === 'incoming' ? t.receiveEngine : t.engine;
      const savedConfig = get(id);
      const key = TranslationCache.key([
        id,
        engine,
        direction === 'incoming' ? t.receiveSource : t.source,
        direction === 'incoming' ? t.receiveTarget : t.sendTarget,
        savedConfig.providers?.[engine]?.model,
        savedConfig.encryptedKeys?.[engine],
        text,
      ]);
      const cached = translationCache.get(key);
      if (cached !== undefined) return { text: cached, error: false };
      return translations.enqueue(id, direction === 'outgoing', async () => {
        if (
          JSON.stringify(get(id).translation) !== JSON.stringify(t) ||
          !get(id).translation[direction] ||
          JSON.stringify([get(id).providers, get(id).encryptedKeys]) !==
            JSON.stringify([savedConfig.providers, savedConfig.encryptedKeys])
        )
          return { text: '', error: true };
        await (prepared.has(id) ? prepared.get(id) : apply(id, get(id)));
        const engine = direction === 'incoming' ? t.receiveEngine : t.engine;
        const config = get(id);
        const s = session.fromPartition(`persist:service-${id}`);
        const repeated = translationCache.get(key);
        if (repeated !== undefined) return { text: repeated, error: false };
        const result = await translateAccount(
          accountTransport(s, config.proxy, () =>
            decrypt(config.encryptedPassword),
          ),
          text,
          direction === 'incoming' ? t.receiveTarget : t.sendTarget,
          engine,
          direction === 'incoming' ? t.receiveSource : t.source,
          decrypt(config.encryptedKeys?.[engine]),
          config.providers?.[engine]?.model,
        );
        if (!result.error && data.accounts[id])
          translationCache.set(id, key, result.text);
        return result;
      });
    },
  );
  ipcMain.handle(
    'account-tools-test-translation',
    async (event, id: string, direction: 'incoming' | 'outgoing') => {
      check(event, id);
      if (!['incoming', 'outgoing'].includes(direction))
        throw new Error('无效翻译方向');
      const config = get(id);
      const t = config.translation;
      const engine = direction === 'incoming' ? t.receiveEngine : t.engine;
      await (prepared.has(id) ? prepared.get(id) : apply(id, config));
      const s = session.fromPartition(`persist:service-${id}`);
      return translations.enqueue(id, true, () =>
        translateAccount(
          accountTransport(s, config.proxy, () =>
            decrypt(config.encryptedPassword),
          ),
          'Hello, this is a translation connection test.',
          direction === 'incoming' ? t.receiveTarget : t.sendTarget,
          engine,
          'en',
          decrypt(config.encryptedKeys?.[engine]),
          config.providers?.[engine]?.model,
        ),
      );
    },
  );
  ipcMain.handle(
    'account-tools-bulk-preferences',
    (event, input?: BulkPreferences) => {
      check(event);
      if (input !== undefined) {
        const previous = data.bulkPreferences;
        data.bulkPreferences = normalizeBulkPreferences(input);
        try {
          save();
        } catch (error) {
          data.bulkPreferences = previous;
          throw error;
        }
      }
      return normalizeBulkPreferences(data.bulkPreferences);
    },
  );
  ipcMain.handle('account-tools-history-delete', (event, ids: string[]) => {
    check(event);
    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      ids.some(id => typeof id !== 'string' || id.length > 100)
    )
      throw new Error('无效记录编号');
    const previous = data.history;
    data.history = previous.filter(r => !ids.includes(r.id));
    try {
      save();
    } catch (error) {
      data.history = previous;
      throw error;
    }
    return data.history;
  });
  ipcMain.handle('account-tools-history', (event, record?: SendRecord) => {
    check(event);
    if (record) {
      data.history = [
        record,
        ...data.history.filter(r => r.id !== record.id),
      ].slice(0, 100);
      save();
    }
    return data.history;
  });
};
