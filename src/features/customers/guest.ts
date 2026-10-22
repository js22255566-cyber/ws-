/* eslint-disable unicorn/consistent-function-scoping, no-continue, prefer-destructuring, unicorn/no-useless-undefined -- Serialized guest functions must be self-contained and skip unsupported native rows. */
import type { CustomerBundle, CustomerContext, CustomerAction } from './types';

export function readCustomerContext(): CustomerContext {
  const page = window as any;
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    return { token: '', owners: [] };
  page.__zlCustomerToken ??= crypto.randomUUID();
  const module = (name: string) => {
    try {
      return page.require?.(name);
    } catch {
      return undefined;
    }
  };
  const wid = (id: any): string =>
    id?._serialized ||
    (id?.user && id?.server
      ? `${id.user}@${id.server}`
      : typeof id === 'string'
        ? id
        : '');
  const prefs = module('WAWebUserPrefsMeUser');
  const owners = [
    ...new Set<string>(
      [
        wid(prefs?.getMaybeMePnUser?.()),
        wid(prefs?.getMaybeMeLidUser?.()),
        wid(module('WAWebConnModel')?.Conn?.wid),
      ].filter(id => /^\d{5,30}@(c\.us|lid)$/.test(id)),
    ),
  ].slice(0, 2);
  const header = document.querySelector('#main header');
  if (!header) return { token: page.__zlCustomerToken, owners };
  const collection = module('WAWebCollections')?.Chat;
  const models: any[] =
    collection?.getModelsArray?.() ?? collection?.models ?? [];
  let chat: any;
  try {
    chat = page.WPP?.isReady ? page.WPP.chat?.getActiveChat?.() : undefined;
  } catch {
    /* The native collection remains available while the helper reloads. */
  }
  if (!chat?.id) {
    try {
      chat = module('WAWebChatGetters')?.getActiveChat?.();
    } catch {
      /* Try stable native identity sources below. */
    }
  }
  if (!chat?.id) {
    const active = models.filter(m => m.active === true);
    if (active.length === 1) [chat] = active;
  }
  if (!chat?.id) {
    // Message keys identify the actual conversation, even when the active-chat
    // getter has moved in a WhatsApp update. Never infer identity from a name
    // unless that name matches exactly one native model.
    const marker =
      document
        .querySelector('#main [data-id^="true_"], #main [data-id^="false_"]')
        ?.getAttribute('data-id') ||
      document.querySelector('#main [data-id]')?.getAttribute('data-id') ||
      '';
    const remote =
      /^(?:true|false)_([^_]+)_/.exec(marker)?.[1] ||
      header.querySelector('[data-jid]')?.getAttribute('data-jid') ||
      header.querySelector('[data-id]')?.getAttribute('data-id');
    if (remote)
      chat =
        models.find(m => wid(m.id) === remote) ||
        (/^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(remote)
          ? { id: remote }
          : undefined);
  }
  if (!chat?.id) {
    const name = header.querySelector('[title]')?.getAttribute('title');
    const matches = name
      ? models.filter(m =>
          [
            m.formattedTitle,
            m.name,
            m.contact?.name,
            m.contact?.pushname,
          ].includes(name),
        )
      : [];
    if (matches.length === 1) [chat] = matches;
  }
  const id = wid(chat?.id);
  if (
    !document.querySelector('#main header') ||
    !/^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(id)
  )
    return { token: page.__zlCustomerToken, owners };
  const { contact } = chat;
  const aliases = [
    ...new Set(
      [id, wid(contact?.id), wid(contact?.phoneNumber)].filter(value =>
        /^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(value),
      ),
    ),
  ].slice(0, 2);
  return {
    token: page.__zlCustomerToken,
    owners,
    chat: {
      id,
      aliases,
      name: String(
        chat.formattedTitle ||
          chat.name ||
          contact?.pushname ||
          document
            .querySelector('#main header [title]')
            ?.getAttribute('title') ||
          id.split('@')[0],
      ),
      phone:
        aliases.find(value => value.endsWith('@c.us'))?.split('@')[0] || '',
      group: id.endsWith('@g.us'),
    },
  };
}

