// ZL-WA account groups are local UI organization, independent of workspaces.
export const DEFAULT_GROUP_ID = 'default';

export interface AccountGroup {
  id: string;
  name: string;
  collapsed: boolean;
}

export interface AccountPreferences {
  groupId?: string;
  remark?: string;
  nickname?: string;
  zoom?: number;
}

export interface AccountSidebarConfig {
  groups: AccountGroup[];
  accounts: Record<string, AccountPreferences>;
}

// Electron IPC cannot clone MobX proxies. Copy only the plain preference fields.
export function serializeAccountConfig(
  config: AccountSidebarConfig,
): AccountSidebarConfig {
  return {
    groups: config.groups.map(group => ({
      id: group.id,
      name: group.name,
      collapsed: group.collapsed,
    })),
    accounts: Object.fromEntries(
      Object.entries(config.accounts).map(([id, prefs]) => [
        id,
        {
          groupId: prefs.groupId,
          remark: prefs.remark,
          nickname: prefs.nickname,
          zoom: prefs.zoom,
        },
      ]),
    ),
  };
}

export function normalizeAccountConfig(
  raw?: Partial<AccountSidebarConfig>,
): AccountSidebarConfig {
  const seen = new Set([DEFAULT_GROUP_ID]);
  const groups: AccountGroup[] = [
    {
      id: DEFAULT_GROUP_ID,
      name: '默认分组',
      collapsed: Boolean(
        raw?.groups?.find(g => g.id === DEFAULT_GROUP_ID)?.collapsed,
      ),
    },
  ];
  for (const group of raw?.groups ?? []) {
    if (group.id && !seen.has(group.id) && group.name?.trim()) {
      seen.add(group.id);
      groups.push({
        id: group.id,
        name: group.name.trim(),
        collapsed: Boolean(group.collapsed),
      });
    }
  }
  return { groups, accounts: raw?.accounts ?? {} };
}

export function accountGroupId(
  config: AccountSidebarConfig,
  serviceId: string,
): string {
  const id = config.accounts[serviceId]?.groupId;
  return config.groups.some(group => group.id === id) ? id! : DEFAULT_GROUP_ID;
}

export function updateAccount(
  config: AccountSidebarConfig,
  id: string,
  change: AccountPreferences,
): AccountSidebarConfig {
  return {
    ...config,
    accounts: {
      ...config.accounts,
      [id]: { ...config.accounts[id], ...change },
    },
  };
}

export function removeGroup(
  config: AccountSidebarConfig,
  id: string,
): AccountSidebarConfig {
  if (id === DEFAULT_GROUP_ID) throw new Error('默认分组不能删除');
  return {
    groups: config.groups.filter(group => group.id !== id),
    accounts: Object.fromEntries(
      Object.entries(config.accounts).map(([key, value]) => [
        key,
        value.groupId === id ? { ...value, groupId: DEFAULT_GROUP_ID } : value,
      ]),
    ),
  };
}

export function nextZoom(current: number, delta: number): number {
  return Math.max(0.3, Math.min(3, Math.round((current + delta) * 10) / 10));
}
