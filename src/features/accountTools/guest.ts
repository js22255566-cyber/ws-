/* eslint-disable no-continue -- Skip unsupported or already translated message nodes. */

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
      memo: new Map(),
      dirty: true,
      lastScan: 0,
      settleUntil: 0,
    };
    page.__zlTranslation = state;
    // Emoji decorators can be IMG/contenteditable=false nodes. innerText alone
    // loses them, so read only message text and reconstruct emoji alt characters.
    state.readText = (root: Node): string => {
      const walk = (node: Node): string => {
        if (node.nodeType === 3) return node.textContent || '';
        if (node.nodeType !== 1 && node.nodeType !== 11) return '';
        const element = node as HTMLElement;
        if (
          element.matches?.(
            '[data-zl-translation], script, style, button, [data-testid*="quoted"], blockquote',
          )
        )
          return '';
        if (element.tagName === 'IMG') {
          const alt =
            element.getAttribute('alt') || element.dataset.plainText || '';
          return /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u.test(
            alt,
          )
            ? alt
            : '';
        }
        if (element.tagName === 'BR') return '\n';
        let text = '';
        for (const child of node.childNodes) {
          if (
            text &&
            child.nodeType === 1 &&
            ['P', 'DIV', 'LI'].includes((child as Element).tagName) &&
            !text.endsWith('\n')
          )
            text += '\n';
          text += walk(child);
        }
        return text;
      };
      return walk(root).replaceAll('\u200B', '').replaceAll('\uFEFF', '');
    };
    state.needsTranslation = (text: string) => {
      // Emoji, numbers, punctuation, URLs and stickers keep the normal send path.
      const withoutEmoji = text.replaceAll(
        /\p{Extended_Pictographic}(?:[\uFE0E\uFE0F]|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:[\uFE0E\uFE0F]|\p{Emoji_Modifier})?)*/gu,
        '',
      );
      return (
        /\p{L}/u.test(withoutEmoji) &&
        !/^(?:https?:\/\/|www\.)\S+$/i.test(text.trim())
      );
    };
    const sendSelector =
      '[aria-label="Send"], [aria-label="发送"], [data-icon="send"], [data-icon="wds-ic-send-filled"], [data-icon="send-filled"], [data-testid="compose-btn-send"], [data-testid="media-send"]';
    const visible = (node: HTMLElement) =>
      node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility !== 'hidden' &&
      !node.closest('[aria-hidden="true"]');
    state.mediaRoots = new WeakMap();
    state.mediaSequence = 0;
    const composerContext = () => {
      const candidates: {
        input: HTMLElement;
        root: HTMLElement;
        key: string;
      }[] = [];
      for (const input of document.querySelectorAll<HTMLElement>(
        '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-lexical-editor="true"]',
      )) {
        if (!visible(input)) continue;
        const caption =
          input.closest(
            '[data-testid="media-caption-input-container"], [data-testid="media-caption-input"], [data-testid="media-editor-caption"]',
          ) ||
          /caption|添加说明|添加描述|添加文字|输入说明/i.test(
            input.getAttribute('aria-label') || '',
          );
        if (
          input.closest('#main footer') &&
          !caption &&
          !input.closest('[role="dialog"], [data-testid="media-editor"]')
        )
          continue;
        let root = input.parentElement;
        for (
          let depth = 0;
          root && depth < 10 && !root.matches('body, #app, #main');
          depth += 1, root = root.parentElement
        ) {
          const media = root.querySelector(
            'img[src^="blob:"], img[src^="data:image/"], video, canvas, [data-testid="media-preview"], [data-testid="media-editor"]',
          );
          if (
            root.querySelector(sendSelector) &&
            (media || (caption && root.matches('[role="dialog"]')))
          ) {
            if (!state.mediaRoots.has(root)) {
              state.mediaSequence += 1;
              state.mediaRoots.set(root, state.mediaSequence);
            }
            const sources = [
              ...root.querySelectorAll<HTMLImageElement | HTMLVideoElement>(
                'img[src^="blob:"], img[src^="data:image/"], video',
              ),
            ].map(
              node =>
                node.getAttribute('src') ||
                (node as HTMLVideoElement).currentSrc ||
                '',
            );
            const selected = [
              ...root.querySelectorAll<HTMLElement>(
                '[aria-selected="true"], [data-selected="true"]',
              ),
            ].map(node => [
              node.dataset.id,
              node.getAttribute('aria-label'),
              node.querySelector('img')?.getAttribute('src'),
            ]);
            candidates.push({
              input,
              root,
              key: JSON.stringify([
                state.mediaRoots.get(root),
                sources,
                selected,
              ]),
            });
            break;
          }
        }
      }
      if (candidates.length > 0) {
        const focused = candidates.find(
          item =>
            item.input === document.activeElement ||
            item.input.contains(document.activeElement),
        );
        return focused || (candidates.length === 1 ? candidates[0] : undefined);
      }
      const input = document.querySelector<HTMLElement>(
        '#main footer [contenteditable="true"][role="textbox"], #main footer [contenteditable="true"][data-lexical-editor="true"]',
      );
      return input && visible(input)
        ? { input, root: input.closest<HTMLElement>('footer')!, key: 'text' }
        : undefined;
    };
    const composer = () => composerContext()?.input;
    state.contextKey = (input: HTMLElement) => {
      const context = composerContext();
      return context?.input === input ? context.key : undefined;
    };
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
      n.style.display = text ? 'block' : 'none';
    };
    state.normalizeText = (text: string) =>
      text
        .replaceAll('\u00A0', ' ')
        .replaceAll('\r\n', '\n')
        .replaceAll('\u200B', '')
        .trim();
    state.notice = notice;
    state.composer = composer;
    state.chatKey = chatKey;
    // Adjust only for our own added/removed translation height. Never force a
    // chat to the bottom if WhatsApp/user has selected an unread/history anchor.
    state.withScroll = (node: Element | null, mutate: () => void) => {
      let scroller = node?.parentElement;
      while (
        scroller &&
        !(
          scroller.clientHeight > 100 &&
          /auto|scroll/.test(getComputedStyle(scroller).overflowY)
        )
      )
        scroller = scroller.parentElement;
      if (!scroller) {
        mutate();
        return;
      }
      const pinned =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 8;
      const bounds = scroller.getBoundingClientRect();
      const anchor = [
        ...scroller.querySelectorAll<HTMLElement>(
          '[data-id], .message-in, .message-out, [data-pre-plain-text]',
        ),
      ].find(n => n.getBoundingClientRect().bottom > bounds.top + 1);
      const before = anchor?.getBoundingClientRect().top;
      mutate();
      if (pinned)
        scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
      else if (anchor?.isConnected && before !== undefined)
        scroller.scrollTop += anchor.getBoundingClientRect().top - before;
    };
    state.receiveKey = (c: TranslationConfig) =>
      JSON.stringify([
        c.receiveEngine,
        c.receiveSource,
        c.receiveTarget,
        c.cacheRevision,
      ]);
    state.signature = state.receiveKey(config);
    state.remember = (key: string, text: string) => {
      state.memo.delete(key);
      state.memo.set(key, text);
      if (state.memo.size > 800)
        state.memo.delete(state.memo.keys().next().value);
    };
    state.restore = (record: any, text: string) => {
      const current = record;
      state.withScroll(current.container, () => {
        current.status = 'done';
        current.label.textContent = text;
        current.container.style.borderTop = '1px dashed #ffe45c';
        current.button.disabled = false;
        current.button.hidden = true;
        current.button.style.display = 'none';
      });
    };
    state.cancelPending = () => {
      for (const job of state.pending.values()) {
        const current = job.record;
        if (job.direction === 'incoming' && current?.status === 'pending') {
          current.status = 'idle';
          current.button.disabled = false;
          current.button.textContent = '点击翻译';
          current.autoAttempted = true;
        }
      }
      state.pending.clear();
      state.queue = [];
      state.busy = false;
    };
    const intercept = (event: Event) => {
      if (!state.config.outgoing) return;
      const context = composerContext();
      const input = context?.input;
      if (!input || !context) return;
      const key = event as KeyboardEvent;
      const sendKey =
        event.type === 'keydown' &&
        key.key === 'Enter' &&
        !key.shiftKey &&
        !key.isComposing;
      const target = event.target as Element;
      const control = target?.closest('button, [role="button"]');
      const sendNode =
        target?.closest(sendSelector) || control?.querySelector(sendSelector);
      const sendClick =
        event.type === 'click' &&
        Boolean(sendNode && context.root.contains(sendNode));
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
      const text = state.readText(input);
      if (!text.trim()) return;
      if (!state.needsTranslation(text)) {
        state.approved = null;
        state.failedReplacement = null;
        for (const [id, job] of state.pending) {
          if (job.direction === 'outgoing') state.pending.delete(id);
        }
        state.queue = state.queue.filter(job => job.direction !== 'outgoing');
        state.busy = false;
        notice('');
        return;
      }
      if (
        state.failedReplacement?.input === input &&
        state.failedReplacement.chat === chatKey() &&
        state.failedReplacement.context === context.key &&
        state.failedReplacement.text === text
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        notice(
          '上次译文未完整替换，已暂停重试以防重复追加；请修改草稿或关闭发送翻译后发送',
        );
        return;
      }
      // Approval belongs to this composer and chat, and survives deliberate corrections.
      if (
        state.approved?.input === input &&
        state.approved.chat === chatKey() &&
        state.approved.context === context.key &&
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
        context: context.key,
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
        if (!state.readText(composer() || document.createTextNode('')).trim())
          state.approved = null;
      },
      true,
    );
    // Changing chats invalidates an approved composer, even if React reuses its node.
    state.observer = new MutationObserver(changes => {
      if (
        changes.every(
          change =>
            (change.target as Element).closest?.('[data-zl-translation]') ||
            (change.type === 'childList' &&
              [...change.addedNodes, ...change.removedNodes].length > 0 &&
              [...change.addedNodes, ...change.removedNodes].every(
                n =>
                  n.nodeType === 1 &&
                  (n as Element).matches('[data-zl-translation]'),
              )),
        )
      )
        return;
      state.dirty = true;
      const next = chatKey();
      if (next !== state.activeChat) {
        if (state.approved || state.busy)
          notice('聊天已切换，消息未发送；请重新翻译');
        state.approved = null;
        state.cancelPending();
        state.activeChat = next;
        state.previewBlockedChat = undefined;
        state.settleUntil = Date.now() + 500;
      }
    });
    state.activeChat = chatKey();
    state.previewBlockedChat = config.preview ? state.activeChat : undefined;
    document.addEventListener(
      'scroll',
      () => {
        state.dirty = true;
      },
      { capture: true, passive: true },
    );
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
    state.failedReplacement = null;
    state.cancelPending();
    if (state.signature !== state.receiveKey(config) || !config.incoming) {
      state.incoming = new WeakMap();
      state.withScroll(document.querySelector('[data-zl-translation]'), () =>
        document
          .querySelectorAll('[data-zl-translation]')
          .forEach(n => n.remove()),
      );
    }
    if (config.preview && (!state.config.preview || !state.config.incoming))
      state.previewBlockedChat = state.chatKey();
    state.signature = state.receiveKey(config);
    state.dirty = true;
    state.notice('');
  }
  state.config = config;
  const scan =
    config.incoming &&
    Date.now() >= state.settleUntil &&
    (state.dirty || Date.now() - state.lastScan > 1500);
  if (scan) {
    state.dirty = false;
    state.lastScan = Date.now();
    // Prefer semantic body markers, not WhatsApp's changing generated classes.
    const bodies = new Set<HTMLElement>();
    const scope =
      '#main, [data-testid="conversation-panel-messages"], [data-testid="conversation-panel-wrapper"]';
    for (const root of document.querySelectorAll<HTMLElement>(scope)) {
      for (const body of root.querySelectorAll<HTMLElement>(
        '[data-pre-plain-text], .message-in, .message-out, [data-id], [data-testid="msg-container"], [role="row"]',
      )) {
        if (
          !body.closest(
            'footer, header, [contenteditable="true"], [data-zl-translation]',
          )
        )
          bodies.add(body);
      }
    }
    const seen = new Set<HTMLElement>();
    let processed = 0;
    for (const body of bodies) {
      const rect = body.getBoundingClientRect();
      if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight + 80 ||
        rect.height === 0
      )
        continue;
      const textNode = [
        body,
        ...body.querySelectorAll<HTMLElement>(
          '.selectable-text, [data-testid="msg-text"], [data-testid="selectable-text"], [data-pre-plain-text] [dir="auto"], [data-lexical-text="true"]',
        ),
      ].find(
        node =>
          (node.matches(
            '.selectable-text, [data-testid="msg-text"], [data-testid="selectable-text"], [data-lexical-text="true"]',
          ) ||
            (node.matches('[data-pre-plain-text]') &&
              !node.querySelector(
                '.selectable-text, [data-testid="msg-text"], [data-testid="selectable-text"], [dir="auto"]',
              )) ||
            (node.matches('[dir="auto"]') &&
              !!node.closest('[data-pre-plain-text]'))) &&
          !node.closest(
            'footer, header, [contenteditable="true"], [data-zl-translation], [data-testid*="quoted"], [data-testid*="link-preview"], blockquote',
          ),
      );
      if (!textNode || seen.has(textNode)) continue;
      seen.add(textNode);
      if (processed >= 24) break;
      processed += 1;
      const bubble =
        textNode.closest<HTMLElement>(
          '.message-in, .message-out, [data-id], [data-testid="msg-container"], [role="row"]',
        ) ||
        textNode.parentElement ||
        textNode;
      const text = state.readText(textNode);
      if (!text.trim() || text.length > 12_000 || !state.needsTranslation(text))
        continue;
      const identity = `${state.chatKey()}:${bubble.closest('[data-id]')?.getAttribute('data-id') || ''}`;
      let record = state.incoming.get(textNode);
      if (
        !record ||
        record.text !== text ||
        record.identity !== identity ||
        !record.container.isConnected
      ) {
        record?.container.remove();
        const container = document.createElement('div');
        container.dataset.zlTranslation = 'true';
        container.style.cssText =
          'height:auto;clear:both;padding:6px 0 2px;text-align:left;white-space:pre-wrap;font:13px/1.5 sans-serif';
        const label = document.createElement('div');
        label.dataset.zlTranslationText = 'true';
        label.style.cssText =
          'height:auto;color:#ffe45c;white-space:pre-wrap;overflow-wrap:anywhere';
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.zlTranslate = 'true';
        button.textContent = '点击翻译';
        button.style.cssText =
          'display:inline-flex;align-items:center;border:0;border-radius:5px;background:#175aff;color:#fff;padding:7px 10px;margin:4px 0;cursor:pointer;font:13px/1.4 sans-serif';
        container.append(label, button);
        const mount = textNode.closest('.copyable-text');
        state.withScroll(textNode, () => {
          if (mount && mount !== textNode) mount.append(container);
          else textNode.after(container);
        });
        record = {
          text,
          identity,
          chat: state.chatKey(),
          cacheKey: JSON.stringify([state.signature, text]),
          container,
          label,
          button,
          status: 'idle',
          autoAttempted: false,
        };
        state.incoming.set(textNode, record);
        const current = record;
        current.request = (manual: boolean) => {
          if (
            !state.config.incoming ||
            current.chat !== state.chatKey() ||
            current.status === 'pending' ||
            !textNode.isConnected ||
            state.readText(textNode) !== current.text
          )
            return;
          if (
            (!manual && state.pending.size >= 2) ||
            state.pending.size >= 12
          ) {
            button.title = '翻译队列繁忙，请稍后点击重试';
            return;
          }
          current.status = 'pending';
          current.autoAttempted = true;
          button.disabled = true;
          button.textContent = '翻译中…';
          label.textContent = '';
          state.sequence += 1;
          const id = state.sequence;
          state.pending.set(id, {
            direction: 'incoming',
            input: textNode,
            text: current.text,
            bubble,
            record: current,
            chat: current.chat,
            cacheKey: current.cacheKey,
          });
          const request = {
            id,
            token: state.token,
            text: current.text,
            direction: 'incoming',
          };
          if (manual) state.queue.unshift(request);
          else state.queue.push(request);
        };
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          current.request(true);
        });
      }
      const cached = state.memo.get(record.cacheKey);
      if (cached && record.status !== 'done') state.restore(record, cached);
      if (
        config.preview &&
        state.previewBlockedChat !== state.chatKey() &&
        !record.autoAttempted &&
        record.status !== 'done'
      )
        record.request(false);
    }
  } else if (
    !config.incoming &&
    document.querySelector('[data-zl-translation]')
  )
    state.withScroll(document.querySelector('[data-zl-translation]'), () =>
      document
        .querySelectorAll('[data-zl-translation]')
        .forEach(n => n.remove()),
    );
  return drain ? state.queue.splice(0, 4) : [];
}

