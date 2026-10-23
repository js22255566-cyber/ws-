/* eslint-disable no-void -- UI event handlers start internally handled asynchronous operations. */
import { Divider, Menu, MenuItem } from '@mui/material';
import {
  mdiAccountGroupOutline,
  mdiAccountMultiplePlusOutline,
  mdiAccountMultipleMinusOutline,
  mdiCardAccountDetailsOutline,
  mdiDotsHorizontalCircleOutline,
  mdiSendOutline,
  mdiShieldLockOutline,
  mdiTranslate,
} from '@mdi/js';
import { ipcRenderer, clipboard } from 'electron';
import { observer } from 'mobx-react';
import { useEffect, useState, useId } from 'react';
import type { GroupMode } from '../groups/types';
import GroupTools from '../groups/GroupTools';
import CustomerPanel, {
  CustomerRemarkDialog,
} from '../customers/CustomerPanel';
import { getCustomerRuntime } from '../customers/runtime';
import type { StoresProps } from '../../@types/ferdium-components.types';
import type Service from '../../models/Service';
import {
  defaultTools,
  parseProxy,
  translationEngines,
  type ToolsConfig,
} from './config';
import {
  configureTranslation,
  getTools,
  saveTools,
  startTranslations,
} from './runtime';
import BulkSend from './BulkSend';
import { translationDiagnostics } from './guest';

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
/** One consistent symbol set for the tool rail (filled 24-unit glyphs). */
function RailIcon({ path }: { path: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
const SettingsPanel = observer(
  ({
    service,
    panel,
    textColor,
  }: {
    service?: Service;
    panel: string;
    textColor?: string;
  }) => {
    const [config, setConfig] = useState<ToolsConfig>(defaultTools);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [smart, setSmart] = useState('');
    const [diagnostics, setDiagnostics] = useState('');
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
    const pageStatus = async () => {
      if (!service.webview) throw new Error('请先打开已登录的 WhatsApp 聊天');
      const status = await service.webview.executeJavaScript(
        `(${translationDiagnostics.toString()})()`,
      );
      setDiagnostics(JSON.stringify(status, null, 2));
      if (!status.enabled) return '接收翻译未开启';
      const count = status.counts['[data-zl-translate]'];
      return `已识别 ${count} 条可翻译消息 · 已显示 ${status.translated} 条译文 · 待处理 ${status.pending}${count === 0 ? '；请打开文字聊天，或复制页面诊断反馈' : ''}`;
    };
    const apply = async (
      test: boolean | 'incoming' | 'outgoing' = false,
      input = config,
    ) => {
      setBusy(true);
      setNotice('');
      try {
        const old = await getTools(service.id);
        const saved = await saveTools(service.id, input);
        setConfig(saved);
        if (panel === 'translation')
          await configureTranslation(service, textColor);
        if (JSON.stringify(old.proxy) !== JSON.stringify(saved.proxy))
          service.webview?.reload();
        if (typeof test === 'string') {
          const result = await ipcRenderer.invoke(
            'account-tools-test-translation',
            service.id,
            test,
          );
          setNotice(
            result.error
              ? result.message || '翻译测试失败'
              : `翻译测试成功：${result.text}`,
          );
        } else if (test) {
          const result = await ipcRenderer.invoke(
            'account-tools-test-proxy',
            service.id,
          );
          setNotice(`连接成功 · ${result.milliseconds}ms · ${result.route}`);
        } else
          setNotice(
            panel === 'translation'
              ? `已应用到此账号 · ${await pageStatus()}`
              : '已应用到此账号',
          );
      } catch (error) {
        if (input !== config) {
          const saved = await getTools(service.id);
          setConfig(current => ({
            ...current,
            translation: saved.translation,
          }));
        }
        setNotice(String(error instanceof Error ? error.message : error));
      } finally {
        setBusy(false);
      }
    };
    const toggleTranslation = (change: Partial<ToolsConfig['translation']>) => {
      const next = {
        ...config,
        translation: { ...config.translation, ...change },
      };
      setConfig(next);
      void apply(false, next);
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
                  关闭后使用系统默认网络环境；应用时会刷新当前账号。
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
                      SOCKS5
                      支持用户名密码认证，通过此账号独立的本地桥接连接上游代理。
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
                  onChange={outgoing => toggleTranslation({ outgoing })}
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
                    {translationEngines.map(engine => (
                      <option key={engine} value={engine}>
                        {engine === 'Google'
                          ? 'Google（免 Key）'
                          : engine === 'DeepL'
                            ? 'DeepL API Free（自填 Key）'
                            : engine}
                      </option>
                    ))}
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
                  label="接收翻译（收发消息）"
                  value={config.translation.incoming}
                  onChange={incoming =>
                    toggleTranslation({
                      incoming,
                      ...(incoming ? {} : { preview: false }),
                    })
                  }
                />
                <Switch
                  label="翻译预览"
                  value={config.translation.preview}
                  onChange={preview =>
                    toggleTranslation({
                      preview,
                      ...(preview ? { incoming: true } : {}),
                    })
                  }
                />
                <p className="tools-muted">
                  开启接收翻译后，收发文字消息下方显示「点击翻译」。翻译预览开启后，从下一个打开的聊天开始，分批翻译可见消息。成功译文保存在本机，返回聊天优先恢复缓存；未翻译的消息可点击按钮手动翻译。译文使用接收翻译通道及目标语言。
                </p>
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
                    {translationEngines.map(engine => (
                      <option key={engine} value={engine}>
                        {engine === 'Google'
                          ? 'Google（免 Key）'
                          : engine === 'DeepL'
                            ? 'DeepL API Free（自填 Key）'
                            : engine}
                      </option>
                    ))}
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
                {[
                  ...new Set([
                    'OpenAI' as const,
                    'Gemini' as const,
                    config.translation.engine,
                    config.translation.receiveEngine,
                  ]),
                ]
                  .filter(
                    engine =>
                      engine !== 'Google' && engine !== 'LibreTranslate',
                  )
                  .map(engine => (
                    <details
                      key={engine}
                      className="tools-provider"
                      open={
                        config.translation.engine === engine ||
                        config.translation.receiveEngine === engine
                      }
                    >
                      <summary>{engine} API Key 设置（此账号）</summary>
                      <fieldset>
                        <legend>{engine} 配置</legend>
                        <label htmlFor={`provider-key-${engine}`}>
                          API Key
                          <input
                            id={`provider-key-${engine}`}
                            type="password"
                            autoComplete="new-password"
                            value={config.providers?.[engine]?.apiKey ?? ''}
                            placeholder={
                              config.providers?.[engine]?.hasApiKey
                                ? '已安全保存；留空保留原 Key'
                                : '请输入自己的 API Key'
                            }
                            onChange={event => {
                              const apiKey = event.target.value;
                              setConfig(c => ({
                                ...c,
                                providers: {
                                  ...c.providers,
                                  [engine]: {
                                    ...c.providers?.[engine],
                                    apiKey: apiKey || undefined,
                                  },
                                },
                              }));
                            }}
                          />
                        </label>
                        {config.providers?.[engine]?.hasApiKey && (
                          <button
                            type="button"
                            onClick={() =>
                              setConfig(c => ({
                                ...c,
                                providers: {
                                  ...c.providers,
                                  [engine]: {
                                    ...c.providers?.[engine],
                                    apiKey: '',
                                    hasApiKey: false,
                                  },
                                },
                              }))
                            }
                          >
                            清除已保存 Key（应用后生效）
                          </button>
                        )}
                        {(engine === 'OpenAI' || engine === 'Gemini') && (
                          <label htmlFor={`provider-model-${engine}`}>
                            模型名称
                            <input
                              id={`provider-model-${engine}`}
                              value={config.providers?.[engine]?.model ?? ''}
                              placeholder={
                                engine === 'OpenAI'
                                  ? 'gpt-4.1-mini'
                                  : 'gemini-2.5-flash'
                              }
                              onChange={event => {
                                const model = event.target.value;
                                setConfig(c => ({
                                  ...c,
                                  providers: {
                                    ...c.providers,
                                    [engine]: {
                                      ...c.providers?.[engine],
                                      model,
                                    },
                                  },
                                }));
                              }}
                            />
                          </label>
                        )}
                      </fieldset>
                    </details>
                  ))}
                <p className="tools-muted">
                  Google 免 Key 通道为非官方接口，可用性和额度无法保证；DeepL
                  API Free 需自行申请 Key。OpenAI、Gemini
                  按各自账号额度或计费规则使用。翻译连接使用当前账号的网络代理。
                </p>
                <button type="button" onClick={() => void apply('outgoing')}>
                  应用并测试发送翻译
                </button>
                <button type="button" onClick={() => void apply('incoming')}>
                  应用并测试接收翻译
                </button>
                <p className="tools-muted">
                  翻译开关立即生效。修改语言、通道或 Key
                  后请点击应用。纯表情、数字、贴纸和附件不进入文字翻译。
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void pageStatus()
                      .then(setNotice)
                      .catch(error => setNotice(String(error)));
                  }}
                >
                  检查页面识别
                </button>
                {diagnostics && (
                  <button
                    type="button"
                    onClick={() => {
                      clipboard.writeText(diagnostics);
                      setNotice('页面诊断已复制（不包含消息、号码和 API Key）');
                    }}
                  >
                    复制页面诊断
                  </button>
                )}
                <p className="tools-info">
                  第一次发送仅替换为译文；请校正后再次发送。翻译失败时保留原文，不发送消息。
                </p>
                <p className="tools-muted">
                  手动点击或开启翻译预览后，消息文字将发送至所选第三方翻译服务。仅处理当前可见聊天的文字，向上查看历史时按需处理。
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
  const [groupMode, setGroupMode] = useState<GroupMode>();
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => startTranslations(stores), [stores]);
  const customers = getCustomerRuntime(stores);
  useEffect(() => {
    customers.start();
    return () => customers.dispose();
  }, [customers]);
  const { active } = stores.services;
  const service = active?.recipe.id === 'whatsapp' ? active : undefined;
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <aside
      className="account-tools"
      aria-label="账号工具"
      onKeyDown={event => {
        // Esc dismisses the inspector panel, as in native apps. Fields keep
        // their own Esc behaviour (e.g. cancelling an IME composition).
        if (
          event.key === 'Escape' &&
          panel &&
          !event.nativeEvent.isComposing &&
          !event.defaultPrevented
        ) {
          event.preventDefault();
          setPanel('');
        }
      }}
    >
      {panel === 'customer' && (
        <CustomerPanel
          runtime={customers}
          activeId={service?.id}
          onClose={() => setPanel('')}
        />
      )}
      {panel && panel !== 'customer' && (
        <SettingsPanel
          key={`${service?.id}-${panel}`}
          service={service}
          panel={panel}
          textColor={stores.settings.app.translationTextColor}
        />
      )}
      {/* Frequent tools stay on the rail; occasional ones live under 更多. */}
      <nav className="account-tools-rail" aria-label="账号工具栏">
        {(
          [
            ['customer', '客户', '客户资料', mdiCardAccountDetailsOutline],
            ['translation', '翻译', '收发翻译', mdiTranslate],
          ] as const
        ).map(([id, label, title, icon]) => (
          <button
            type="button"
            key={id}
            title={title}
            aria-pressed={panel === id}
            onClick={() => setPanel(panel === id ? '' : id)}
          >
            <RailIcon path={icon} />
            <span>{label}</span>
          </button>
        ))}
        <button
          type="button"
          title="批量发送"
          aria-haspopup="dialog"
          onClick={() => setBulk(true)}
        >
          <RailIcon path={mdiSendOutline} />
          <span>群发</span>
        </button>
        <button
          type="button"
          title="代理、群组管理、批量进群和退群"
          aria-haspopup="menu"
          aria-expanded={Boolean(moreAnchor)}
          aria-pressed={panel === 'proxy' || Boolean(groupMode)}
          onClick={event => setMoreAnchor(event.currentTarget)}
        >
          <RailIcon path={mdiDotsHorizontalCircleOutline} />
          <span>更多</span>
        </button>
      </nav>
      <Menu
        anchorEl={moreAnchor}
        open={Boolean(moreAnchor)}
        onClose={() => setMoreAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        className="account-context-menu account-tools-more-menu"
      >
        <MenuItem
          selected={panel === 'proxy'}
          onClick={() => {
            setMoreAnchor(null);
            setPanel(panel === 'proxy' ? '' : 'proxy');
          }}
        >
          <RailIcon path={mdiShieldLockOutline} />
          <span>账号代理</span>
        </MenuItem>
        <Divider />
        {(
          [
            ['speech', '群组发言管理', mdiAccountGroupOutline],
            ['join', '批量进群', mdiAccountMultiplePlusOutline],
            ['leave', '批量退群', mdiAccountMultipleMinusOutline],
          ] as const
        ).map(([mode, label, icon]) => (
          <MenuItem
            key={mode}
            onClick={() => {
              setMoreAnchor(null);
              setGroupMode(mode);
            }}
          >
            <RailIcon path={icon} />
            <span>{label}</span>
          </MenuItem>
        ))}
      </Menu>
      {groupMode && (
        <GroupTools
          stores={stores}
          mode={groupMode}
          onClose={() => setGroupMode(undefined)}
        />
      )}
      {bulk && <BulkSend stores={stores} onClose={() => setBulk(false)} />}
      <CustomerRemarkDialog runtime={customers} />
    </aside>
  );
});
export default AccountTools;