// Only short remarks, labels and pin order enter the page. The full customer
// profile and long notes stay in the host application.
export function customerTick(
  input?: CustomerBundle,
  activeChatId?: string,
): CustomerAction[] {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return [];
  const page = window as any;
  if (!page.__zlCustomers) {
    const state: any = {
      queue: [],
      sequence: 0,
      revision: -1,
      dirty: true,
      layouts: new WeakMap(),
    };
    page.__zlCustomers = state;
    state.inlineDrafts = new Map();
    state.commits = new WeakMap();
    state.action = (
      chatId: string,
      action: string,
      value?: string,
      owner = state.data?.owner,
    ) => {
      state.sequence += 1;
      state.queue.push({ id: state.sequence, chatId, action, value, owner });
    };
    const style = document.createElement('style');
    style.dataset.zlCustomers = 'style';
    style.textContent = `
      .zl-chat-note{position:absolute;left:0;right:0;width:100%;box-sizing:border-box;line-height:12px;font:11px/12px sans-serif;color:#ff6060;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:2;height:14px!important;min-height:0!important;padding:0!important;margin:0!important;border:0!important;background:transparent!important;outline:none;cursor:text;-webkit-app-region:no-drag}
      .zl-chat-note::placeholder{color:#8a969c}
      .zl-chat-note:focus{box-shadow:0 1px #579dff}
      .zl-chat-note[data-save-state="error"]{box-shadow:0 1px #ff6060}
      .zl-customer-flags{display:inline-flex;gap:3px;vertical-align:middle;height:auto!important;margin-left:5px}
      .zl-customer-flag{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px!important;border-radius:50%;font:12px sans-serif;color:white}
      .zl-header-note{color:#ff6060;font:12px sans-serif;margin-left:8px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    `;
    document.head.append(style);
    state.nativePins = new Map();
    const rememberRow = (event: Event) => {
      const target = event.target as Element;
      const row = target.closest?.(
        '#pane-side [role="row"], #pane-side [data-testid="cell-frame-container"]',
      );
      if (row) state.menuChat = state.resolveRow?.(row) || '';
      else if (
        !target.closest?.(
          '[role="menu"], [role="menuitem"], [data-animate-dropdown], [data-animate-dropdown-item], [data-testid="mi-pin"], [data-testid="mi-unpin"]',
        )
      )
        state.menuChat = '';
    };
    document.addEventListener('pointerdown', rememberRow, true);
    document.addEventListener('contextmenu', rememberRow, true);
    document.addEventListener(
      'focusin',
      event => {
        if ((event.target as Element).closest?.('#pane-side [role="row"]'))
          rememberRow(event);
      },
      true,
    );
    document.addEventListener(
      'click',
      event => {
        const target = event.target as Element;
        const item = target.closest?.(
          '[role="menuitem"], [data-testid="mi-pin"], [data-testid="mi-unpin"], [data-animate-dropdown-item], [role="button"]',
        );
        if (!item || !state.menuChat || !state.data) return;
        const text = item.textContent?.trim() || '';
        const icon =
          item.querySelector('[data-icon]')?.getAttribute('data-icon') || '';
        const unpin =
          /^(unpin chat|取消置顶(?:聊天)?)$/i.test(text) ||
          /^(unpin|pinned-off|pin-off)$/.test(icon);
        const pin =
          /^(pin chat|置顶(?:聊天)?)$/i.test(text) ||
          /^(pin|pinned)$/.test(icon);
        if (!pin && !unpin) return;
        const id = state.menuChat;
        if (!state.models?.some((m: any) => state.idOf(m) === id)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const key = state.data.aliases[id] || id;
        const remove = state.data.pins.includes(key) || unpin;
        state.action(id, remove ? 'unpin' : 'pin');
        // Optimistic local order also prevents a second fast click reversing a
        // stale menu state before the host has persisted the action.
        state.data = {
          ...state.data,
          pins: remove
            ? state.data.pins.filter((p: string) => p !== key)
            : [key, ...state.data.pins.filter((p: string) => p !== key)],
        };
        state.dirty = true;
        item.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true,
          }),
        );
        state.menuChat = '';
      },
      true,
    );
    state.observer = new MutationObserver(changes => {
      if (
        changes.some(
          c => !(c.target as Element).closest?.('[data-zl-customers]'),
        )
      )
        state.dirty = true;
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title', 'data-id', 'data-jid'],
    });
    document.addEventListener(
      'scroll',
      () => {
        state.dirty = true;
      },
      { capture: true, passive: true },
    );
  }
  const state = page.__zlCustomers;
  if (input) {
    if (state.data?.owner !== input.owner) {
      document
        .querySelectorAll('[data-zl-customers]:not(style)')
        .forEach(n => n.remove());
      state.editor = undefined;
      for (const [model, pin] of state.nativePins) {
        if (typeof model.set === 'function') model.set('pin', pin);
        else model.pin = pin;
      }
      state.nativePins = new Map();
      state.inlineDrafts.clear();
    }
    state.data = input;
    for (const [key, draft] of state.inlineDrafts) {
      const prefix = `${input.owner}:`;
      if (key.startsWith(prefix)) {
        const id = key.slice(prefix.length);
        const canonicalKey = `${prefix}${input.aliases[id] || id}`;
        if (canonicalKey !== key) {
          if (!state.inlineDrafts.has(canonicalKey))
            state.inlineDrafts.set(canonicalKey, draft);
          state.inlineDrafts.delete(key);
        }
      }
      if (
        key.startsWith(prefix) &&
        !draft.error &&
        (input.summaries[key.slice(prefix.length)]?.remarkName || '') ===
          draft.value
      )
        state.inlineDrafts.delete(key);
    }
    state.dirty = true;
  }
  const { data } = state;
  if (!data) return state.queue.splice(0);
  const canonical = (id: string) => data.aliases[id] || id;
  const summary = (id: string) => data.summaries[canonical(id)];
  const flags = (id: string) => {
    const box = document.createElement('span');
    box.className = 'zl-customer-flags';
    box.dataset.zlCustomers = 'flags';
    const design = {
      priority: ['⚑', '#ee9200', '重点'],
      follow: ['↗', '#176aff', '跟票'],
      signup: ['✓', '#8551e9', '报名'],
      deposit: ['¥', '#df3b45', '入金'],
    };
    for (const flag of summary(id)?.flags ?? []) {
      const item = document.createElement('span');
      item.className = 'zl-customer-flag';
      item.textContent = design[flag][0];
      item.style.background = design[flag][1];
      item.title = design[flag][2];
      item.setAttribute('aria-label', design[flag][2]);
      box.append(item);
    }
    return box;
  };
  // Native row identifiers are preferred. Title matching is used only for a
  // unique exact name, never for two contacts sharing the same display name.
  let models: any[] = [];
  try {
    const collection = page.require?.('WAWebCollections')?.Chat;
    models = collection?.getModelsArray?.() ?? collection?.models ?? [];
  } catch {
    /* Await the native collection. */
  }
  const idOf = (model: any) =>
    model.id?._serialized || (typeof model.id === 'string' ? model.id : '');
  const nameOf = (model: any) =>
    String(
      model.formattedTitle ||
        model.name ||
        model.contact?.pushname ||
        model.id?.user ||
        '',
    );
  const names = new Map<string, string[]>();
  for (const model of models) {
    const name = nameOf(model);
    names.set(name, [...(names.get(name) || []), idOf(model)]);
  }
  state.models = models;
  state.idOf = idOf;
  state.resolveRow = (row: HTMLElement) => {
    const possible =
      row.dataset.id ||
      row.dataset.jid ||
      row.querySelector('[data-id]')?.getAttribute('data-id') ||
      '';
    if (models.some(m => idOf(m) === possible)) return possible;
    const marker = row.querySelector<HTMLElement>(
      '[title]:not([data-zl-customers]), [data-testid="cell-frame-title"] span',
    );
    const name = marker?.getAttribute('title') || marker?.textContent || '';
    return names.get(name)?.length === 1 ? names.get(name)![0] : '';
  };
  // Project local pins onto the native model, so WhatsApp's own collection,
  // virtual list, pin glyph and menu all render the normal pinned-chat state.
  // Do not call setPin / server chat actions: their three-chat limit and phone
  // synchronization must not control this desktop-only order.
  if (!data.pinsInitialized && models.length > 0) {
    const native = models
      .filter(m => m.pin)
      .sort((a, b) => Number(b.pin) - Number(a.pin));
    const ids = native.map(m => idOf(m));
    data.pins = [...new Set([...data.pins, ...ids.map(id => canonical(id))])];
    data.pinsInitialized = true;
    state.action('', 'importPins', JSON.stringify(ids));
  }
  for (const model of models) {
    const index = data.pins.indexOf(canonical(idOf(model)));
    if (!state.nativePins.has(model))
      state.nativePins.set(model, model.pin || 0);
    // A fixed base keeps incoming-message timestamps from moving local pins.
    const projected = index < 0 ? 0 : 2_000_000_000 - index;
    if (Number(model.pin || 0) !== projected) {
      if (typeof model.set === 'function') model.set('pin', projected);
      else model.pin = projected;
    }
  }
  if (state.dirty || Date.now() - (state.lastRender || 0) > 2000) {
    state.dirty = false;
    state.lastRender = Date.now();
    const pane = document.querySelector<HTMLElement>('#pane-side');
    if (pane) {
      const rows = [
        ...pane.querySelectorAll<HTMLElement>(
          '[role="row"], [data-testid="cell-frame-container"]',
        ),
      ];
      const seen = new Set<Element>();
      for (const candidate of rows) {
        const row = candidate.closest<HTMLElement>('[role="row"]') || candidate;
        if (seen.has(row)) continue;
        seen.add(row);
        const marker = row.querySelector<HTMLElement>(
          '[title]:not([data-zl-customers]), [data-testid="cell-frame-title"] span',
        );
        if (!marker) continue;
        const possible =
          row.dataset.id ||
          row.dataset.jid ||
          row.querySelector('[data-id]')?.getAttribute('data-id') ||
          '';
        const name = marker.getAttribute('title') || marker.textContent || '';
        const match = /^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(
          possible,
        )
          ? possible
          : names.get(name)?.length === 1
            ? names.get(name)![0]
            : '';
        const key = `${match}:${data.revision}`;
        const existingNote =
          row.querySelector<HTMLInputElement>('.zl-chat-note');
        if (
          existingNote &&
          document.activeElement === existingNote &&
          row.dataset.zlCustomerKey?.startsWith(`${match}:`)
        )
          continue;
        if (
          row.dataset.zlCustomerKey === key &&
          row.dataset.zlCustomerRendered === 'true' &&
          existingNote
        )
          continue;
        for (const element of [row, ...row.querySelectorAll('*')]) {
          const old = state.layouts.get(element);
          if (old) {
            (element as HTMLElement).style.position = old.position;
            (element as HTMLElement).style.top = old.top;
            state.layouts.delete(element);
          }
        }
        row.querySelectorAll('[data-zl-customers]').forEach(n => {
          state.commits.get(n)?.();
          n.remove();
        });
        row.dataset.zlCustomerKey = key;
        if (!match) continue;
        let titleLine =
          marker.closest<HTMLElement>('[data-testid="cell-frame-title"]') ||
          marker.parentElement;
        if (!titleLine) continue;
        let preview: HTMLElement | undefined;
        // Native title wrappers can contain badges and timestamps. Find the
        // next line below the name rather than treating a badge as the preview.
        for (
          let current: HTMLElement | null = titleLine;
          current && current !== row;
          current = current.parentElement
        ) {
          const next = current.nextElementSibling as HTMLElement | null;
          if (!next || next.dataset.zlCustomers) continue;
          const bounds = next.getBoundingClientRect();
          const nameBounds = marker.getBoundingClientRect();
          if (
            bounds.width > 50 &&
            bounds.top >= nameBounds.bottom - 3 &&
            Math.abs(bounds.left - nameBounds.left) < 35
          ) {
            titleLine = current;
            preview = next;
            break;
          }
        }
        state.layouts.set(titleLine, {
          position: titleLine.style.position,
          top: titleLine.style.top,
        });
        titleLine.style.position = 'relative';
        titleLine.append(flags(match));
        row.dataset.zlCustomerRendered = 'true';
        const note = summary(match)?.remarkName;
        {
          const line = document.createElement('input');
          line.className = 'zl-chat-note';
          line.dataset.zlCustomers = 'note';
          const owner = data.owner;
          const draftKey = () =>
            `${owner}:${state.data.aliases[match] || match}`;
          const savedNote = note || '';
          const draft = state.inlineDrafts.get(draftKey());
          line.type = 'text';
          line.maxLength = 100;
          line.placeholder = '添加备注';
          line.setAttribute('aria-label', '聊天备注名');
          line.dataset.chatId = match;
          line.value = draft?.value ?? savedNote;
          line.title =
            draft?.error ||
            line.value ||
            '点击填写备注，Enter 保存，Esc 取消未保存的修改';
          line.dataset.saveState = draft?.error
            ? 'error'
            : draft
              ? 'pending'
              : 'saved';
          let committed = savedNote;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let composing = false;
          const commit = () => {
            clearTimeout(timer);
            if (composing || state.data?.owner !== owner) return;
            const value = line.value;
            const current = state.inlineDrafts.get(draftKey());
            if (value === committed && !current?.error) return;
            committed = value;
            state.inlineDrafts.set(draftKey(), { value });
            line.dataset.saveState = 'pending';
            state.action(match, 'saveRemark', value, owner);
          };
          state.commits.set(line, commit);
          line.addEventListener('input', () => {
            state.inlineDrafts.set(draftKey(), { value: line.value });
            clearTimeout(timer);
            if (!composing) timer = setTimeout(commit, 350);
          });
          line.addEventListener('compositionstart', () => {
            composing = true;
            clearTimeout(timer);
          });
          line.addEventListener('compositionend', () => {
            composing = false;
            clearTimeout(timer);
            timer = setTimeout(commit, 350);
          });
          line.addEventListener('pointerdown', event =>
            event.stopPropagation(),
          );
          line.addEventListener('click', event => event.stopPropagation());
          line.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
              line.blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              clearTimeout(timer);
              line.value = committed;
              const currentSaved =
                state.data.summaries[state.data.aliases[match] || match]
                  ?.remarkName || '';
              if (
                committed === currentSaved ||
                line.dataset.saveState === 'saved'
              )
                state.inlineDrafts.delete(draftKey());
              else state.inlineDrafts.set(draftKey(), { value: committed });
              line.blur();
            }
          });
          line.addEventListener('blur', () => {
            commit();
            state.dirty = true;
          });
          const titleBounds = titleLine.getBoundingClientRect();
          // Keep WhatsApp's virtual row height unchanged while making room for
          // the third text line between the native title and message preview.
          titleLine.style.top = '-6px';
          const textBottom =
            marker.getBoundingClientRect().bottom -
            titleLine.getBoundingClientRect().top;
          line.style.top = `${Math.max(18, titleBounds.height, textBottom + 2)}px`;
          titleLine.append(line);
          if (preview && !preview.dataset.zlCustomers) {
            state.layouts.set(preview, {
              position: preview.style.position,
              top: preview.style.top,
            });
            preview.style.position = 'relative';
            const gap =
              line.getBoundingClientRect().bottom +
              2 -
              preview.getBoundingClientRect().top;
            preview.style.top = `${Math.max(7, gap)}px`;
          }
        }
      }
    }
    let active = activeChatId || '';
    try {
      active ||= idOf(
        (page.WPP?.isReady ? page.WPP.chat?.getActiveChat?.() : undefined) ||
          page.require?.('WAWebChatGetters')?.getActiveChat?.(),
      );
    } catch {
      /* No conversation. */
    }
    const header = document.querySelector('#main header');
    if (
      header &&
      (state.headerKey !== `${active}:${data.revision}` ||
        !header.querySelector('[data-zl-customers=header]'))
    ) {
      header.querySelectorAll('[data-zl-customers]').forEach(n => n.remove());
      const name = header.querySelector('[title]');
      if (name && active) {
        const line = document.createElement('span');
        line.dataset.zlCustomers = 'header';
        line.append(flags(active));
        const note = document.createElement('span');
        note.className = 'zl-header-note';
        note.textContent = summary(active)?.remarkName || '';
        line.append(note);
        name.after(line);
      }
      state.headerKey = `${active}:${data.revision}`;
    }
  }
  return state.queue.splice(0);
}

// Acknowledge only the same account/chat/value: an older save must not replace
// a newer inline draft, including after a row is recycled by the virtual list.
export function customerRemarkResult(
  owner: string,
  chatId: string,
  value: string,
  error?: string,
) {
  const state = (window as any).__zlCustomers;
  if (!state?.data || state.data.owner !== owner) return;
  const canonical = state.data.aliases[chatId] || chatId;
  const key = `${owner}:${canonical}`;
  if (state.inlineDrafts.get(key)?.value !== value) return;
  if (error) state.inlineDrafts.set(key, { value, error });
  else state.inlineDrafts.delete(key);
  for (const input of document.querySelectorAll<HTMLInputElement>(
    '.zl-chat-note',
  )) {
    const id = input.dataset.chatId || '';
    if ((state.data.aliases[id] || id) !== canonical || input.value !== value)
      continue;
    input.dataset.saveState = error ? 'error' : 'saved';
    input.title = error ? `保存失败：${error}，点击后可重试` : '已保存到本机';
  }
  state.dirty = true;
}