// Prepare a selection for Electron's native insertText, then verify the editor
// after that trusted input event. DOM/execCommand mutation is insufficient for Lexical.
export function translationResult(
  id: number,
  token: string,
  result: { text: string; error: boolean; message?: string },
  phase: 'prepare' | 'selected' | 'complete' = 'prepare',
): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const state = (window as any).__zlTranslation;
  if (state?.token !== token) return false;
  const job = state.pending.get(id);
  if (!job) return false;
  if (job.direction === 'outgoing') {
    const valid =
      job.input.isConnected &&
      state.composer() === job.input &&
      state.chatKey() === job.chat &&
      state.contextKey(job.input) === job.context;
    if (phase === 'complete') {
      state.pending.delete(id);
      state.busy = false;
      if (
        valid &&
        state.normalizeText(state.readText(job.input)) ===
          state.normalizeText(result.text)
      ) {
        state.approved = {
          input: job.input,
          chat: job.chat,
          context: job.context,
        };
        state.notice('译文已填入：请校正后再次发送');
      } else {
        if (valid)
          state.failedReplacement = {
            input: job.input,
            chat: job.chat,
            context: job.context,
            text: state.readText(job.input),
          };
        state.notice(
          '输入框或聊天已变化，译文未确认；消息尚未发送，请核查草稿',
        );
      }
      return false;
    }
    if (
      !valid ||
      state.readText(job.input) !== job.text ||
      result.error ||
      !result.text?.trim()
    ) {
      state.pending.delete(id);
      state.busy = false;
      state.notice(
        result.error
          ? `${result.message || '翻译失败'}；消息尚未发送，请重试`
          : '输入内容或聊天已变化，本次译文已丢弃；消息尚未发送',
      );
      return false;
    }
    if (state.normalizeText(job.text) === state.normalizeText(result.text)) {
      state.pending.delete(id);
      state.busy = false;
      state.approved = {
        input: job.input,
        chat: job.chat,
        context: job.context,
      };
      state.notice('内容无需改写，请确认后再次发送');
      return false;
    }
    if (phase === 'selected') {
      const selection = document.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (
        !range ||
        (!job.input.contains(selection?.anchorNode || null) &&
          selection?.anchorNode !== job.input) ||
        state.normalizeText(state.readText(range.cloneContents())) !==
          state.normalizeText(job.text)
      ) {
        state.pending.delete(id);
        state.busy = false;
        state.notice('未完整选中输入内容，已停止替换，原文未发送');
        return false;
      }
      return true;
    }
    job.input.focus();
    // Focus handlers may replace the editor; revalidate before selecting anything.
    if (
      state.composer() !== job.input ||
      state.contextKey(job.input) !== job.context ||
      state.chatKey() !== job.chat ||
      state.readText(job.input) !== job.text
    ) {
      state.pending.delete(id);
      state.busy = false;
      state.notice('输入框已变化，原文未发送；请重新翻译');
      return false;
    }
    const range = document.createRange();
    range.selectNodeContents(job.input);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (
      !selection ||
      (selection.anchorNode !== job.input &&
        !job.input.contains(selection.anchorNode))
    ) {
      state.pending.delete(id);
      state.busy = false;
      state.notice('无法选中消息输入框，原文未发送；请重试');
      return false;
    }
    return true;
  }
  state.pending.delete(id);
  const { record } = job;
  if (!result.error && result.text?.trim() && job.cacheKey)
    state.remember(job.cacheKey, result.text);
  state.dirty = true;
  if (
    !state.config.incoming ||
    (job.chat && state.chatKey() !== job.chat) ||
    !job.input.isConnected ||
    state.readText(job.input) !== job.text ||
    !record?.container.isConnected ||
    state.incoming.get(job.input) !== record
  )
    return false;
  if (result.error || !result.text?.trim()) {
    const showError = () => {
      record.button.disabled = false;
      record.button.textContent = '点击翻译';
      record.status = 'error';
      record.label.textContent = `${result.message || '翻译失败'}；可点击重试`;
      record.button.hidden = false;
      record.button.style.display = 'inline-flex';
    };
    if (state.withScroll) state.withScroll(record.container, showError);
    else showError();
  } else if (state.restore) state.restore(record, result.text);
  else {
    record.status = 'done';
    record.label.textContent = result.text;
    record.container.style.borderTop = '1px dashed #ffe45c';
    record.button.disabled = false;
    record.button.textContent = '点击翻译';
    record.button.hidden = true;
    record.button.style.display = 'none';
  }
  return false;
}

