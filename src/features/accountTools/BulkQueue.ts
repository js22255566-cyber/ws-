/* eslint-disable no-void -- Background scheduler failures are reported through queue state. */
/* eslint-disable no-continue -- Skip deliveries already revoked, preserving stable message IDs. */
import type {
  BulkSpec,
  Recipient,
  SendRecord,
  BulkDelivery,
  BulkSendOutcome,
} from './config';

export interface BulkAdapter {
  load: () => Promise<SendRecord[]>;
  save: (record: SendRecord) => Promise<void>;
  remove: (ids: string[]) => Promise<SendRecord[]>;
  send: (
    target: Recipient,
    spec: BulkSpec,
  ) => Promise<string | BulkSendOutcome>;
  revoke: (target: Recipient, messageId: string) => Promise<void>;
}
export function validateBulkSpec(spec: BulkSpec) {
  if (spec.targets.length === 0 || spec.targets.length > 10_000)
    throw new Error('请选择 1–10000 个发送对象');
  if (
    new Set(spec.targets.map(r => `${r.accountId}:${r.id}`)).size !==
    spec.targets.length
  )
    throw new Error('发送对象重复');
  if (spec.type === 'text' && !spec.text.trim())
    throw new Error('请输入发送文字');
  if (spec.text.length > 12_000) throw new Error('文字不可超过 12000 字符');
  if (!['text', 'contact'].includes(spec.type) && !spec.media)
    throw new Error('请选择附件');
  if (spec.type === 'caption' && !spec.text.trim())
    throw new Error('请输入图片说明文字');
  if (
    spec.type === 'contact' &&
    (!spec.contactName?.trim() || !/^\d{7,15}$/.test(spec.contactPhone ?? ''))
  )
    throw new Error('请输入名片名称和含国家区号的 7–15 位手机号码');
  if (
    ![spec.intervalMin, spec.intervalMax, spec.typingSeconds].every(value =>
      Number.isFinite(value),
    ) ||
    spec.intervalMin < 0.5 ||
    spec.intervalMax > 3600 ||
    spec.intervalMax < spec.intervalMin ||
    spec.typingSeconds < 0 ||
    spec.typingSeconds > 30
  )
    throw new Error('间隔应为 0.5–3600 秒，输入状态应为 0–30 秒');
  if (
    spec.mentionAll &&
    !['text', 'caption', 'video', 'document'].includes(spec.type)
  )
    throw new Error('当前消息类型不支持 @所有人，请选择文本或含说明的附件');
  if (
    spec.scheduledAt &&
    (!Number.isFinite(Date.parse(spec.scheduledAt)) ||
      Date.parse(spec.scheduledAt) <= Date.now())
  )
    throw new Error('请选择未来的发送时间');
}

export default class BulkQueue {
  records: SendRecord[] = [];

  activeId = '';

  activeOperation: 'send' | 'revoke' = 'send';

  error = '';

  listeners = new Set<() => void>();

  private stopped = new Set<string>();

  private timer?: ReturnType<typeof setInterval>;

  private ready?: Promise<void>;

  private submitting = false;

  constructor(private adapter: BulkAdapter) {}

  notify() {
    for (const fn of this.listeners) fn();
  }

