/* eslint-disable no-void -- UI event handlers start internally handled asynchronous operations. */
import { ipcRenderer } from 'electron';
import { observer } from 'mobx-react';
import { useEffect, useState, useId } from 'react';
import type { StoresProps } from '../../@types/ferdium-components.types';
import type Service from '../../models/Service';
import { defaultTools, parseProxy, type ToolsConfig } from './config';
import {
  configureTranslation,
  getTools,
  saveTools,
  startTranslations,
} from './runtime';
import BulkSend from './BulkSend';

export const languages = [
  ['auto', '自动识别'],
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['en', '英语'],
  ['es', '西班牙语'],
  ['pt', '葡萄牙语'],
  ['fr', '法语'],
  ['de', '德语'],
  ['ar', '阿拉伯语'],
  ['hi', '印地语'],
  ['ja', '日语'],
  ['ko', '韩语'],
  ['ru', '俄语'],
  ['id', '印尼语'],
  ['vi', '越南语'],
  ['th', '泰语'],
  ['tr', '土耳其语'],
];
export function Language({
  label,
  value,
  onChange,
  source = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  source?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={e => onChange(e.target.value)}>
        {languages
          .filter(([id]) => source || id !== 'auto')
          .map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
      </select>
    </label>
  );
}
function Switch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="tools-switch">
      {label}
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={value}
        onChange={e => onChange(e.target.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}
const SettingsPanel = observer(
  ({ service, panel }: { service?: Service; panel: string }) => {
    const [config, setConfig] = useState<ToolsConfig>(defaultTools);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [smart, setSmart] = useState('');
    useEffect(() => {
      let cancelled = false;
      if (service)
        void getTools(service.id)
          .then(c => {
            if (!cancelled) {
              setConfig(c);
              setLoaded(true);
            }
          })
          .catch(() => {
            if (!cancelled) setNotice('配置读取失败');
          });
      return () => {
        cancelled = true;
      };
    }, [service?.id]);
    if (!service)
      return (
        <section className="account-tools-panel">
          <h2>{panel === 'proxy' ? '代理设置' : '翻译配置'}</h2>
          <p>请先在左侧选择一个 WhatsApp 账号。</p>
        </section>
      );
    const proxy = (change: Partial<ToolsConfig['proxy']>) =>
      setConfig(c => ({ ...c, proxy: { ...c.proxy, ...change } }));
    const translation = (change: Partial<ToolsConfig['translation']>) =>
      setConfig(c => ({ ...c, translation: { ...c.translation, ...change } }));
    const apply = async (test = false) => {
      setBusy(true);
      setNotice('');
      try {
        const old = await getTools(service.id);
        const saved = await saveTools(service.id, config);
        setConfig(saved);
        if (panel === 'translation') await configureTranslation(service);
        if (JSON.stringify(old.proxy) !== JSON.stringify(saved.proxy))
          service.webview?.reload();
        if (test) {
          const result = await ipcRenderer.invoke(
            'account-tools-test-proxy',
            service.id,
          );
          setNotice(`连接成功 · ${result.milliseconds}ms · ${result.route}`);
        } else setNotice('已应用到此账号');
      } catch (error) {
        setNotice(String(error instanceof Error ? error.message : error));
      } finally {
        setBusy(false);
      }
    };
    return (
      <section
        className="account-tools-panel"
        aria-label={panel === 'proxy' ? '代理设置' : '翻译配置'}
      >
        <h2>{panel === 'proxy' ? '代理设置' : '翻译配置'}</h2>
        <p className="tools-current">
          当前账号：{service.accountSnapshot.nickname || service.name}
        </p>
        {loaded ? (
          <fieldset disabled={busy}>
            {panel === 'proxy' ? (
              <>
                <Switch
                  label="启用代理"
                  value={config.proxy.enabled}
                  onChange={enabled => proxy({ enabled })}
                />
                <p className="tools-muted">
                  关闭后使用直连网络；应用时会刷新当前账号。
                </p>
                <label htmlFor="zl-AccountTools-3">
                  配置方式
                  <select
                    id="zl-AccountTools-3"
                    value={config.proxy.mode}
                    onChange={e =>
                      proxy({
                        mode: e.target.value as ToolsConfig['proxy']['mode'],
                      })
                    }
                  >
                    <option value="manual">手动配置</option>
                    <option value="system">自动（系统代理）</option>
                    <option value="direct">直接连接</option>
                  </select>
                </label>
                {config.proxy.mode === 'manual' && (
                  <>
                    <label htmlFor="zl-AccountTools-4">
                      协议
                      <select
                        id="zl-AccountTools-4"
                        value={config.proxy.protocol}
                        onChange={e =>
                          proxy({
                            protocol: e.target
                              .value as ToolsConfig['proxy']['protocol'],
                          })
                        }
                      >
                        <option value="http">HTTP</option>
                        <option value="https">HTTPS</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </label>
                    <label htmlFor="zl-AccountTools-5">
                      主机
                      <input
                        id="zl-AccountTools-5"
                        value={config.proxy.host}
                        placeholder="IP 或域名"
                        onChange={e => proxy({ host: e.target.value.trim() })}
                      />
                    </label>
                    <label htmlFor="zl-AccountTools-6">
                      端口
                      <input
                        id="zl-AccountTools-6"
                        inputMode="numeric"
                        value={config.proxy.port}
                        placeholder="1–65535"
                        onChange={e => proxy({ port: e.target.value })}
                      />
                    </label>
                    <label htmlFor="zl-AccountTools-7">
                      用户名
                      <input
                        id="zl-AccountTools-7"
                        autoComplete="off"
                        value={config.proxy.username}
                        onChange={e => proxy({ username: e.target.value })}
                      />
                    </label>
                    <label htmlFor="zl-AccountTools-8">
                      密码
                      <input
                        id="zl-AccountTools-8"
                        type="password"
                        autoComplete="new-password"
                        value={config.proxy.password ?? ''}
                        placeholder={
                          config.proxy.hasPassword
                            ? '已加密保存；留空保持不变'
                            : '可选'
                        }
                        onChange={e => proxy({ password: e.target.value })}
                      />
                    </label>
                    {config.proxy.hasPassword && (
                      <button
                        type="button"
                        className="tools-link"
                        onClick={() =>
                          proxy({ password: '', hasPassword: false })
                        }
                      >
                        清除已保存密码
                      </button>
                    )}
                    <label htmlFor="zl-AccountTools-9">
                      智能填写
                      <textarea
                        id="zl-AccountTools-9"
                        value={smart}
                        placeholder="主机:端口:用户名:密码"
                        onChange={e => setSmart(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          proxy(parseProxy(smart));
                          setSmart('');
                          setNotice('已识别，请应用配置');
                        } catch (error) {
                          setNotice(String(error));
                        }
                      }}
                    >
                      识别代理信息
                    </button>
                    <p className="tools-muted">
                      SOCKS5 支持无认证连接。用户名密码认证请使用 HTTP/HTTPS。
                    </p>
                  </>
                )}
                <button type="button" onClick={() => void apply(true)}>
                  应用并测试连接
                </button>
              </>
            ) : (
              <>
                <Switch
                  label="发送自动翻译"
                  value={config.translation.outgoing}
                  onChange={outgoing => translation({ outgoing })}
                />
                <label htmlFor="zl-AccountTools-10">
                  发送翻译通道
                  <select
                    id="zl-AccountTools-10"
                    value={config.translation.engine}
                    onChange={e =>
                      translation({
                        engine: e.target
                          .value as ToolsConfig['translation']['engine'],
                      })
                    }
                  >
                    <option value="Google">Google</option>
                    <option value="LibreTranslate">LibreTranslate</option>
                  </select>
                </label>
                <Language
                  label="发送源语言"
                  source
                  value={config.translation.source}
                  onChange={source => translation({ source })}
                />
                <Language
                  label="发送目标语言"
                  value={config.translation.sendTarget}
                  onChange={sendTarget => translation({ sendTarget })}
                />
                <hr />
                <Switch
                  label="接收自动翻译"
                  value={config.translation.incoming}
                  onChange={incoming => translation({ incoming })}
                />
                <label htmlFor="receive-engine">
                  接收翻译通道
                  <select
                    id="receive-engine"
                    value={config.translation.receiveEngine}
                    onChange={e =>
                      translation({
                        receiveEngine: e.target
                          .value as ToolsConfig['translation']['receiveEngine'],
                      })
                    }
                  >
                    <option value="Google">Google</option>
                    <option value="LibreTranslate">LibreTranslate</option>
                  </select>
                </label>
                <Language
                  label="接收源语言"
                  source
                  value={config.translation.receiveSource}
                  onChange={receiveSource => translation({ receiveSource })}
                />
                <Language
                  label="接收目标语言"
                  value={config.translation.receiveTarget}
                  onChange={receiveTarget => translation({ receiveTarget })}
                />
                <p className="tools-info">
                  第一次发送仅替换为译文；请校正后再次发送。翻译失败时保留原文，不发送消息。
                </p>
                <p className="tools-muted">
                  接收翻译显示在当前已加载的文字消息下方。启用后，消息文字将发送至所选第三方翻译服务。
                </p>
              </>
            )}
            <button
              type="button"
              className="tools-primary"
              disabled={busy}
              onClick={() => {
                void apply();
              }}
            >
              {busy ? '正在应用…' : '应用'}
            </button>
          </fieldset>
        ) : (
          <p>读取配置中…</p>
        )}
        <p role="status" className="tools-notice">
          {notice}
        </p>
      </section>
    );
  },
);
const AccountTools = observer(({ stores }: StoresProps) => {
  const [panel, setPanel] = useState('');
  const [bulk, setBulk] = useState(false);
  useEffect(() => startTranslations(stores), [stores]);
  const { active } = stores.services;
  const service = active?.recipe.id === 'whatsapp' ? active : undefined;
  return (
    <aside className="account-tools" aria-label="账号工具">
      {panel && (
        <SettingsPanel
          key={`${service?.id}-${panel}`}
          service={service}
          panel={panel}
        />
      )}
      <nav className="account-tools-rail">
        <button type="button" title="收起设置" onClick={() => setPanel('')}>
          ⇥<span>收起</span>
        </button>
        <button
          type="button"
          aria-pressed={panel === 'proxy'}
          onClick={() => setPanel(panel === 'proxy' ? '' : 'proxy')}
        >
          ▤<span>代理</span>
        </button>
        <button
          type="button"
          aria-pressed={panel === 'translation'}
          onClick={() => setPanel(panel === 'translation' ? '' : 'translation')}
        >
          译<span>翻译</span>
        </button>
        <button type="button" onClick={() => setBulk(true)}>
          ☷<span>群发</span>
        </button>
      </nav>
      {bulk && <BulkSend stores={stores} onClose={() => setBulk(false)} />}
    </aside>
  );
});
export default AccountTools;