export function translationDiagnostics() {
  const state = (window as any).__zlTranslation;
  const selectors = [
    '#main',
    '#main [data-pre-plain-text]',
    '#main .selectable-text',
    '#main [data-id]',
    '#main [role="row"]',
    '#main .message-in',
    '#main .message-out',
    '[data-testid="conversation-panel-messages"]',
    '[data-zl-translate]',
    '[data-zl-translation-text]',
  ];
  return {
    version: 7,
    cachedEntries: state?.memo?.size ?? 0,
    deferredPreview: Boolean(
      state?.config?.preview &&
        state?.previewBlockedChat === state?.chatKey?.(),
    ),
    visibleOnly: true,
    whatsapp: globalThis.location.hostname === 'web.whatsapp.com',
    enabled: Boolean(state?.config?.incoming),
    preview: Boolean(state?.config?.preview),
    structure: [
      ...document.querySelectorAll(
        '#main [dir="auto"], #main [data-pre-plain-text]',
      ),
    ]
      .slice(0, 12)
      .map(node => {
        const path: {
          tag: string;
          role: string | null;
          attributes: string[];
          classes: string[];
        }[] = [];
        let current: Element | null = node;
        for (let depth = 0; current && depth < 4; depth += 1) {
          path.push({
            tag: current.tagName,
            role: current.getAttribute('role'),
            attributes: current
              .getAttributeNames()
              .filter(name => name.startsWith('data-')),
            classes: [...current.classList],
          });
          current = current.parentElement;
        }
        return path;
      }),
    pending: state?.pending?.size || 0,
    counts: Object.fromEntries(
      selectors.map(selector => [
        selector,
        document.querySelectorAll(selector).length,
      ]),
    ),
    translated: [
      ...document.querySelectorAll('[data-zl-translation-text]'),
    ].filter(
      n =>
        n.textContent?.trim() &&
        n.parentElement?.querySelector<HTMLButtonElement>('[data-zl-translate]')
          ?.hidden,
    ).length,
  };
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
      archived: Boolean(c.archive),
      contact: Boolean(c.contact?.isMyContact),
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
