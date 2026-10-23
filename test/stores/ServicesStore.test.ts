// ZL-WA modification: cover branding when switching to an active service.
import type ServicesStoreClass from '../../src/stores/ServicesStore';

function mockCreateDebugLogger() {
  return jest.fn();
}

function mockFilterServicesByActiveWorkspace<T>(services: T): T {
  return services;
}

jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
  },
}));

jest.mock('../../src/environment-remote', () => ({
  ferdiumVersion: 'test-version',
  userDataRecipesPath: (...segments: string[]) => segments.join('/'),
}));

jest.mock('../../src/features/workspaces', () => ({
  workspaceStore: {
    filterServicesByActiveWorkspace: mockFilterServicesByActiveWorkspace,
  },
}));
jest.mock('../../src/preload-safe-debug', () => mockCreateDebugLogger);

const ServicesStore = jest.requireActual<
  typeof import('../../src/stores/ServicesStore')
>('../../src/stores/ServicesStore').default;

describe('ServicesStore', () => {
  it('does not replace live WhatsApp unread totals with the slower DOM recipe badge', () => {
    const service = { recipe: { id: 'whatsapp' }, accountUnreadLive: true };
    const setUnreadMessageCount = jest.fn();
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.assign(store, {
      one: () => service,
      actions: { service: { setUnreadMessageCount } },
    });
    store._handleIPCMessage({
      serviceId: 'target',
      channel: 'message-counts',
      args: [{ direct: 1, indirect: 0 }],
    });
    expect(setUnreadMessageCount).not.toHaveBeenCalled();
    service.accountUnreadLive = false;
    store._handleIPCMessage({
      serviceId: 'target',
      channel: 'message-counts',
      args: [{ direct: 1, indirect: 0 }],
    });
    expect(setUnreadMessageCount).toHaveBeenCalledTimes(1);
  });

  it('manually sleeps only the selected account even when automatic hibernation is disabled', () => {
    const target = {
      canHibernate: false,
      isHibernationEnabled: false,
      isActive: true,
      name: 'Target',
      isHibernationRequested: false,
      isManuallyHibernating: false,
      lastHibernated: null,
    };
    const other = { isManuallyHibernating: false };
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.assign(store, {
      one: (id: string) => (id === 'target' ? target : other),
    });
    store._hibernate({ serviceId: 'target', manual: true });
    expect(target.isManuallyHibernating).toBe(true);
    expect(target.isHibernationRequested).toBe(true);
    expect(target.isHibernationEnabled).toBe(false);
    expect(target.isActive).toBe(true);
    expect(other.isManuallyHibernating).toBe(false);
  });

  it('does not let automatic wakeup reopen a manually closed account', () => {
    const service = {
      isManuallyHibernating: true,
      isHibernationRequested: true,
      lastHibernated: 123,
    };
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.assign(store, { one: () => service });
    store._awake({ serviceId: 'sleeping', automatic: true });
    expect(service.isManuallyHibernating).toBe(true);
    expect(service.lastHibernated).toBe(123);
  });

  it('reopens a manually sleeping account and rechecks its live login status', () => {
    const service = {
      isManuallyHibernating: true,
      isHibernationRequested: true,
      lastHibernated: 123,
      accountSnapshot: { status: 'online', phone: '8613800000000' },
    };
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.assign(store, { one: () => service });
    store._awake({ serviceId: 'sleeping' });
    expect(service.isManuallyHibernating).toBe(false);
    expect(service.isHibernationRequested).toBe(false);
    expect(service.lastHibernated).toBeNull();
    expect(service.accountSnapshot).toEqual({
      status: 'loading',
      phone: '8613800000000',
    });
  });

  it('finishes inserting the created account before callers can activate it', async () => {
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    const response = { data: { id: 'new-account' }, status: [] };
    let finishPatch!: () => void;
    const patchDone = new Promise<void>(resolve => {
      finishPatch = resolve;
    });
    Object.assign(store, {
      stores: {
        recipes: { isInstalled: () => true },
        settings: { app: { spellcheckerLanguage: 'en-US' } },
      },
      actions: { settings: { update: jest.fn() } },
      createServiceRequest: {
        execute: () => ({ promise: Promise.resolve(response) }),
      },
      allServicesRequest: { patch: jest.fn(() => patchDone) },
    });
    let completed = false;
    const creation = store
      ._createService({
        recipeId: 'whatsapp',
        serviceData: { name: 'New' },
        redirect: false,
        skipCleanup: true,
      })
      .then(() => {
        completed = true;
      });
    await Promise.resolve();
    expect(completed).toBe(false);
    finishPatch();
    await creation;
    expect(completed).toBe(true);
  });

  it('retains account cards when deleting from the backend fails', async () => {
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    const patch = jest.fn();
    Object.assign(store, {
      deleteServiceRequest: {
        execute: () => ({ promise: Promise.reject(new Error('offline')) }),
      },
      allServicesRequest: { patch },
    });
    await expect(
      store._deleteService({ serviceId: 'keep-account', redirect: null }),
    ).rejects.toThrow('offline');
    expect(patch).not.toHaveBeenCalled();
  });

  it('uses ZL-WA in the active service window title', () => {
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    Object.defineProperty(store, 'active', {
      value: { name: 'WhatsApp', dialogTitle: 'Chat', pageTitle: 'Inbox' },
    });
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      'document',
    );
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { title: '' },
    });
    try {
      store._updateWindowTitleReaction();
      expect(document.title).toBe('ZL-WA - WhatsApp - Chat - Inbox');
    } finally {
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
      } else {
        Reflect.deleteProperty(globalThis, 'document');
      }
    }
  });

  it('clears UserAgent webview reference when detaching a service', () => {
    const store = Object.create(ServicesStore.prototype) as ServicesStoreClass;
    const userAgentModel = {
      setWebviewReference: jest.fn(),
    };
    const service = {
      isAttached: true,
      userAgentModel,
      webview: { id: 'webview' },
    };

    store._detachService({ service });

    expect(userAgentModel.setWebviewReference).toHaveBeenCalledWith(null);
    expect(service.webview).toBeNull();
    expect(service.isAttached).toBe(false);
  });
});
