// ZL-WA per-account tools. These settings never contain a persisted plaintext password.
export interface ProxyConfig {
  enabled: boolean;
  mode: 'direct' | 'system' | 'manual';
  protocol: 'http' | 'https' | 'socks5';
  host: string;
  port: string;
  username: string;
  password?: string;
  hasPassword?: boolean;
}
export const translationEngines = [
  'Google',
  'DeepL',
  'OpenAI',
  'Gemini',
  'LibreTranslate',
] as const;
export type TranslationEngine = (typeof translationEngines)[number];
export interface ProviderCredential {
  apiKey?: string;
  hasApiKey?: boolean;
  model?: string;
}
export interface TranslationConfig {
  outgoing: boolean;
  incoming: boolean;
  engine: TranslationEngine;
  receiveEngine: TranslationEngine;
  receiveSource: string;
  source: string;
  sendTarget: string;
  receiveTarget: string;
}
export interface ToolsConfig {
  proxy: ProxyConfig;
  translation: TranslationConfig;
  providers?: Partial<Record<TranslationEngine, ProviderCredential>>;
}
export const defaultTools = (): ToolsConfig => ({
  proxy: {
    enabled: false,
    mode: 'manual',
    protocol: 'http',
    host: '',
    port: '',
    username: '',
  },
  translation: {
    outgoing: false,
    incoming: false,
    engine: 'Google',
    receiveEngine: 'Google',
    receiveSource: 'auto',
    source: 'auto',
    sendTarget: 'en',
    receiveTarget: 'zh-CN',
  },
});
export function proxyRules(proxy: ProxyConfig): Electron.ProxyConfig {
  if (!proxy.enabled || proxy.mode === 'direct') return { mode: 'direct' };
  if (proxy.mode === 'system') return { mode: 'system' };
  if (
    !['http', 'https', 'socks5'].includes(proxy.protocol) ||
    !/^(?:[\d.a-z-]+|\[[\d:a-f]+])$/i.test(proxy.host) ||
    !/^\d+$/.test(proxy.port) ||
    Number(proxy.port) < 1 ||
    Number(proxy.port) > 65_535
  )
    throw new Error('请输入有效的代理主机和端口（1–65535）');
  return {
    mode: 'fixed_servers',
    proxyRules: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
    proxyBypassRules: '<-loopback>',
  };
}
export function parseProxy(text: string): Partial<ProxyConfig> {
  const line = text.trim();
  if (line.includes('://')) {
    const url = new URL(line);
    const protocol = url.protocol.replace(':', '');
    if (!['http', 'https', 'socks5'].includes(protocol))
      throw new Error('不支持的代理协议');
    return {
      protocol: protocol as ProxyConfig['protocol'],
      host: url.hostname,
      port:
        url.port ||
        (protocol === 'http' ? '80' : protocol === 'https' ? '443' : '1080'),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  }
  const match = /^(\[[\d:a-f]+]|[^\s:]+):(\d+)(?::([^:]*):(.*))?$/i.exec(line);
  if (!match) throw new Error('格式：主机:端口 或 主机:端口:用户名:密码');
  return {
    host: match[1],
    port: match[2],
    username: match[3] ?? '',
    password: match[4] ?? '',
  };
}
export interface Recipient {
  id: string;
  name: string;
  group: boolean;
  accountId: string;
}
export interface SendRecord {
  id: string;
  started: string;
  ended?: string;
  text: string;
  status: string;
  total: number;
  success: number;
  failed: number;
  details: string[];
}
