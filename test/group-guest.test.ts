import { groupGuest } from '../src/features/groups/guest';
import type { GroupTask } from '../src/features/groups/types';

const ownerId = '8613800000001@c.us';
const groupId = '10001@g.us';
const task = (operation: GroupTask['operation'] = 'mute'): GroupTask => ({
  id: 'task',
  accountId: 'account-a',
  accountName: 'A',
  ownerId,
  target: operation === 'join' ? 'Abcdefghijklmnopqrstuv' : groupId,
  name: '测试群',
  operation,
  status: 'running',
  attempts: 1,
  message: '',
  token: 'token-a',
  deleteGroup: true,
});
describe('native group adapter verification', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let groups: any[];
  let chats: Map<string, any>;
  let wpp: any;
  beforeEach(() => {
    groups = [{ id: groupId, subject: '测试群', announce: false }];
    chats = new Map([[groupId, {}]]);
    wpp = {
      isReady: true,
      conn: { getMyUserWid: () => ownerId },
      whatsapp: {
        queryAllGroups: jest.fn(async () => structuredClone(groups)),
        ChatStore: { get: id => chats.get(id) },
      },
      group: {
        iAmMember: jest.fn(async id => groups.some(g => g.id === id)),
        iAmAdmin: jest.fn(async () => true),
        getGroupInfoFromInviteCode: jest.fn(async () => ({
          id: groupId,
          membershipApprovalMode: false,
        })),
        setProperty: jest.fn(async (id, _prop, value) => {
          groups.find(g => g.id === id).announce = value;
          return true;
        }),
        leave: jest.fn(async id => {
          groups = groups.filter(g => g.id !== id);
        }),
        join: jest.fn(async () => {
          groups = [{ id: groupId, announce: false }];
          return { id: groupId, pendingApproval: false };
        }),
      },
      chat: {
        delete: jest.fn(async id => {
          chats.delete(id);
          return { status: 200 };
        }),
      },
    };
    for (const [key, value] of Object.entries({
      location: { hostname: 'web.whatsapp.com' },
      window: { WPP: wpp },
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  });
  afterEach(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  it('reads server group state and verifies the final announcement flag', async () => {
    const result = await groupGuest({ ownerId, task: task(), execute: true });
    expect(result).toMatchObject({ status: 'success', groupId });
    expect(wpp.group.setProperty).toHaveBeenCalledWith(
      groupId,
      'announcement',
      true,
    );
    expect(
      wpp.whatsapp.queryAllGroups.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });
  it('accepts an applied change even when the request later throws', async () => {
    wpp.group.setProperty.mockImplementation(async () => {
      groups[0].announce = true;
      throw new Error('response lost');
    });
    expect(
      await groupGuest({ ownerId, task: task(), execute: true }),
    ).toMatchObject({ status: 'success' });
  });
  it('does not call setProperty without admin rights', async () => {
    wpp.group.iAmAdmin.mockResolvedValue(false);
    expect(
      await groupGuest({ ownerId, task: task(), execute: true }),
    ).toMatchObject({ status: 'failed', retryable: false });
    expect(wpp.group.setProperty).not.toHaveBeenCalled();
  });
  it('only deletes after confirmed exit and retries deletion without leaving again', async () => {
    wpp.chat.delete.mockRejectedValueOnce(new Error('temporary failure'));
    const first = await groupGuest({
      ownerId,
      task: task('leave'),
      execute: true,
    });
    expect(first).toMatchObject({ status: 'not-done' });
    expect(wpp.group.leave).toHaveBeenCalledTimes(1);
    const next = { ...task('leave'), token: 'token-b', attempts: 2 };
    expect(
      await groupGuest({ ownerId, task: next, execute: true }),
    ).toMatchObject({ status: 'success' });
    expect(wpp.group.leave).toHaveBeenCalledTimes(1);
    expect(wpp.chat.delete).toHaveBeenCalledTimes(2);
  });
  it('does not delete when leaving is not confirmed', async () => {
    wpp.group.leave.mockImplementation(async () => {});
    expect(
      await groupGuest({ ownerId, task: task('leave'), execute: true }),
    ).toMatchObject({ status: 'not-done' });
    expect(wpp.chat.delete).not.toHaveBeenCalled();
  });
  it('records approval pending separately and does not repeat the invitation request', async () => {
    groups = [];
    wpp.group.join.mockResolvedValue({ id: groupId, pendingApproval: true });
    const current = task('join');
    expect(
      await groupGuest({ ownerId, task: current, execute: true }),
    ).toMatchObject({ status: 'approval' });
    expect(
      await groupGuest({ ownerId, task: current, execute: true }),
    ).toMatchObject({ status: 'approval' });
    expect(wpp.group.join).toHaveBeenCalledTimes(1);
  });
  it('does not rejoin an existing group', async () => {
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({ status: 'success' });
    expect(wpp.group.join).not.toHaveBeenCalled();
  });
  it('refuses mutations when the WhatsApp owner changes', async () => {
    wpp.conn.getMyUserWid = () => '8613800000002@c.us';
    expect(
      await groupGuest({ ownerId, task: task(), execute: true }),
    ).toMatchObject({ status: 'failed', retryable: false });
    expect(wpp.whatsapp.queryAllGroups).not.toHaveBeenCalled();
  });
  it('keeps in-flight requests visible rather than repeating them', async () => {
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(r => {
      started = r;
    });
    wpp.group.setProperty.mockImplementation(async () => {
      started();
      await new Promise<void>(r => {
        finish = r;
      });
      groups[0].announce = true;
    });
    const current = task();
    const execution = groupGuest({ ownerId, task: current, execute: true });
    await ready;
    expect(await groupGuest({ ownerId, task: current })).toMatchObject({
      status: 'uncertain',
      inFlight: true,
    });
    finish();
    await expect(execution).resolves.toMatchObject({ status: 'success' });
    expect(wpp.group.setProperty).toHaveBeenCalledTimes(1);
  });
  it('does not count a listed pending group as membership', async () => {
    wpp.group.iAmMember.mockResolvedValue(false);
    wpp.group.join.mockResolvedValue({ id: groupId, pendingApproval: true });
    expect(
      await groupGuest({ ownerId, task: task('join'), execute: true }),
    ).toMatchObject({ status: 'approval' });
  });
  it('does not assume success or mutate when fresh state cannot be read', async () => {
    wpp.whatsapp.queryAllGroups.mockRejectedValue(new Error('offline'));
    expect(
      await groupGuest({ ownerId, task: task(), execute: true }),
    ).toMatchObject({ status: 'uncertain' });
    expect(wpp.group.setProperty).not.toHaveBeenCalled();
  });
});