  async load() {
    this.ready ??= (async () => {
      this.records = await this.adapter.load();
      for (const old of this.records) {
        if (
          old.status === '发送中' ||
          (old.status === '待发送' &&
            Date.parse(old.spec?.scheduledAt ?? '') <= Date.now())
        ) {
          // Never replay an uncertain delivery or silently catch up a missed timer.
          // eslint-disable-next-line no-await-in-loop
          await this.persist({
            ...old,
            status: old.status === '发送中' ? '已中断' : '已错过',
            ended: new Date().toISOString(),
          });
        }
      }
      this.notify();
    })();
    return this.ready;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(error => {
        this.error = String(error);
        this.notify();
      });
    }, 1000);
    void this.load().catch(error => {
      this.error = String(error);
      this.notify();
    });
  }

  dispose() {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.activeId) this.stopped.add(this.activeId);
  }

  async persist(record: SendRecord) {
    this.records = [
      record,
      ...this.records.filter(r => r.id !== record.id),
    ].slice(0, 100);
    this.notify();
    await this.adapter.save(record);
  }

  async submit(spec: BulkSpec) {
    validateBulkSpec(spec);
    await this.load();
    if (this.activeId || this.submitting)
      throw new Error('已有任务在执行，请等待完成或停止');
    this.submitting = true;
    try {
      if (this.records.length >= 100)
        throw new Error('记录已满，请先清理完成的任务');
      const record: SendRecord = {
        id: crypto.randomUUID(),
        started: new Date().toISOString(),
        text: spec.text || spec.media?.name || spec.contactName || '',
        status: spec.scheduledAt ? '待发送' : '发送中',
        total: spec.targets.length,
        success: 0,
        failed: 0,
        details: [],
        deliveries: [],
        spec: structuredClone(spec),
      };
      this.error = '';
      // Persist before any WhatsApp operation, including the first message.
      await this.persist(record);
      if (!spec.scheduledAt) await this.run(record);
    } finally {
      this.submitting = false;
    }
  }

  async tick() {
    await this.load();
    if (this.activeId || this.submitting) return;
    const due = this.records.find(
      r =>
        r.status === '待发送' &&
        Date.parse(r.spec?.scheduledAt ?? '') <= Date.now(),
    );
    if (due) await this.run(due);
  }

  async stop(id: string) {
    this.stopped.add(id);
    const record = this.records.find(r => r.id === id);
    if (record?.status === '待发送')
      await this.persist({
        ...record,
        status: '已取消',
        ended: new Date().toISOString(),
      });
  }

  async remove(ids: string[]) {
    if (
      ids.some(
        id =>
          id === this.activeId ||
          this.records.find(r => r.id === id)?.status === '待发送',
      )
    )
      throw new Error('请先停止或取消任务，再删除记录');
    this.records = await this.adapter.remove(ids);
    this.notify();
  }

  private async run(initial: SendRecord) {
    if (this.activeId || !initial.spec) return;
    this.activeId = initial.id;
    this.activeOperation = 'send';
    let record = { ...initial, status: '发送中' };
    const { spec } = initial;
    try {
      await this.persist(record);
      for (const target of spec.targets) {
        if (this.stopped.has(record.id)) break;
        let delivery: BulkDelivery = { target, status: 'sending' };
        record = {
          ...record,
          deliveries: [...(record.deliveries ?? []), delivery],
        };
        // A crash after this checkpoint makes the task interrupted, never retried.
        // eslint-disable-next-line no-await-in-loop
        await this.persist(record);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let uncertain = false;
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await Promise.race([
            this.adapter.send(target, spec),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                uncertain = true;
                reject(new Error('发送超时，结果未确认，请在 WhatsApp 核查'));
              }, 120_000);
            }),
          ]);
          const confirmed = typeof result === 'string' || result.confirmed;
          delivery = {
            ...delivery,
            status: confirmed ? 'sent' : 'uncertain',
            messageId: typeof result === 'string' ? result : result.messageId,
            error: confirmed
              ? undefined
              : '未确认服务器接受，请在 WhatsApp 核查',
          };
          record = {
            ...record,
            success: record.success + (confirmed ? 1 : 0),
            failed: record.failed + (confirmed ? 0 : 1),
          };
          if (!confirmed) this.stopped.add(record.id);
        } catch (error) {
          delivery = {
            ...delivery,
            status: uncertain ? 'uncertain' : 'failed',
            error: String(error),
          };
          record = { ...record, failed: record.failed + 1 };
          if (uncertain || spec.failure === 'stop') this.stopped.add(record.id);
        } finally {
          clearTimeout(timeout);
        }
        record = {
          ...record,
          deliveries: [...record.deliveries!.slice(0, -1), delivery],
          details: [
            ...record.details,
            `${target.name}：${delivery.status === 'sent' ? '服务器已接受' : delivery.error}`,
          ],
        };
        // eslint-disable-next-line no-await-in-loop
        await this.persist(record);
        const delay =
          (spec.intervalMin +
            Math.random() * (spec.intervalMax - spec.intervalMin)) *
          1000;
        const until = Date.now() + delay;
        // Short waits let cancellation stop the remaining queue promptly.
        while (
          !this.stopped.has(record.id) &&
          record.success + record.failed < record.total &&
          Date.now() < until
        ) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise(resolve => {
            setTimeout(resolve, Math.min(100, until - Date.now()));
          });
        }
      }
      await this.persist({
        ...record,
        status: this.stopped.has(record.id)
          ? '已停止'
          : record.failed
            ? '部分失败'
            : '已完成',
        ended: new Date().toISOString(),
      });
    } catch {
      this.error =
        '无法保存任务状态，任务已停止。请检查 WhatsApp 中已发消息，勿直接重发。';
      this.records = this.records.map(r =>
        r.id === record.id ? { ...record, status: '已中断' } : r,
      );
    } finally {
      this.activeId = '';
      this.stopped.delete(record.id);
      this.notify();
    }
  }

  async revoke(id: string, targets?: string[]) {
    if (this.activeId || this.submitting)
      throw new Error('请先等待当前任务结束');
    let record = this.records.find(r => r.id === id);
    if (!record?.deliveries?.some(d => d.messageId && !d.revoked))
      throw new Error('没有可撤回的消息编号，旧版记录不支持撤回');
    this.activeId = id;
    this.activeOperation = 'revoke';
    this.notify();
    try {
      record = {
        ...record,
        revokeStarted: new Date().toISOString(),
        revokeEnded: undefined,
      };
      await this.persist(record);
      for (let i = 0; i < record.deliveries!.length; i += 1) {
        if (this.stopped.has(id)) break;
        const delivery = record.deliveries![i];
        if (
          targets &&
          !targets.includes(
            `${delivery.target.accountId}:${delivery.target.id}`,
          )
        )
          continue;
        if (!delivery.messageId || delivery.revoked) continue;
        let updated: BulkDelivery;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          // eslint-disable-next-line no-await-in-loop
          await Promise.race([
            this.adapter.revoke(delivery.target, delivery.messageId),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                this.stopped.add(id);
                reject(new Error('撤回结果超时未确认，请在 WhatsApp 核查'));
              }, 45_000);
            }),
          ]);
          updated = {
            ...delivery,
            revoked: true,
            revokedAt: new Date().toISOString(),
            revokeError: undefined,
          };
        } catch (error) {
          updated = { ...delivery, revokeError: String(error) };
        } finally {
          clearTimeout(timeout);
        }
        record = {
          ...record,
          deliveries: record.deliveries!.map((d, index) =>
            index === i ? updated : d,
          ),
        };
        // eslint-disable-next-line no-await-in-loop
        await this.persist(record);
      }
      await this.persist({ ...record, revokeEnded: new Date().toISOString() });
    } finally {
      this.activeId = '';
      this.stopped.delete(id);
      this.notify();
    }
  }
}
