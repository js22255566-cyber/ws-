jest.mock('electron', () => ({ ipcRenderer: { invoke: jest.fn() } }));
jest.mock('../src/features/accountTools/bulkRuntime', () => ({
  ensureBulkLibrary: jest.fn(async () => {}),
}));

const { GroupRuntime } = require('../src/features/groups/runtime');

const ownerId = '8613800000001@c.us';
const account = () => ({
  id: 'account-a',
  recipe: { id: 'whatsapp' },
  isEnabled: true,
  isHibernating: false,
  accountSnapshot: { status: 'online', ownerId, phone: '8613800000001' },
  unreadDirectMessageCount: 0,
  unreadIndirectMessageCount: 0,
  webview: {
    executeJavaScript: jest.fn(async () => ({
      status: 'online',
      ownerId,
      unreadMessages: 7,
    })),
  },
});
const runtimeFor = (...services: any[]) =>
  new GroupRuntime({ services: { all: services } } as any);

describe('group tools refresh', () => {
  it('actually rereads enabled awake WhatsApp accounts and updates their unread state', async () => {
    const first = account();
    const sleeping = { ...account(), isHibernating: true };
    const disabled = { ...account(), isEnabled: false };
    const other = { ...account(), recipe: { id: 'telegram' } };
    expect(
      await runtimeFor(first, sleeping, disabled, other).refreshAccounts(),
    ).toEqual({ refreshed: 1, failed: 0 });
    expect(first.webview.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(first.unreadDirectMessageCount).toBe(7);
    for (const skipped of [sleeping, disabled, other])
      expect(skipped.webview.executeJavaScript).not.toHaveBeenCalled();
  });
  it('preserves historical identity on logout and reports individual refresh errors', async () => {
    const first = account();
    first.webview.executeJavaScript.mockResolvedValue({
      status: 'logged-out',
    } as any);
    const failed = account();
    failed.webview.executeJavaScript.mockRejectedValue(new Error('offline'));
    expect(await runtimeFor(first, failed).refreshAccounts()).toEqual({
      refreshed: 1,
      failed: 1,
    });
    expect(first.accountSnapshot).toMatchObject({
      status: 'logged-out',
      phone: '8613800000001',
    });
  });
  it('ignores a stale refresh result after the account view changes', async () => {
    const first = account();
    const old = first.accountSnapshot;
    first.webview.executeJavaScript.mockImplementation(async () => {
      first.webview = account().webview;
      return { status: 'logged-out' } as any;
    });
    expect(await runtimeFor(first).refreshAccounts()).toEqual({
      refreshed: 0,
      failed: 1,
    });
    expect(first.accountSnapshot).toBe(old);
  });
  it('times out a stalled group read so another refresh can be attempted', async () => {
    jest.useFakeTimers();
    try {
      const first = account();
      first.webview.executeJavaScript.mockImplementationOnce(
        () => new Promise(() => {}),
      );
      const runtime = runtimeFor(first);
      const target = { accountId: first.id, accountName: 'A', ownerId };
      const failed = runtime.list(target).then(
        () => '',
        error => error.message,
      );
      await jest.advanceTimersByTimeAsync(30_000);
      expect(await failed).toContain('读取群组超时');
      first.webview.executeJavaScript.mockResolvedValue({
        groups: [
          { id: '10001@g.us', name: 'Group', admin: true, announce: false },
        ],
      } as any);
      expect(await runtime.list(target)).toMatchObject([
        { target: '10001@g.us' },
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
