// WhatsApp-specific integration stays outside the pinned upstream recipes.
// Functions executed in a guest page must be self-contained (no outer closures).
export interface AccountSnapshot {
  status: 'online' | 'logged-out' | 'error' | 'loading';
  nickname?: string;
  phone?: string;
  avatar?: string;
  unreadMessages?: number;
}

export async function readWhatsAppSnapshot(): Promise<AccountSnapshot> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    return { status: 'error' };
  const page = window as any;
  const module = (name: string): any => {
    try {
      return page.require?.(name);
    } catch {
      return undefined;
    }
  };
  const socket = module('WAWebSocketModel')?.Socket;
  const socketState = socket?.state;
  if (
    ['UNPAIRED', 'UNPAIRED_IDLE'].includes(socketState) ||
    document.querySelector(
      '[data-ref] canvas, [data-testid="qrcode"], [data-testid="link-device-phone-number-code-screen"]',
    )
  )
    return { status: 'logged-out' };
  if (
    !navigator.onLine ||
    [
      'CONFLICT',
      'TIMEOUT',
      'PROXYBLOCK',
      'TOS_BLOCK',
      'SMB_TOS_BLOCK',
    ].includes(socketState) ||
    document.querySelector(
      '[data-icon="alert-computer"], [data-icon="alert-phone"], [data-testid="alert-computer"]',
    )
  )
    return { status: 'error' };

  const loggedIn =
    socketState === 'CONNECTED' ||
    Boolean(document.querySelector('#pane-side, #side'));
  if (!loggedIn) return { status: 'loading' };
  const conn = module('WAWebConnModel')?.Conn;
  const me = module('WAWebUserPrefsMeUser')?.getMaybeMePnUser?.() ?? conn?.wid;
  // A WhatsApp LID is an opaque identity, not a telephone number.
  const rawPhone =
    me?.server === 'lid'
      ? ''
      : (me?.user ?? localStorage.getItem('last-wid') ?? '');
  const phone = String(rawPhone)
    .replaceAll('"', '')
    .split('@')[0]
    .split(':')[0];
  const ownImage = document.querySelector<HTMLImageElement>(
    '[aria-label="Profile"] img, [aria-label="个人资料"] img, #side header img',
  );
  const thumb =
    me && module('WAWebProfilePicThumbCollection')?.ProfilePicThumb?.get?.(me);
  const avatarUrl = ownImage?.src || thumb?.img || '';
  let avatar: string | undefined;
  // A blob URL from a guest Session cannot be loaded by the host renderer.
  // Convert our own profile image locally; never use a selected contact's avatar.
  if (avatarUrl) {
    const cache = page.__zlWaOwnAvatar;
    if (cache?.url === avatarUrl) avatar = cache.data;
    else {
      try {
        const response = await fetch(avatarUrl, {
          signal: AbortSignal.timeout(4000),
        });
        const blob = await response.blob();
        if (
          response.ok &&
          blob.type.startsWith('image/') &&
          blob.size < 512_000
        ) {
          avatar = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener(
              'load',
              () => resolve(String(reader.result)),
              { once: true },
            );
            reader.addEventListener('error', reject, { once: true });
            reader.readAsDataURL(blob);
          });
          page.__zlWaOwnAvatar = { url: avatarUrl, data: avatar };
        }
      } catch {
        /* Missing avatars use a local placeholder. */
      }
    }
  }
  return {
    status: 'online',
    nickname:
      typeof conn?.pushname === 'string'
        ? conn.pushname.slice(0, 100)
        : undefined,
    phone:
      !String(rawPhone).includes('@lid') && /^\d{6,16}$/.test(phone)
        ? phone
        : undefined,
    avatar,
    unreadMessages: (() => {
      const collection = module('WAWebCollections')?.Chat;
      const chats = collection?.getModelsArray?.() ?? collection?.models;
      if (!Array.isArray(chats)) return 0;
      const now = Date.now() / 1000;
      let count = 0;
      for (const chat of chats) {
        const server =
          chat.id?.server ||
          String(chat.id?._serialized || chat.id || '').split('@')[1];
        const expiration = Number(chat.muteExpiration ?? 0);
        const muted =
          chat.isAutoMuted === true ||
          chat.isMuted === true ||
          expiration === -1 ||
          expiration > now;
        count +=
          !chat.archive &&
          !chat.isArchived &&
          !muted &&
          !chat.isPSA &&
          ['c.us', 'lid', 'g.us'].includes(server) &&
          Number.isFinite(chat.unreadCount) &&
          chat.unreadCount > 0
            ? Math.floor(chat.unreadCount)
            : 0;
      }
      return count;
    })(),
  };
}

export async function markAllWhatsAppRead(): Promise<{
  read: number;
  failed: number;
}> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前会话不是 WhatsApp');
  const page = window as any;
  const chats = page.require?.('WAWebCollections')?.Chat;
  const sendSeen = page.require?.('WAWebUpdateUnreadChatAction')?.sendSeen;
  if (!chats || typeof sendSeen !== 'function')
    throw new Error(
      '当前 WhatsApp 网页版本不支持全部已读，请在 WhatsApp 内操作',
    );
  const models = chats.getModelsArray?.() ?? chats.models;
  if (!Array.isArray(models)) throw new Error('聊天列表尚未准备好');
  let read = 0;
  let failed = 0;
  for (const chat of models.filter(
    chat => chat.unreadCount > 0 || chat.unreadCount === -1,
  )) {
    try {
      // Process chats sequentially to avoid a burst of read-receipt requests.
      // eslint-disable-next-line no-await-in-loop
      await sendSeen({ chat, threadId: undefined });
      read += 1;
    } catch {
      failed += 1;
    }
  }
  return { read, failed };
}

export function accountStatus(service: {
  isEnabled: boolean;
  isLoading: boolean;
  isError: boolean;
  hasCrashed: boolean;
  isHibernating: boolean;
  accountSnapshot: AccountSnapshot;
}): AccountSnapshot['status'] {
  if (
    !service.isEnabled ||
    service.isError ||
    service.hasCrashed ||
    service.isHibernating
  )
    return 'error';
  if (service.isLoading) return 'loading';
  return service.accountSnapshot.status;
}
