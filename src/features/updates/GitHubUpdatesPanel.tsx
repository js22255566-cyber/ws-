/* eslint-disable no-void -- Locally displayed errors handle asynchronous UI actions. */
import { ipcRenderer } from 'electron';
import { useEffect, useState } from 'react';
import { ferdiumVersion } from '../../environment-remote';
import { RELEASES_URL, UPDATE_REPOSITORY, type UpdateState } from './config';

export default function GitHubUpdatesPanel() {
  const [state, setState] = useState<UpdateState>({});
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let mounted = true;
    const listener = (_: unknown, value: UpdateState) => {
      if (mounted) setState(value);
    };
    ipcRenderer.on('autoUpdate', listener);
    void ipcRenderer
      .invoke('zl-updates-state')
      .then(value => {
        if (mounted) setState(value);
      })
      .catch(() => {});
    void ipcRenderer
      .invoke('zl-updates-config')
      .then(value => {
        if (mounted) setHasToken(value.hasToken);
      })
      .catch(() => {
        if (mounted) setNotice('无法读取更新访问设置，请重新保存 Token');
      });
    return () => {
      mounted = false;
      ipcRenderer.removeListener('autoUpdate', listener);
    };
  }, []);
  const save = async (value: string | null) => {
    setSaving(true);
    setNotice('');
    try {
      const config = await ipcRenderer.invoke('zl-updates-token', value);
      setHasToken(config.hasToken);
      setToken('');
      setNotice(
        value === null
          ? '已清除 GitHub Token'
          : 'GitHub Token 已加密保存在本机',
      );
    } catch {
      setNotice('保存失败，请检查 Token 格式或系统安全存储是否可用');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="zl-updates" aria-label="ZL-WA GitHub 更新">
      <p>
        当前版本：<strong>{ferdiumVersion}</strong>
      </p>
      <p>
        更新来源：
        <a href={RELEASES_URL} target="_blank" rel="noreferrer">
          {UPDATE_REPOSITORY} / Releases
        </a>
      </p>
      <div className="zl-updates-buttons">
        <button
          type="button"
          disabled={state.checking}
          onClick={async () => {
            setState({ checking: true });
            try {
              setState(await ipcRenderer.invoke('zl-updates-check'));
            } catch {
              setState({ error: { message: '无法检查更新，请稍后重试' } });
            }
          }}
        >
          {state.checking ? '正在检查…' : '检查更新'}
        </button>
        <a href={RELEASES_URL} target="_blank" rel="noreferrer">
          打开 GitHub 发布页
        </a>
      </div>
      <div role="status" aria-live="polite">
        {state.checking
          ? '正在读取 ZL-WA 的 GitHub 版本…'
          : state.error
            ? state.error.message
            : state.available
              ? `发现新版本 ${state.version}`
              : state.available === false
                ? '你使用的 ZL-WA 已是当前更新通道的最新版本。'
                : '发布新版本后，会在这里和软件主界面提示更新。'}
      </div>
      {state.available && (
        <button
          type="button"
          onClick={() =>
            void ipcRenderer
              .invoke('zl-updates-open')
              .catch(() =>
                setNotice('无法打开浏览器，请点击 GitHub 发布页链接'),
              )
          }
        >
          前往 GitHub 下载 {state.version}
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      <p className="zl-updates-help">
        开启自动更新后，启动约 30 秒及之后每 4
        小时检查一次。发现新版会提示，不会自动关闭软件。关闭自动更新后仍可手动检查。便携版同样支持检查。
      </p>
      <details>
        <summary>私有仓库访问设置（GitHub Token）</summary>
        <p>
          公开仓库无需配置。私有仓库需要你自己的 GitHub
          账号有访问权限，并填写仅授予此仓库 Contents 只读权限的 Token。Token
          仅加密保存在本机，不会内置开发者凭据。
        </p>
        <label htmlFor="github-update-token">
          GitHub Token（{hasToken ? '已保存，留空保留' : '未配置'}）
        </label>
        <input
          id="github-update-token"
          type="password"
          autoComplete="new-password"
          maxLength={500}
          value={token}
          onChange={e => setToken(e.target.value)}
        />
        <div className="zl-updates-buttons">
          <button
            type="button"
            disabled={saving || !token.trim()}
            onClick={() => void save(token.trim())}
          >
            保存 Token
          </button>
          <button
            type="button"
            disabled={saving || !hasToken}
            onClick={() => void save(null)}
          >
            清除 Token
          </button>
        </div>
      </details>
    </section>
  );
}
