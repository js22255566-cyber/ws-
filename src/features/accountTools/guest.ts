/* eslint-disable no-continue -- Skip unsupported or already translated message nodes. */
/* eslint-disable unicorn/prefer-dom-node-text-content -- innerText preserves contenteditable line breaks. */
/* eslint-disable sonar/deprecation -- execCommand is required to update WhatsApp's editor undo/input state. */
// Self-contained guest functions; do not import host objects or expose host IPC.
import type { Recipient, TranslationConfig } from './config';

export interface TranslationRequest {
  id: number;
  token: string;
  text: string;
  direction: 'incoming' | 'outgoing';
}
export function translationTick(
  config: TranslationConfig,
  drain = true,
): TranslationRequest[] {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return [];
  const page = window as any;
  if (!page.__zlTranslation) {
    const state: any = {
      queue: [],
      pending: new Map(),
      sequence: 0,
      token: crypto.randomUUID(),
      approved: null,
      busy: false,
      config,
      incoming: new WeakMap(),
      activeChat: '',
    };
    page.__zlTranslation = state;
    const composer = () =>
      document.querySelector<HTMLElement>(
        '#main footer [contenteditable="true"][role="textbox"], #main footer [contenteditable="true"][data-lexical-editor="true"]',
      );
    const chatKey = () => {
      try {
        const chat = page.require('WAWebChatGetters').getActiveChat?.();
        if (chat?.id) return chat.id._serialized;
      } catch {
        /* Fall back to chat identity in the header. */
      }
      const messageId = document
        .querySelector('#main [data-id]')
        ?.getAttribute('data-id');
      const match = messageId?.match(/(?:true|false)_([^_]+)_/);
      if (match) return match[1];
      return (
        document
          .querySelector('#main header [data-id]')
          ?.getAttribute('data-id') ||
        document.querySelector('#main header [title]')?.getAttribute('title') ||
        ''
      );
    };
    const notice = (text: string) => {
      let n = document.querySelector<HTMLElement>('#zl-translation-status');
      if (!n) {
        n = document.createElement('div');
        n.id = 'zl-translation-status';
        n.style.cssText =
          'position:fixed;bottom:86px;left:25%;max-width:65%;z-index:9999;padding:8px 14px;background:#17395e;color:white;border-radius:8px;pointer-events:none;height:auto;font:14px sans-serif';
        document.body.append(n);
      }
      n.textContent = text;
    };
    state.notice = notice;
    state.composer = composer;
    state.chatKey = chatKey;
    const intercept = (event: Event) => {
      if (!state.config.outgoing) return;
      const input = composer();
      if (!input) return;
      const key = event as KeyboardEvent;
      const sendKey =
        event.type === 'keydown' &&
        key.key === 'Enter' &&
        !key.shiftKey &&
        !key.isComposing;
      const target = event.target as Element;
      const sendClick =
        event.type === 'click' &&
        Boolean(
          target?.closest(
            '#main footer button[aria-label="Send"], #main footer button[aria-label="发送"], #main footer [data-icon="send"], #main footer [data-icon="wds-ic-send-filled"], #main footer [data-testid="compose-btn-send"]',
          ) ||
            target
              ?.closest('#main footer button')
              ?.querySelector(
                '[data-icon="send"], [data-icon="wds-ic-send-filled"], [data-icon="send-filled"]',
              ),
        );
      if (
        !(sendKey && (target === input || input.contains(target))) &&
        !sendClick
      )
        return;
      if (
        key.repeat ||
        (event.type === 'click' && (event as MouseEvent).detail > 1)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const text = input.innerText;
      if (!text.trim()) return;
      // Approval belongs to this composer and chat, and survives deliberate corrections.
      if (
        state.approved?.input === input &&
        state.approved.chat === chatKey() &&
        !state.busy
      ) {
        state.approved = null;
        notice('');
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (state.busy) {
        notice('正在翻译，请等待；消息尚未发送');
        return;
      }
      if (text.length > 12_000) {
        notice('文本超过 12000 字符，消息尚未发送');
        return;
      }
      state.sequence += 1;
      const id = state.sequence;
      state.busy = true;
      state.pending.set(id, {
        input,
        text,
        chat: chatKey(),
        direction: 'outgoing',
      });
      state.queue.unshift({
        id,
        token: state.token,
        text,
        direction: 'outgoing',
      });
      notice('正在翻译，消息尚未发送…');
    };
    window.addEventListener('keydown', intercept, true);
    window.addEventListener('click', intercept, true);
    document.addEventListener(
      'input',
      () => {
        if (!composer()?.innerText.trim()) state.approved = null;
      },
      true,
    );
    // Changing chats invalidates an approved composer, even if React reuses its node.
    state.observer = new MutationObserver(() => {
      const next = chatKey();
      if (next !== state.activeChat) {
        if (state.approved || state.busy)
          notice('聊天已切换，消息未发送；请重新翻译');
        state.approved = null;
        for (const [id, job] of state.pending) {
          if (job.direction === 'outgoing') state.pending.delete(id);
        }
        state.busy = false;
        state.queue = state.queue.filter(job => job.direction !== 'outgoing');
        state.activeChat = next;
      }
    });
    state.activeChat = chatKey();
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title', 'data-id'],
    });
  }
  const state = page.__zlTranslation;
  if (JSON.stringify(state.config) !== JSON.stringify(config)) {
    state.approved = null;
    state.pending.clear();
    state.queue = [];
    state.busy = false;
    state.incoming = new WeakMap();
    document.querySelectorAll('[data-zl-translation]').forEach(n => n.remove());
    state.notice('');
  }
  state.config = config;
  if (config.incoming) {
    // Only mounted incoming text bubbles. Never read outgoing messages, quoted text or the contact sidebar.
    for (const bubble of document.querySelectorAll<HTMLElement>(
      '#main .message-in',
    )) {
      const textNode = bubble.querySelector<HTMLElement>(
        '.copyable-text .selectable-text, [data-testid="msg-text"], [data-testid="selectable-text"]',
      );
      if (!textNode) continue;
      const text = textNode.innerText;
      if (
        !text.trim() ||
        text.length > 12_000 ||
        state.incoming.get(textNode) === text ||
        state.pending.size >= 12
      )
        continue;
      state.incoming.set(textNode, text);
      state.sequence += 1;
      const id = state.sequence;
      state.pending.set(id, {
        direction: 'incoming',
        input: textNode,
        text,
        bubble,
      });
      state.queue.push({ id, token: state.token, text, direction: 'incoming' });
    }
  } else
    document.querySelectorAll('[data-zl-translation]').forEach(n => n.remove());
  return drain ? state.queue.splice(0, 4) : [];
}

