/* eslint-disable no-await-in-loop, no-continue, unicorn/consistent-function-scoping -- Serialized guest function; each group is read and mutated sequentially. */
import type * as WhatsAppAPI from '@wppconnect/wa-js/dist/whatsapp';
import type { GroupTask, GroupResult } from './types';

export async function groupGuest(request: {
  ownerId: string;
  task?: GroupTask;
  execute?: boolean;
}): Promise<
  | {
      groups: { id: string; name: string; admin: boolean; announce: boolean }[];
    }
  | GroupResult
> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前页面不是 WhatsApp');
  const page = window as any;
  const wpp = page.WPP;
  if (!wpp?.isReady || !wpp.group) throw new Error('WhatsApp 群组接口尚未就绪');
  const idOf = (id: any): string =>
    id?._serialized ||
    (id?.user && id?.server
      ? `${id.user}@${id.server}`
      : typeof id === 'string'
        ? id
        : '');
  const own = () => {
    let prefs: any;
    try {
      prefs = page.require?.('WAWebUserPrefsMeUser');
    } catch {
      /* Native WPP fallback below. */
    }
    return [
      prefs?.getMaybeMePnUser?.(),
      prefs?.getMaybeMeLidUser?.(),
      wpp.conn?.getMyUserWid?.(),
      wpp.conn?.getMyUserLid?.(),
    ]
      .map(id => idOf(id))
      .includes(request.ownerId);
  };
  if (!own())
    return {
      status: 'failed',
      message: 'WhatsApp 登录身份已变化，请重新选择账号',
      retryable: false,
    };
  // This native query requests the current joined groups rather than treating a
  // successful mutation promise or an old local model as confirmation.
  const fresh = async (): Promise<any[]> => {
    const api = wpp.whatsapp as typeof WhatsAppAPI | undefined;
    const query = api?.functions?.queryAllGroups;
    if (typeof query !== 'function')
      throw new Error('群组读取接口尚未就绪，请刷新群组后重试');
    const values = await query();
    if (!Array.isArray(values)) throw new Error('群组状态返回异常');
    return values;
  };
  if (!request.task) {
    const groups: {
      id: string;
      name: string;
      admin: boolean;
      announce: boolean;
    }[] = [];
    for (const item of await fresh()) {
      const id = idOf(item.id);
      if (!id.endsWith('@g.us') || item.isParentGroup) continue;
      if (!(await wpp.group.iAmMember(id))) continue;
      let admin = false;
      try {
        admin = Boolean(await wpp.group.iAmAdmin(id));
      } catch {
        /* Membership remains visible for leaving. */
      }
      groups.push({
        id,
        name: String(item.subject || id),
        admin,
        announce: Boolean(item.announce),
      });
    }
    return { groups };
  }
  const { task } = request;
  page.__zlGroupOperations ??= new Map();
  const operations: Map<string, any> = page.__zlGroupOperations;
  const previous = task.token ? operations.get(task.token) : undefined;
  if (previous?.pending)
    return {
      status: 'uncertain',
      message: '上次请求仍在执行，暂不重复操作',
      inFlight: true,
    };
  const collection = () => {
    try {
      return (
        page.require?.('WAWebCollections')?.Chat || wpp.whatsapp?.ChatStore
      );
    } catch {
      return wpp.whatsapp?.ChatStore;
    }
  };
  let attempted = false;
  const check = async (): Promise<GroupResult> => {
    let id = task.operation === 'join' ? task.groupId : task.target;
    let invite: any;
    if (task.operation === 'join' && !id) {
      invite = await wpp.group.getGroupInfoFromInviteCode(task.target);
      id = idOf(invite.id);
    }
    if (!id || !/^\d{1,40}(?:-\d{1,30})?@g\.us$/.test(id))
      throw new Error('群组编号未确认');
    const currentGroups = await fresh();
    const group = currentGroups.find(item => idOf(item.id) === id);
    const member = group ? Boolean(await wpp.group.iAmMember(id)) : false;
    if (task.operation === 'join') {
      if (member)
        return { status: 'success', message: '已确认加入群组', groupId: id };
      if (previous?.result?.status === 'approval' || task.status === 'approval')
        return {
          status: 'approval',
          message: '等待管理员审批，尚未加入群组',
          groupId: id,
        };
      if (!invite && task.attempts > 0)
        invite = await wpp.group.getGroupInfoFromInviteCode(task.target);
      if (
        invite?.membershipApprovalMode &&
        task.attempts > 0 &&
        (!request.execute || attempted)
      )
        return {
          status: 'uncertain',
          message: '该群需要审批，当前未确认加入；请核查进群申请',
          groupId: id,
        };
      return {
        status: 'not-done',
        message: '尚未加入群组',
        groupId: id,
        retryable: true,
      };
    }
    if (task.operation === 'leave') {
      if (member)
        return {
          status: 'not-done',
          message: '仍在群组中',
          member: true,
          groupId: id,
          retryable: true,
        };
      if (!task.deleteGroup)
        return { status: 'success', message: '已确认退出群组', groupId: id };
      const chats = collection();
      if (!chats?.get)
        return {
          status: 'uncertain',
          message: '已退出，无法核验聊天删除状态',
          groupId: id,
        };
      return chats.get(id)
        ? {
            status: 'not-done',
            message: '已退出，待删除聊天记录',
            groupId: id,
            retryable: true,
          }
        : {
            status: 'success',
            message: '已确认退出并删除群组聊天',
            groupId: id,
          };
    }
    if (!member)
      return {
        status: 'failed',
        message: '当前账号已不在此群组',
        retryable: false,
      };
    if (typeof group.announce !== 'boolean')
      return { status: 'uncertain', message: '群发言权限返回不完整，尚未确认' };
    if (group.announce === (task.operation === 'mute'))
      return {
        status: 'success',
        message:
          task.operation === 'mute'
            ? '已确认仅管理员可发言'
            : '已确认所有成员可发言',
        groupId: id,
      };
    if (!(await wpp.group.iAmAdmin(id)))
      return {
        status: 'failed',
        message: '当前账号不是群管理员，无法修改发言权限',
        retryable: false,
      };
    return {
      status: 'not-done',
      message: '发言权限尚未达到目标',
      groupId: id,
      retryable: true,
    };
  };
  let before: GroupResult;
  try {
    before = await check();
  } catch (error) {
    return {
      status:
        /invalid_invite|expired|revoked|forbidden|not_allowed|not_authorized/i.test(
          String(error),
        )
          ? 'failed'
          : 'uncertain',
      message: `核验失败：${String(error).slice(0, 500)}`,
      retryable: false,
    };
  }
  if (!request.execute || before.status !== 'not-done') return before;
  if (!own())
    return {
      status: 'failed',
      message: '账号身份已变化，操作已取消',
      retryable: false,
    };
  if (!task.token) throw new Error('执行请求缺少唯一编号');
  const current: any = { pending: true };
  operations.set(task.token, current);
  // Keep in-flight entries even when trimming completed checkpoints.
  if (operations.size > 500)
    for (const [key, value] of operations) {
      if (operations.size <= 500) break;
      if (!value.pending) operations.delete(key);
    }
  try {
    attempted = true;
    if (task.operation === 'join') {
      let joined: any;
      try {
        joined = await wpp.group.join(task.target);
      } catch (error) {
        // WA-JS 4.7.1 matches joinGroupViaInvite together with resetGroupInviteCode.
        // New WhatsApp builds split these exports; resolve the exact callable
        // from native invite modules instead of changing any server request.
        if (!/joinGroupViaInvite.*not a function/.test(String(error)))
          throw error;
        attempted = false; // The missing callable never submitted a join request.
        const verified = await check();
        if (verified.status !== 'not-done') return verified;
        const info = await wpp.group.getGroupInfoFromInviteCode(task.target);
        let native: any;
        let host: any;
        const registry = page.require?.('__debug')?.modulesMap;
        const names =
          registry instanceof Map
            ? [...registry.keys()]
            : Object.keys(registry || {});
        for (const name of names) {
          if (!/^waweb.*(?:group.*invite|invite.*group)/i.test(name)) continue;
          try {
            const module = page.require(name);
            const candidates = [module, module?.default];
            host = candidates.find(
              value => typeof value?.joinGroupViaInvite === 'function',
            );
            if (host) {
              native = host.joinGroupViaInvite;
              break;
            }
          } catch {
            /* Unloaded native modules are not a valid adapter. */
          }
        }
        if (!native)
          throw new Error('当前 WhatsApp 进群接口不兼容，请更新软件后重试');
        if (!own()) throw new Error('账号身份已变化，进群已取消');
        try {
          attempted = true;
          const result = await native.call(
            host,
            task.target,
            Boolean(info.membershipApprovalMode),
          );
          joined = {
            id: result?.gid || result?.id,
            pendingApproval: Boolean(
              result?.membershipApprovalMode ?? info.membershipApprovalMode,
            ),
          };
        } catch (nativeError: any) {
          if (
            nativeError?.name !== 'UnexpectedJoinGroupViaInviteResponse' ||
            !nativeError.gid
          )
            throw nativeError;
          joined = {
            id: nativeError.gid,
            pendingApproval: Boolean(nativeError.membershipApprovalMode),
          };
        }
      }
      const id = idOf(joined?.id || joined);
      task.groupId = id || before.groupId;
      if (joined?.pendingApproval) {
        current.result = {
          status: 'approval',
          message: '进群申请已提交，等待管理员审批',
          groupId: id || before.groupId,
        };
        return current.result;
      }
    } else if (task.operation === 'leave') {
      // A retry after an acknowledged exit only performs the missing deletion.
      if (before.member) await wpp.group.leave(task.target);
      const memberships = await fresh();
      const membership = memberships.some(item => idOf(item.id) === task.target)
        ? await wpp.group.iAmMember(task.target)
        : false;
      if (membership)
        return {
          status: 'not-done',
          message: '退出尚未确认，未删除聊天',
          retryable: true,
        };
      if (task.deleteGroup && collection()?.get(task.target))
        await wpp.chat.delete(task.target);
    } else {
      await wpp.group.setProperty(
        task.target,
        'announcement',
        task.operation === 'mute',
      );
    }
    const result = await check();
    current.result = result;
    return result;
  } catch (error) {
    // An exception can arrive after the server applied a change. Read it back
    // before allowing the queue to retry any mutation.
    try {
      const result = await check();
      if (result.status !== 'not-done') {
        current.result = result;
        return result;
      }
      return {
        ...result,
        message: `${result.message}：${String(error).slice(0, 500)}`,
      };
    } catch {
      return {
        status: 'uncertain',
        message: `请求结果未确认：${String(error).slice(0, 500)}`,
      };
    }
  } finally {
    current.pending = false;
  }
}
