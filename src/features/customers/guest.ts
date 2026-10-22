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
  const chat =
    (page.WPP?.isReady ? page.WPP.chat?.getActiveChat?.() : undefined) ||
    module('WAWebChatGetters')?.getActiveChat?.();
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
export function customerTick(input?: CustomerBundle): CustomerAction[] {
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
    state.action = (chatId: string, action: string, value?: string) => {
      state.sequence += 1;
      state.queue.push({ id: state.sequence, chatId, action, value });
    };
    const style = document.createElement('style');
    style.dataset.zlCustomers = 'style';
    style.textContent = `
      .zl-chat-note{position:absolute;left:0;right:0;line-height:12px;font:11px/12px sans-serif;color:#ff6060;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:2;height:auto!important}
      .zl-chat-actions{position:absolute;right:0;top:0;display:flex;gap:4px;align-items:center;height:auto!important;z-index:4;opacity:0}
      [role="row"]:hover .zl-chat-actions,[role="row"]:focus-within .zl-chat-actions,.zl-chat-actions:focus-within{opacity:1}
      .zl-chat-action{border:0;border-radius:4px;padding:2px 4px;background:#173242;color:#91cfff;font:11px sans-serif;cursor:pointer}
      .zl-customer-flags{display:inline-flex;gap:3px;vertical-align:middle;height:auto!important;margin-left:5px}
      .zl-customer-flag{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px!important;border-radius:50%;font:12px sans-serif;color:white}
      .zl-local-pins{box-sizing:border-box;flex:0 0 auto;max-height:38vh;overflow:auto;background:var(--panel-background,#182229);border-bottom:1px solid #39434a;color:#d9e1e6;font:13px sans-serif}
      .zl-local-pins>summary{padding:8px 12px;cursor:pointer;color:#8fbfff;font-size:12px;position:sticky;top:0;background:var(--panel-background,#182229);z-index:1}
      .zl-local-pin{display:flex;gap:6px;align-items:center;border-top:1px solid #2d383e;padding:7px 10px;height:auto!important}
      .zl-local-pin-open{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;text-align:left;background:transparent;color:inherit;border:0;cursor:pointer;font:inherit;padding:3px}
      .zl-local-pin-open small{display:block;color:#ff6060;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;margin-top:3px}
      .zl-header-note{color:#ff6060;font:12px sans-serif;margin-left:8px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    `;
    document.head.append(style);
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
      state.pinSignature = '';
    }
    state.data = input;
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
  const button = (label: string, id: string, action: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'zl-chat-action';
    b.textContent = label;
    b.title = label;
    b.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      state.action(id, action);
    });
    return b;
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
  if (state.dirty || Date.now() - (state.lastRender || 0) > 2000) {
    state.dirty = false;
    state.lastRender = Date.now();
    const pane = document.querySelector<HTMLElement>('#pane-side');
    if (pane) {
      const signature = JSON.stringify([
        data.revision,
        data.pins,
        models
          .filter(m => data.pins.includes(canonical(idOf(m))))
          .map(m => [idOf(m), nameOf(m)]),
      ]);
      let local = document.querySelector<HTMLDetailsElement>('.zl-local-pins');
      if (
        data.pins.length > 0 &&
        (!local || signature !== state.pinSignature)
      ) {
        const scroll = local?.scrollTop || 0;
        const expanded = local?.open ?? true;
        if (!local) {
          local = document.createElement('details');
          local.className = 'zl-local-pins';
          local.dataset.zlCustomers = 'pins';
          pane.before(local);
        }
        const heading = document.createElement('summary');
        heading.textContent = `本地置顶 (${data.pins.length})`;
        local.replaceChildren(heading);
        local.open = expanded;
        for (const id of data.pins) {
          const model = models.find(m => canonical(idOf(m)) === id);
          const row = document.createElement('div');
          row.className = 'zl-local-pin';
          row.dataset.chatId = id;
          const open = button('', model ? idOf(model) : id, 'open');
          open.className = 'zl-local-pin-open';
          const label = document.createElement('span');
          label.textContent = model ? nameOf(model) : id.split('@')[0];
          open.append(label, flags(id));
          const note = document.createElement('small');
          note.textContent = summary(id)?.remarkName || '';
          open.append(note);
          row.append(
            open,
            button('↑', id, 'up'),
            button('↓', id, 'down'),
            button('取消置顶', id, 'unpin'),
          );
          local.append(row);
        }
        local.scrollTop = scroll;
        state.pinSignature = signature;
      } else if (data.pins.length === 0) {
        local?.remove();
        state.pinSignature = '';
      }
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
        if (
          row.dataset.zlCustomerKey === key &&
          row.querySelector('.zl-chat-actions')
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
        row.querySelectorAll('[data-zl-customers]').forEach(n => n.remove());
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
        const actions = document.createElement('span');
        actions.className = 'zl-chat-actions';
        actions.dataset.zlCustomers = 'actions';
        actions.append(
          button(
            data.pins.includes(canonical(match)) ? '取消置顶' : '置顶',
            match,
            data.pins.includes(canonical(match)) ? 'unpin' : 'pin',
          ),
        );
        const edit = button('备注', match, 'remark');
        actions.append(edit);
        state.layouts.set(titleLine, {
          position: titleLine.style.position,
          top: titleLine.style.top,
        });
        titleLine.style.position = 'relative';
        titleLine.append(flags(match), actions);
        const note = summary(match)?.remarkName;
        if (note) {
          const line = document.createElement('div');
          line.className = 'zl-chat-note';
          line.dataset.zlCustomers = 'note';
          line.textContent = note;
          line.title = note;
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
    let active = '';
    try {
      active = idOf(
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
