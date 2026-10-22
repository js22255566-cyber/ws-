import { ipcRenderer } from 'electron';
import type { RealStores } from '../../stores';
import { ensureBulkLibrary } from '../accountTools/bulkRuntime';
import GroupQueue from './GroupQueue';
import { groupGuest } from './guest';
import type { GroupChoice, GroupResult, GroupTarget, GroupTask } from './types';

export class GroupRuntime {
  queue: GroupQueue;

  constructor(private stores: RealStores) {
    this.queue = new GroupQueue({
      load: () => ipcRenderer.invoke('group-tools-load'),
      save: state => ipcRenderer.invoke('group-tools-save', state),
      check: task => this.perform(task, false),
      execute: task => this.perform(task, true),
    });
  }

  private viewFor(target: Pick<GroupTarget, 'accountId' | 'ownerId'>) {
    const service = this.stores.services.all.find(
      s => s.id === target.accountId,
    );
    if (
      !service?.webview ||
      !service.isEnabled ||
      service.isHibernating ||
      service.recipe.id !== 'whatsapp' ||
      service.accountSnapshot.status !== 'online'
    )
      throw new Error('账号已离线或休眠，请重新登录后重试');
    const owners = [
      service.accountSnapshot.ownerId,
      ...(service.accountSnapshot.ownerIds || []),
    ];
    if (!owners.includes(target.ownerId))
      throw new Error('账号登录身份已变化，请重新选择');
    return service.webview as unknown as Electron.WebviewTag;
  }

  async list(
    target: Pick<GroupTarget, 'accountId' | 'accountName' | 'ownerId'>,
  ): Promise<GroupChoice[]> {
    const view = this.viewFor(target);
    await ensureBulkLibrary(view);
    if (this.viewFor(target) !== view)
      throw new Error('账号窗口已变化，请重新读取');
    const result = await view.executeJavaScript(
      `(${groupGuest.toString()})(${JSON.stringify({ ownerId: target.ownerId })})`,
    );
    if (!Array.isArray(result.groups))
      throw new Error(result.message || '读取群组失败');
    return result.groups.map((g: any) => ({
      ...target,
      target: g.id,
      name: g.name,
      admin: g.admin,
      announce: g.announce,
    }));
  }

  private async perform(
    task: GroupTask,
    execute: boolean,
  ): Promise<GroupResult> {
    const view = this.viewFor(task);
    await ensureBulkLibrary(view);
    if (this.viewFor(task) !== view)
      throw new Error('账号窗口已变化，结果待核验');
    return view.executeJavaScript(
      `(${groupGuest.toString()})(${JSON.stringify({ ownerId: task.ownerId, task, execute })})`,
    );
  }
}
const runtimes = new WeakMap<RealStores, GroupRuntime>();

export function getGroupRuntime(stores: RealStores) {
  let runtime = runtimes.get(stores);
  if (!runtime) {
    runtime = new GroupRuntime(stores);
    runtimes.set(stores, runtime);
  }
  return runtime;
}
