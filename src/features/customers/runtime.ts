/* eslint-disable no-void -- The runtime reports asynchronous errors in its own state. */
import { ipcRenderer } from 'electron';
import type { RealStores } from '../../stores';
import { ensureBulkLibrary } from '../accountTools/bulkRuntime';
import { customerTick, readCustomerContext } from './guest';
import {
  type CustomerAction,
  type CustomerBundle,
  type CustomerContext,
  type CustomerProfile,
} from './types';

export class CustomerRuntime {
  context?: CustomerContext;

  bundle?: CustomerBundle;

  error = '';

  editor?: { owner: string; chatId: string; profile: CustomerProfile };

  listeners = new Set<() => void>();

  private timer?: ReturnType<typeof setInterval>;

  private busy = false;

  private stopped = false;

  private bundles = new Map<string, CustomerBundle>();

  private injected = new WeakMap<Electron.WebviewTag, string>();

  private contextKey = '';

  private serviceId = '';

  private actions = new Set<string>();

  private profileSaves = new Map<string, Promise<unknown>>();

  constructor(private stores: RealStores) {}

  get current() {
    return this.serviceId === this.stores.services.active?.id
      ? this.context
      : undefined;
  }

  notify() {
    for (const listener of this.listeners) listener();
  }

  private adopt(bundle: CustomerBundle) {
    for (const [identity, saved] of this.bundles)
      if (saved.owner === bundle.owner) this.bundles.set(identity, bundle);
    this.bundles.set(bundle.owner, bundle);
    if (this.bundle?.owner === bundle.owner) this.bundle = bundle;
    this.notify();
  }

