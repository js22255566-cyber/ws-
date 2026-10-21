/* eslint-disable no-void -- UI operations catch and display their asynchronous errors. */
import { ipcRenderer } from 'electron';
import { observer } from 'mobx-react';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import type { RealStores } from '../../stores';
import { type Recipient, type SendRecord } from './config';
import { listRecipients, sendTextToChat } from './guest';

const BulkSend = observer(
  ({ stores, onClose }: { stores: RealStores; onClose: () => void }) => {
    const [creating, setCreating] = useState(false);
    const [accounts, setAccounts] = useState<string[]>([]);
    const [recipients, setRecipients] = useState<Recipient[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [kind, setKind] = useState('all');
    const [search, setSearch] = useState('');
    const [text, setText] = useState('');
    const [notice, setNotice] = useState('');
    const [records, setRecords] = useState<SendRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const stop = useRef(false);
    const sending = useRef(false);
    const online = stores.services.all.filter(
      s =>
        s.recipe.id === 'whatsapp' &&
        s.isEnabled &&
        !s.isHibernating &&
        s.accountSnapshot.status === 'online' &&
        s.webview,
    );
    useEffect(() => {
      void ipcRenderer
        .invoke('account-tools-history')
        .then(setRecords)
        .catch(() => setNotice('发送记录读取失败'));
    }, []);
    const key = (r: Recipient) => `${r.accountId}:${r.id}`;
    const eligible = recipients.filter(r => accounts.includes(r.accountId));
    const visible = eligible.filter(
      r =>
        (kind === 'all' || r.group === (kind === 'group')) &&
        `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase()),
    );
    const chosen = eligible.filter(r => selected.includes(key(r)));
    const refresh = async () => {
      setLoading(true);
      setNotice('');
      setRecipients([]);
      setSelected([]);
      try {
        const result = await Promise.all(
          accounts.map(async id => {
            const s = online.find(a => a.id === id);
            if (!s?.webview) throw new Error('账号已离线，请重新选择');
            const items = await s.webview.executeJavaScript(
              `(${listRecipients.toString()})()`,
            );
            return items.map(r => ({ ...r, accountId: id }));
          }),
        );
        setRecipients(result.flat());
      } catch (error) {
        setNotice(String(error));
      } finally {
        setLoading(false);
      }
    };
    const persist = async (record: SendRecord) => {
      setRecords(current =>
        [record, ...current.filter(r => r.id !== record.id)].slice(0, 100),
      );
      await ipcRenderer.invoke('account-tools-history', record);
    };
    const send = async () => {
      if (sending.current || chosen.length === 0 || !text.trim()) return;
      sending.current = true;
      setConfirm(false);
      setRunning(true);
      stop.current = false;
      setNotice('');
      let record: SendRecord = {
        id: crypto.randomUUID(),
        started: new Date().toISOString(),
        text,
        status: '发送中',
        total: chosen.length,
        success: 0,
        failed: 0,
        details: [],
      };
      try {
        await persist(record); // A history write failure must prevent the first send.
        for (const recipient of chosen) {
          if (stop.current) break;
          const service = stores.services.all.find(
            s => s.id === recipient.accountId,
          );
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            if (
              !service?.webview ||
              service.isHibernating ||
              service.accountSnapshot.status !== 'online'
            )
              throw new Error('账号已离线或休眠');
            // Never retry a timed out send: the server may already have accepted it.
            // eslint-disable-next-line no-await-in-loop
            await Promise.race([
              service.webview.executeJavaScript(
                `(${sendTextToChat.toString()})(${JSON.stringify(recipient.id)},${JSON.stringify(text)})`,
              ),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      new Error(
                        '发送结果未确认，请在 WhatsApp 核查；任务已停止',
                      ),
                    ),
                  30_000,
                );
              }),
            ]);
            record = {
              ...record,
              success: record.success + 1,
              details: [
                ...record.details,
                `${service.name} → ${recipient.name}：服务器已接受`,
              ],
            };
          } catch (error) {
            record = {
              ...record,
              failed: record.failed + 1,
              details: [
                ...record.details,
                `${service?.name ?? recipient.accountId} → ${recipient.name}：${String(error)}`,
              ],
            };
            // Stop on any failure so uncertain deliveries cannot silently fan out.
            stop.current = true;
          } finally {
            clearTimeout(timer);
          }
          // eslint-disable-next-line no-await-in-loop
          await persist(record);
          if (!stop.current && record.success + record.failed < record.total) {
            // Deliberate pacing, not a promise to bypass platform restrictions.
            // eslint-disable-next-line no-await-in-loop
            await new Promise(resolve => {
              setTimeout(resolve, 1500);
            });
          }
        }
        record = {
          ...record,
          ended: new Date().toISOString(),
          status: stop.current ? '已停止' : '已完成',
        };
        await persist(record);
        setCreating(false);
      } catch {
        setNotice('无法保存发送记录，任务已停止；请检查已发送内容后再操作');
      } finally {
        sending.current = false;
        setRunning(false);
      }
    };
    return (
      <Dialog
        open
        maxWidth="xl"
        fullWidth
        className="account-tools-dialog bulk-dialog"
        onClose={() => {
          if (!running) onClose();
        }}
      >
        <DialogTitle>
          批量发送{' '}
          <span className="tools-muted">
            {creating ? '新建转发 · 文字消息' : '发送记录'}
          </span>
        </DialogTitle>
        <DialogContent>
          <p className="tools-muted">
            选择已有群聊或私聊，使用指定账号发送自定义文字。群发正文按原样发送；聊天输入框的翻译开关不会改写群发内容。
          </p>
          {creating ? (
            <div className="bulk-columns">
              <fieldset disabled={running || loading}>
                <h3>选择账号</h3>
                <p className="tools-muted">仅显示已连接且未休眠的账号</p>
                {online.length === 0 && (
                  <p>暂无在线账号，请先登录 WhatsApp。</p>
                )}
                {online.map(s => (
                  <label
                    htmlFor={`bulk-account-${s.id}`}
                    className="tools-check"
                    key={s.id}
                  >
                    <input
                      id={`bulk-account-${s.id}`}
                      type="checkbox"
                      checked={accounts.includes(s.id)}
                      onChange={e => {
                        setAccounts(a =>
                          e.target.checked
                            ? [...a, s.id]
                            : a.filter(id => id !== s.id),
                        );
                        setRecipients([]);
                        setSelected([]);
                      }}
                    />
                    <span>
                      {s.accountSnapshot.nickname || s.name}
                      <small>
                        {s.accountSnapshot.phone || '未读取到手机号'}
                      </small>
                    </span>
                  </label>
                ))}
                <button
                  type="button"
                  disabled={accounts.length === 0}
                  onClick={() => void refresh()}
                >
                  {loading ? '读取中…' : '读取聊天对象'}
                </button>
              </fieldset>
              <fieldset disabled={running || loading}>
                <h3>选择发送对象（{chosen.length}）</h3>
                <input
                  aria-label="搜索聊天对象"
                  placeholder="搜索名称或 ID"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <select
                  aria-label="聊天类型"
                  value={kind}
                  onChange={e => setKind(e.target.value)}
                >
                  <option value="all">全部</option>
                  <option value="group">群聊</option>
                  <option value="private">私聊</option>
                </select>
                <label htmlFor="zl-BulkSend-2" className="tools-check">
                  <input
                    id="zl-BulkSend-2"
                    type="checkbox"
                    checked={
                      visible.length > 0 &&
                      visible.every(r => selected.includes(key(r)))
                    }
                    onChange={e =>
                      setSelected(current =>
                        e.target.checked
                          ? [
                              ...new Set([
                                ...current,
                                ...visible.map(r => key(r)),
                              ]),
                            ]
                          : current.filter(
                              id => !visible.some(r => key(r) === id),
                            ),
                      )
                    }
                  />
                  全选当前列表（{visible.length}）
                </label>
                <div className="bulk-recipient-list">
                  {visible.map(r => (
                    <label
                      htmlFor={`bulk-recipient-${key(r)}`}
                      className="tools-check"
                      key={key(r)}
                    >
                      <input
                        id={`bulk-recipient-${key(r)}`}
                        type="checkbox"
                        checked={selected.includes(key(r))}
                        onChange={e =>
                          setSelected(current =>
                            e.target.checked
                              ? [...current, key(r)]
                              : current.filter(id => id !== key(r)),
                          )
                        }
                      />
                      <span>
                        {r.name}
                        <small>
                          {r.group ? '群聊' : '私聊'} ·{' '}
                          {
                            stores.services.all.find(s => s.id === r.accountId)
                              ?.name
                          }
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                {eligible.length === 0 && (
                  <p className="tools-muted">
                    选择账号后点击「读取聊天对象」。只读取该账号已加载的聊天。
                  </p>
                )}
              </fieldset>
              <fieldset disabled={running}>
                <h3>发送内容</h3>
                <textarea
                  aria-label="发送内容"
                  rows={9}
                  maxLength={12_000}
                  placeholder="请输入自定义文字"
                  value={text}
                  onChange={e => setText(e.target.value)}
                />
                <p className="tools-muted">
                  {text.length}/12000 · 发送间隔 1.5 秒 · 失败时停止
                </p>
                <p>
                  将通过 {accounts.length} 个账号向 {chosen.length} 个聊天发送。
                </p>
                <p className="tools-muted">
                  此窗口不会绕过 WhatsApp 限制。仅向有权联系的对象发送。
                </p>
              </fieldset>
            </div>
          ) : (
            <div className="bulk-history">
              <button
                type="button"
                className="tools-primary"
                onClick={() => setCreating(true)}
              >
                新建转发
              </button>
              {records.length === 0 && <p>暂无发送记录</p>}
              {records.map(r => (
                <article key={r.id}>
                  <p className="bulk-record-text">{r.text}</p>
                  <p>
                    {r.status === '发送中' && !running
                      ? '已中断（应用关闭或重载）'
                      : r.status}{' '}
                    · 成功 {r.success} / 未确认或失败 {r.failed} / 共 {r.total}
                  </p>
                  <progress value={r.success + r.failed} max={r.total} />
                  <small>{new Date(r.started).toLocaleString()}</small>
                  <details>
                    <summary>详情</summary>
                    {r.details.map(d => (
                      <p key={d}>{d}</p>
                    ))}
                  </details>
                </article>
              ))}
            </div>
          )}
          {running && (
            <p role="status">
              正在发送：成功 {records[0]?.success ?? 0} / 共{' '}
              {records[0]?.total ?? 0}；停止会等待当前一条返回。
            </p>
          )}
          <p role="status" className="tools-notice">
            {notice}
          </p>
        </DialogContent>
        <DialogActions>
          {running ? (
            <Button
              onClick={() => {
                stop.current = true;
                setNotice('已请求停止，正在等待当前发送结果');
              }}
            >
              停止发送
            </Button>
          ) : (
            <>
              <Button onClick={onClose}>关闭</Button>
              {creating && (
                <>
                  <Button onClick={() => setCreating(false)}>返回记录</Button>
                  <Button
                    variant="contained"
                    disabled={chosen.length === 0 || !text.trim() || loading}
                    onClick={() => setConfirm(true)}
                  >
                    检查并发送
                  </Button>
                </>
              )}
            </>
          )}
        </DialogActions>
        <Dialog
          open={confirm}
          className="account-tools-dialog"
          onClose={() => setConfirm(false)}
        >
          <DialogTitle>确认发送</DialogTitle>
          <DialogContent>
            将通过 {accounts.length} 个账号向 {chosen.length}{' '}
            个群聊或私聊发送以下文字：<p className="bulk-record-text">{text}</p>
            此操作会实际发送 WhatsApp 消息。
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(false)}>返回修改</Button>
            <Button variant="contained" onClick={() => void send()}>
              确认发送
            </Button>
          </DialogActions>
        </Dialog>
      </Dialog>
    );
  },
);
export default BulkSend;
