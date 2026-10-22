/* eslint-disable unicorn/consistent-function-scoping -- Serialized guest functions keep their helpers local. */
// WhatsApp-specific integration stays outside the pinned upstream recipes.
// Functions executed in a guest page must be self-contained (no outer closures).
export interface AccountSnapshot {
  status: 'online' | 'logged-out' | 'error' | 'loading';
  nickname?: string;
  phone?: string;
  avatar?: string;
  ownerId?: string;
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
  const serialized = (id: any): string =>
    id?._serialized ||
    (id?.user
      ? `${id.user}@${id.server || 'c.us'}`
      : typeof id === 'string'
        ? id
        : '');
  const ownerId = serialized(me);
  const oldCache = page.__zlWaOwnAvatar;
  const cache =
    oldCache?.ownerId === ownerId
      ? oldCache
      : { ownerId, url: '', data: undefined, attempted: 0, queried: 0 };
  page.__zlWaOwnAvatar = cache;
  let ownImage = document.querySelector<HTMLImageElement>(
    '[data-testid="menu-bar-profile"] img, [data-testid="menu-bar-avatar"] img, [aria-label="Profile"] img, [aria-label="个人资料"] img, [title="Profile"] img, [title="个人资料"] img, #side header img',
  );
  if (ownImage?.closest?.('#main, [role="dialog"]')) ownImage = null;
  const collection =
    module('WAWebProfilePicThumbCollection')?.ProfilePicThumb ||
    module('WAWebCollections')?.ProfilePicThumb ||
    page.WPP?.whatsapp?.ProfilePicThumbStore;
  const identities = [
    me,
    module('WAWebUserPrefsMeUser')?.getMaybeMeLidUser?.(),
  ].filter(Boolean);
  let thumb: any;
  for (const identity of identities) {
    try {
      thumb =
        collection?.get?.(identity) || collection?.get?.(serialized(identity));
    } catch {
      /* Wait for this identity's thumbnail. */
    }
    if (thumb) break;
  }
  let avatarUrl =
    thumb?.img ||
    thumb?.imgFull ||
    thumb?.previewEurl ||
    thumb?.eurl ||
    ownImage?.currentSrc ||
    ownImage?.src ||
    '';
  if (!avatarUrl && ownerId && Date.now() - cache.queried > 60_000) {
    cache.queried = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request =
        collection?.find && me
          ? Reflect.apply(collection.find, collection, [me])
          : page.WPP?.isReady && page.WPP.contact?.getProfilePictureUrl
            ? page.WPP.contact.getProfilePictureUrl(ownerId, false)
            : undefined;
      if (request) {
        const found: any = await Promise.race([
          request,
          new Promise<null>(resolve => {
            timer = setTimeout(() => resolve(null), 2500);
          }),
        ]);
        avatarUrl =
          typeof found === 'string'
            ? found
            : found?.img ||
              found?.imgFull ||
              found?.previewEurl ||
              found?.eurl ||
              '';
      }
    } catch {
      /* A temporary profile lookup failure must not clear the cached picture. */
    } finally {
      clearTimeout(timer);
    }
  }
  let avatar: string | undefined = ownerId ? cache.data : undefined;
  // Keep a verified own-account image across transient DOM removals / expired
  // blob URLs. Never use the current conversation header as an avatar source.
  if (
    ownerId &&
    avatarUrl &&
    (cache.url !== avatarUrl || !cache.data) &&
    Date.now() - cache.attempted > 10_000
  ) {
    cache.attempted = Date.now();
    let data: string | undefined;
    try {
      if (avatarUrl.startsWith('data:image/') && avatarUrl.length < 700_000)
        data = avatarUrl;
      else {
        const response = await fetch(avatarUrl, {
          signal: AbortSignal.timeout(4000),
        });
        const blob = await response.blob();
        if (
          response.ok &&
          blob.type.startsWith('image/') &&
          blob.size < 512_000
        )
          data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener(
              'load',
              () => resolve(String(reader.result)),
              { once: true },
            );
            reader.addEventListener('error', reject, { once: true });
            reader.readAsDataURL(blob);
          });
      }
    } catch {
      /* Some loaded images cannot be fetched again after their blob URL expires. */
    }
    if (
      !data &&
      ownImage?.complete &&
      ownImage.naturalWidth > 0 &&
      [ownImage.src, ownImage.currentSrc].includes(avatarUrl)
    ) {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(
          1,
          160 / Math.max(ownImage.naturalWidth, ownImage.naturalHeight),
        );
        canvas.width = Math.max(1, Math.round(ownImage.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(ownImage.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(ownImage, 0, 0, canvas.width, canvas.height);
          data = canvas.toDataURL('image/png');
        }
      } catch {
        /* Cross-origin images without permission keep the previous own avatar. */
      }
    }
    if (data && data.length < 700_000 && page.__zlWaOwnAvatar === cache) {
      cache.url = avatarUrl;
      cache.data = data;
      avatar = data;
    }
  }
  const latestOwner = serialized(
    module('WAWebUserPrefsMeUser')?.getMaybeMePnUser?.() ??
      module('WAWebConnModel')?.Conn?.wid,
  );
  if (ownerId && latestOwner && latestOwner !== ownerId)
    return { status: 'loading' };
  return {
    status: 'online',
    ownerId: ownerId || undefined,
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

// Host snapshots can briefly omit a picture while WhatsApp remounts its DOM.
// Reuse it only when both snapshots prove the same logged-in owner.
export function mergeAccountSnapshot(
  previous: AccountSnapshot,
  next: AccountSnapshot,
): AccountSnapshot {
  return next.status === 'online' &&
    next.ownerId &&
    next.ownerId === previous.ownerId &&
    !next.avatar &&
    previous.avatar
    ? { ...next, avatar: previous.avatar }
    : next;
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