  async save(
    owner: string,
    chatId: string,
    profile: CustomerProfile,
    fields = Object.keys(profile) as (keyof CustomerProfile)[],
  ) {
    const key = `${owner}:${chatId}`;
    // Keep keystrokes in order even when the user switches contacts or closes.
    const next = (this.profileSaves.get(key) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const bundle = await ipcRenderer.invoke(
          'customers-patch',
          owner,
          chatId,
          Object.fromEntries(fields.map(field => [field, profile[field]])),
        );
        this.adopt(bundle);
      });
    this.profileSaves.set(key, next);
    try {
      await next;
    } finally {
      if (this.profileSaves.get(key) === next) this.profileSaves.delete(key);
    }
  }

  async profile(owner: string, id: string): Promise<CustomerProfile> {
    await this.profileSaves.get(`${owner}:${id}`)?.catch(() => {});
    return ipcRenderer.invoke('customers-profile', owner, id);
  }

  async pin(id: string, action: 'pin' | 'unpin' | 'up' | 'down') {
    const owner = this.bundle?.owner;
    if (!owner) throw new Error('请先登录 WhatsApp');
    this.adopt(await ipcRenderer.invoke('customers-pin', owner, id, action));
  }

  async resolveAliases() {
    const { context, bundle } = this;
    const service = this.stores.services.active;
    if (
      !context?.chat ||
      !bundle ||
      !service?.webview ||
      !context.chat.id.endsWith('@lid') ||
      context.chat.aliases.length > 1
    )
      return;
    const view = service.webview;
    await ensureBulkLibrary(view);
    const aliases = await view.executeJavaScript(
      `(async()=>{const entry=await window.WPP.contact.getPnLidEntry(${JSON.stringify(context.chat.id)});return [entry.lid?._serialized,entry.phoneNumber?._serialized].filter(Boolean)})()`,
    );
    if (
      this.contextKey !==
        JSON.stringify([
          service.id,
          context.token,
          context.owners,
          context.chat,
        ]) ||
      service.webview !== view ||
      aliases.length === 0
    )
      return;
    this.adopt(
      await ipcRenderer.invoke(
        'customers-link',
        bundle.owner,
        [...new Set([context.chat.id, ...aliases])].slice(0, 2),
      ),
    );
    this.context = {
      ...context,
      chat: {
        ...context.chat,
        aliases,
        phone:
          aliases.find((id: string) => id.endsWith('@c.us'))?.split('@')[0] ||
          context.chat.phone,
      },
    };
    this.notify();
  }

  private async handle(
    action: CustomerAction,
    view: Electron.WebviewTag,
    owner: string,
  ) {
    const key = `${this.context?.token}:${action.id}`;
    if (this.actions.has(key)) return;
    this.actions.add(key);
    if (this.actions.size > 1000)
      this.actions.delete(this.actions.values().next().value!);
    if (action.action === 'open') {
      await ensureBulkLibrary(view);
      await view.executeJavaScript(
        `window.WPP.chat.openChatBottom(${JSON.stringify(action.chatId)},'Chatlist')`,
      );
    } else if (action.action === 'remark') {
      const profile = await this.profile(owner, action.chatId);
      if (this.bundle?.owner === owner) {
        this.editor = { owner, chatId: action.chatId, profile };
        this.notify();
      }
    } else
      this.adopt(
        await ipcRenderer.invoke(
          'customers-pin',
          owner,
          action.chatId,
          action.action,
        ),
      );
  }

  private async tick() {
    const service = this.stores.services.active;
    const view = service?.webview;
    if (this.serviceId !== service?.id && this.editor) {
      this.editor = undefined;
      this.notify();
    }
    if (
      !service ||
      service.recipe.id !== 'whatsapp' ||
      !view ||
      service.isHibernating ||
      service.isLoading ||
      this.busy
    )
      return;
    this.busy = true;
    try {
      const context: CustomerContext = await view.executeJavaScript(
        `(${readCustomerContext.toString()})()`,
      );
      if (
        this.stopped ||
        this.stores.services.active !== service ||
        service.webview !== view
      )
        return;
      const key = JSON.stringify([
        service.id,
        context.token,
        context.owners,
        context.chat,
      ]);
      if (context.owners.length === 0) {
        if (this.contextKey !== key) {
          this.context = context;
          this.bundle = undefined;
          this.contextKey = key;
          this.serviceId = service.id;
          this.editor = undefined;
          this.notify();
        }
        return;
      }
      if (this.contextKey !== key) {
        const identity =
          context.owners.find(id => id.endsWith('@c.us')) || context.owners[0];
        let bundle = this.bundles.get(identity);
        if (!bundle)
          bundle = await ipcRenderer.invoke('customers-bind', context.owners);
        if (
          this.stopped ||
          this.stores.services.active !== service ||
          service.webview !== view
        )
          return;
        this.bundles.set(identity, bundle!);
        this.bundles.set(bundle!.owner, bundle!);
        if (context.chat?.aliases.length)
          bundle = await ipcRenderer.invoke(
            'customers-link',
            bundle!.owner,
            context.chat.aliases,
          );
        this.context = context;
        this.bundle = bundle;
        this.contextKey = key;
        this.serviceId = service.id;
        this.error = '';
        this.editor = undefined;
        this.notify();
      }
      const bundle = this.bundle!;
      const version = `${context.token}:${bundle.owner}:${bundle.revision}`;
      const actions: CustomerAction[] = await view.executeJavaScript(
        `(${customerTick.toString()})(${this.injected.get(view) === version ? 'undefined' : JSON.stringify(bundle)})`,
      );
      this.injected.set(view, version);
      for (const action of actions) {
        if (
          this.stopped ||
          this.stores.services.active !== service ||
          service.webview !== view
        )
          break;
        // eslint-disable-next-line no-await-in-loop
        await this.handle(action, view, bundle.owner);
      }
    } catch (error) {
      this.error = String(error);
      this.notify();
    } finally {
      this.busy = false;
    }
  }

  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, 600);
  }

  dispose() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
const runtimes = new WeakMap<RealStores, CustomerRuntime>();
export function getCustomerRuntime(stores: RealStores) {
  if (!runtimes.has(stores)) runtimes.set(stores, new CustomerRuntime(stores));
  return runtimes.get(stores)!;
}