export function translationResult(
  id: number,
  token: string,
  result: { text: string; error: boolean; message?: string },
): void {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return;
  const state = (window as any).__zlTranslation;
  if (state?.token !== token) return;
  const job = state?.pending.get(id);
  if (!job) return;
  state.pending.delete(id);
  if (job.direction === 'outgoing') {
    state.busy = false;
    if (
      !job.input.isConnected ||
      state.composer() !== job.input ||
      state.chatKey() !== job.chat ||
      job.input.innerText !== job.text
    ) {
      state.notice('输入内容或聊天已变化，本次译文已丢弃；消息尚未发送');
      return;
    }
    if (result.error || !result.text?.trim()) {
      state.notice(`${result.message || '翻译失败'}；原文未发送，请重试`);
      return;
    }
    job.input.focus();
    document.getSelection()?.selectAllChildren(job.input);
    const replaced = document.execCommand('insertText', false, result.text);
    if (!replaced || job.input.innerText.trim() !== result.text.trim()) {
      state.notice('无法替换输入框，消息未发送，请重试');
      return;
    }
    state.approved = { input: job.input, chat: job.chat };
    state.notice('译文已填入：请校正后再次发送');
  } else if (
    state.config.incoming &&
    job.input.isConnected &&
    job.input.innerText === job.text
  ) {
    job.bubble.querySelector('[data-zl-translation]')?.remove();
    const label = document.createElement('div');
    label.dataset.zlTranslation = 'true';
    label.style.cssText =
      'height:auto;color:#77baff;font-size:13px;padding:6px 0;white-space:pre-wrap';
    label.textContent = result.error
      ? `${result.message || '翻译失败'}（切换翻译开关可重试）`
      : result.text;
    job.bubble.append(label);
  }
}

export function listRecipients(): Omit<Recipient, 'accountId'>[] {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const page = window as any;
  const collection = page.require?.('WAWebCollections')?.Chat;
  const chats = collection?.getModelsArray?.() ?? collection?.models;
  if (!Array.isArray(chats))
    throw new Error('聊天列表尚未就绪，或 WhatsApp 网页接口已变化');
  return chats
    .filter(
      c =>
        c.id &&
        !c.isReadOnly &&
        !c.isPSA &&
        ['g.us', 'c.us', 'lid'].includes(c.id.server),
    )
    .map(c => ({
      id: c.id._serialized,
      name: String(
        c.formattedTitle || c.name || c.contact?.pushname || c.id.user,
      ),
      group: c.id.server === 'g.us',
    }));
}

export async function sendTextToChat(
  chatId: string,
  text: string,
): Promise<string> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  if (!text.trim() || text.length > 12_000)
    throw new Error('请输入 1–12000 字符的文字内容');
  const page = window as any;
  const req = (name: string) => page.require(name);
  const chat = req('WAWebCollections').Chat.get(chatId);
  if (
    !chat ||
    !['g.us', 'c.us', 'lid'].includes(chat.id.server) ||
    chat.isReadOnly
  )
    throw new Error('所选聊天不可用或没有发送权限');
  if (req('WAWebSocketModel').Socket.state !== 'CONNECTED')
    throw new Error('账号未连接');
  const prefs = req('WAWebUserPrefsMeUser');
  const lidMode =
    chat.id.server === 'lid' ||
    (chat.id.server === 'g.us' && chat.groupMetadata?.isLidAddressingMode);
  const me = lidMode ? prefs.getMaybeMeLidUser() : prefs.getMaybeMePnUser();
  const MsgKey = req('WAWebMsgKey');
  const id = new MsgKey({
    from: me,
    to: chat.id,
    id: await MsgKey.newId(),
    participant:
      chat.id.server === 'g.us'
        ? req('WAWebWidFactory').asUserWidOrThrow(me)
        : undefined,
    selfDir: 'out',
  });
  const message = {
    ...req('WAWebGetEphemeralFieldsMsgActionsUtils').getEphemeralFields(chat),
    id,
    ack: 0,
    body: text,
    from: me,
    to: chat.id,
    local: true,
    self: 'out',
    t: Math.floor(Date.now() / 1000),
    isNewMsg: true,
    type: 'chat',
  };
  const [created, sent] = req('WAWebSendMsgChatAction').addAndSendMsgToChat(
    chat,
    message,
  );
  await created;
  const outcome = await sent;
  if (outcome !== 'success' && outcome?.messageSendResult !== 'success')
    throw new Error('未确认服务器接受结果，请到 WhatsApp 核查，勿直接重发');
  return id._serialized;
}
