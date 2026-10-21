import { observable } from 'mobx';
import {
  accountGroupId,
  normalizeAccountConfig,
  removeGroup,
  updateAccount,
  nextZoom,
  serializeAccountConfig,
} from '../src/features/accounts/state';

describe('local account organization', () => {
  it('serializes observable preferences into values Electron IPC can clone', () => {
    const config = normalizeAccountConfig(
      observable({
        groups: [{ id: 'sales', name: '销售', collapsed: false }],
        accounts: { a: { groupId: 'sales', remark: '备注', zoom: 1.1 } },
      }),
    );
    const saved = structuredClone(serializeAccountConfig(config));
    expect(saved.accounts.a.remark).toBe('备注');
    expect(saved.groups[1].name).toBe('销售');
  });
  it('places existing and unassigned sessions in the default group', () => {
    const config = normalizeAccountConfig();
    expect(config.groups[0].name).toBe('默认分组');
    expect(accountGroupId(config, 'existing-account')).toBe('default');
  });

  it('normalizes duplicate groups and falls back when a saved group is gone', () => {
    const config = normalizeAccountConfig({
      groups: [
        { id: 'sales', name: ' Sales ', collapsed: true },
        { id: 'sales', name: 'Duplicate', collapsed: false },
      ],
      accounts: { a: { groupId: 'missing' } },
    });
    expect(config.groups).toHaveLength(2);
    expect(config.groups[1]).toEqual({
      id: 'sales',
      name: 'Sales',
      collapsed: true,
    });
    expect(accountGroupId(config, 'a')).toBe('default');
  });

  it('moves only the selected account and retains its remark, alias and zoom', () => {
    const config = normalizeAccountConfig({
      groups: [{ id: 'sales', name: '销售', collapsed: false }],
      accounts: {
        a: { remark: '客户 A', nickname: '备用', zoom: 1.2 },
        b: { remark: '客户 B' },
      },
    });
    const moved = updateAccount(config, 'a', { groupId: 'sales' });
    expect(accountGroupId(moved, 'a')).toBe('sales');
    expect(moved.accounts.a).toEqual({
      remark: '客户 A',
      nickname: '备用',
      zoom: 1.2,
      groupId: 'sales',
    });
    expect(moved.accounts.b.remark).toBe('客户 B');
    expect(config.accounts.a.groupId).toBeUndefined();
  });

  it('returns accounts to default on group deletion without deleting their metadata', () => {
    const config = normalizeAccountConfig({
      groups: [{ id: 'sales', name: '销售', collapsed: false }],
      accounts: { a: { groupId: 'sales', remark: '保留' } },
    });
    const updated = removeGroup(config, 'sales');
    expect(updated.groups).toHaveLength(1);
    expect(updated.accounts.a).toEqual({ groupId: 'default', remark: '保留' });
    expect(() => removeGroup(config, 'default')).toThrow('默认分组不能删除');
  });

  it('round-trips collapse state and empty notes through saved JSON', () => {
    const original = normalizeAccountConfig({
      groups: [{ id: 'sales', name: '销售', collapsed: true }],
      accounts: { a: { groupId: 'sales', remark: '', nickname: '' } },
    });
    expect(
      normalizeAccountConfig(JSON.parse(JSON.stringify(original))),
    ).toEqual(original);
  });

  it('changes zoom in exact ten-percent steps and bounds the supported range', () => {
    expect(nextZoom(1.1, 0.1)).toBe(1.2);
    expect(nextZoom(1, -0.1)).toBe(0.9);
    expect(nextZoom(0.3, -0.1)).toBe(0.3);
    expect(nextZoom(3, 0.1)).toBe(3);
  });
});
