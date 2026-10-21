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
  proxyRules,
  type ToolsConfig,
  type SendRecord,
} from '../../features/accountTools/config';
import { translateTo } from '../../helpers/translation-helpers';
import TranslationQueue from '../../features/accountTools/TranslationQueue';

type StoredConfig = ToolsConfig & { encryptedPassword?: string };
export default ({ mainWindow }: { mainWindow: BrowserWindow }) => {
  const path = join(app.getPath('userData'), 'account-tools.json');
  const translations = new TranslationQueue();
  let data: { accounts: Record<string, StoredConfig>; history: SendRecord[] } =
    { accounts: {}, history: [] };
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
      translation: c.translation,
    };
  };
  const prepared = new Map<string, Promise<void>>();
  const apply = (id: string, config: ToolsConfig) => {
    const pending = (prepared.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const s = session.fromPartition(`persist:service-${id}`);
        await s.setProxy(proxyRules(config.proxy));
        await s.closeAllConnections();
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
        !['Google', 'LibreTranslate'].includes(input.translation.engine) ||
        !['Google', 'LibreTranslate'].includes(
          input.translation.receiveEngine,
        ) ||
        ![
          input.translation.source,
          input.translation.receiveSource,
          input.translation.sendTarget,
          input.translation.receiveTarget,
        ].every(l => /^(?:auto|[a-z]{2,3}(?:-[A-Za-z]{2,4})?)$/.test(l))
      )
        throw new Error('无效的翻译配置');
      let { encryptedPassword } = previous;
      if (input.proxy.password !== undefined) {
        if (input.proxy.password) {
          if (
            !safeStorage.isEncryptionAvailable() ||
            (process.platform === 'linux' &&
              safeStorage.getSelectedStorageBackend() === 'basic_text')
          )
            throw new Error('系统安全存储不可用，不能保存代理密码');
          encryptedPassword = safeStorage
            .encryptString(input.proxy.password)
            .toString('base64');
        } else encryptedPassword = undefined;
      }
      const config: StoredConfig = {
        ...input,
        proxy: { ...input.proxy, password: undefined, hasPassword: undefined },
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
    const response = await s.fetch('https://web.whatsapp.com/', {
      method: 'HEAD',
      bypassCustomProtocolHandlers: true,
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
      return translations.enqueue(id, direction === 'outgoing', async () => {
        if (
          JSON.stringify(get(id).translation) !== JSON.stringify(t) ||
          !get(id).translation[direction]
        )
          return { text: '', error: true };
        return translateTo(
          text,
          direction === 'incoming' ? t.receiveTarget : t.sendTarget,
          direction === 'incoming' ? t.receiveEngine : t.engine,
          direction === 'incoming' ? t.receiveSource : t.source,
        );
      });
    },
  );
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
