// ZL-WA grouped account cards. All preferences are persisted through app settings.
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Menu,
  MenuItem,
  TextField,
} from '@mui/material';
import {
  mdiAccountEditOutline,
  mdiCheckAll,
  mdiChevronDown,
  mdiChevronRight,
  mdiCogOutline,
  mdiDeleteOutline,
  mdiDotsVertical,
  mdiFolderMoveOutline,
  mdiFullscreen,
  mdiMagnifyMinusOutline,
  mdiMagnifyPlusOutline,
  mdiPencilOutline,
  mdiPlus,
  mdiReload,
  mdiWeatherNight,
} from '@mdi/js';
import { observer } from 'mobx-react';
import { runInAction } from 'mobx';
import { Component } from 'react';
import type { StoresProps } from '../../@types/ferdium-components.types';
import Icon from '../../components/ui/icon';
import workspaceActions from '../workspaces/actions';
import { workspaceStore } from '../workspaces';
import type Service from '../../models/Service';
import {
  accountGroupId,
  DEFAULT_GROUP_ID,
  nextZoom,
  normalizeAccountConfig,
  removeGroup,
  updateAccount,
  serializeAccountConfig,
  type AccountSidebarConfig,
} from './state';
import { accountStatus, markAllWhatsAppRead } from './whatsapp';

type DialogKind =
  | 'group'
  | 'remark'
  | 'nickname'
  | 'move'
  | 'delete'
  | 'rename-group'
  | 'delete-group';
interface State {
  dialog: { kind: DialogKind; id: string; value: string } | null;
  menu: { id: string; anchor: HTMLElement; group?: boolean } | null;
  notice: string;
  busy: boolean;
}

const statusLabels = {
  online: '已登录',
  'logged-out': '未登录',
  error: '异常 / 已停用或休眠',
  loading: '连接中 / 状态待确认',
};
const dialogTitles: Record<DialogKind, string> = {
  group: '新增分组',
  remark: '编辑备注',
  nickname: '修改昵称',
  move: '移动分组',
  delete: '删除会话',
  'rename-group': '重命名分组',
  'delete-group': '删除分组',
};

@observer
export default class AccountSidebar extends Component<StoresProps, State> {
  constructor(props: StoresProps) {
    super(props);
    this.state = { dialog: null, menu: null, notice: '', busy: false };
  }

  get config(): AccountSidebarConfig {
    return normalizeAccountConfig(
      this.props.stores.settings.app.accountSidebar,
    );
  }

  save = async (config: AccountSidebarConfig): Promise<void> => {
    await this.props.stores.settings._update({
      type: 'app',
      data: { accountSidebar: serializeAccountConfig(config) },
    });
  };

  perform = async (operation: () => Promise<void>): Promise<void> => {
    this.setState({ busy: true, notice: '', menu: null });
    try {
      await operation();
    } catch (error) {
      this.setState({
        notice: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.setState({ busy: false });
    }
  };

  openDialog = (kind: DialogKind, id = '', value = ''): void => {
    this.setState({ dialog: { kind, id, value }, menu: null, notice: '' });
  };

  activate = (serviceId: string): void => {
    if (workspaceStore.isAnyWorkspaceActive) workspaceActions.deactivate();
    // Save the selection atomically: app-preference updates also rerun the
    // upstream active-service mapping reaction.
    runInAction(() => {
      this.props.actions.settings.update({
        type: 'service',
        data: { activeService: serviceId },
      });
      this.props.actions.service.setActive({ serviceId });
    });
  };

  select = (service: Service): void => {
    this.perform(async () => {
      if (!service.isEnabled) {
        await this.props.stores.services._updateService({
          serviceId: service.id,
          serviceData: { isEnabled: true },
          redirect: false,
        });
      }
      this.activate(service.id);
    });
  };

  toggleSleep = (service: Service): void => {
    if (service.isHibernating || !service.isEnabled) {
      this.select(service);
    } else {
      this.perform(async () => {
        this.props.stores.services._hibernate({
          serviceId: service.id,
          manual: true,
        });
      });
    }
  };

  addSession = (groupId: string): void => {
    if (!this.props.stores.services.allServicesRequest.wasExecuted) return;
    this.perform(async () => {
      const { services } = this.props.stores;
      await services._createService({
        recipeId: 'whatsapp',
        serviceData: {
          name: `WhatsApp ${services.all.filter(s => s.recipe.id === 'whatsapp').length + 1}`,
          isEnabled: true,
        },
        redirect: false,
      });
      const id = services.createServiceRequest.result?.data?.id;
      if (!id)
        throw new Error('会话创建结果不完整，请检查“原有服务”中的会话列表');
      const { config } = this;
      config.groups = config.groups.map(g =>
        g.id === groupId ? { ...g, collapsed: false } : g,
      );
      await this.save(updateAccount(config, id, { groupId }));
      this.activate(id);
    });
  };

  submitDialog = (): void => {
    const { dialog } = this.state;
    if (!dialog) return;
    this.perform(async () => {
      let { config } = this;
      const value = dialog.value.trim();
      switch (dialog.kind) {
        case 'group':
        case 'rename-group': {
          if (!value) throw new Error('请输入分组名称');
          if (config.groups.some(g => g.name === value && g.id !== dialog.id))
            throw new Error('分组名称已存在');
          config = {
            ...config,
            groups:
              dialog.kind === 'group'
                ? [
                    ...config.groups,
                    { id: crypto.randomUUID(), name: value, collapsed: false },
                  ]
                : config.groups.map(g =>
                    g.id === dialog.id ? { ...g, name: value } : g,
                  ),
          };
          break;
        }
        case 'delete-group': {
          config = removeGroup(config, dialog.id);
          break;
        }
        case 'move': {
          if (!config.groups.some(g => g.id === value))
            throw new Error('所选分组已不存在');
          config = updateAccount(config, dialog.id, { groupId: value });
          break;
        }
        case 'remark': {
          config = updateAccount(config, dialog.id, { remark: value });
          break;
        }
        case 'nickname': {
          config = updateAccount(config, dialog.id, { nickname: value });
          break;
        }
        case 'delete': {
          await this.props.stores.services._deleteService({
            serviceId: dialog.id,
            redirect: null,
          });
          config = {
            ...config,
            accounts: Object.fromEntries(
              Object.entries(config.accounts).filter(
                ([id]) => id !== dialog.id,
              ),
            ),
          };
          break;
        }
        default: {
          break;
        }
      }
      await this.save(config);
      this.setState({ dialog: null });
    });
  };

  zoom = (service: Service, delta?: number): void => {
    this.perform(async () => {
      const view = service.webview as unknown as Electron.WebviewTag | null;
      const current = this.config.accounts[service.id]?.zoom ?? 1;
      const zoom = delta === undefined ? 1 : nextZoom(current, delta);
      if (!view) throw new Error('请先打开会话，再调整窗口');
      view.setZoomFactor(zoom);
      if (delta === undefined)
        await view.executeJavaScript('window.scrollTo(0, 0)');
      await this.save(updateAccount(this.config, service.id, { zoom }));
      this.setState({ notice: `会话缩放已设置为 ${Math.round(zoom * 100)}%` });
    });
  };

  markRead = (service: Service): void => {
    this.perform(async () => {
      if (!service.webview || accountStatus(service) !== 'online')
        throw new Error('请先登录并连接 WhatsApp');
      const result = await (
        service.webview as unknown as Electron.WebviewTag
      ).executeJavaScript(`(${markAllWhatsAppRead.toString()})()`);
      this.setState({
        notice: result.failed
          ? `已标记 ${result.read} 个聊天，${result.failed} 个失败，请稍后重试`
          : `已将 ${result.read} 个未读聊天标记为已读`,
      });
    });
  };

  renderCard(service: Service) {
    const prefs = this.config.accounts[service.id] ?? {};
    const profile = service.accountSnapshot;
    const isWhatsApp = service.recipe.id === 'whatsapp';
    const status = accountStatus(service);
    const sleeping = service.isHibernating;
    const statusLabel = sleeping
      ? '已休眠（会话页面已关闭）'
      : statusLabels[status];
    const name = prefs.nickname || profile.nickname || service.name;
    const unread =
      service.unreadDirectMessageCount + service.unreadIndirectMessageCount;
    return (
      <article
        key={service.id}
        className={`account-card ${service.isActive ? 'is-active' : ''}`}
        data-service-id={service.id}
      >
        <button
          type="button"
          className="account-card__select"
          onClick={() => this.select(service)}
          aria-label={`打开 ${name}`}
        >
          <span className="account-card__portrait">
            {profile.avatar ? (
              <img src={profile.avatar} alt={`${name} 的头像`} />
            ) : (
              <span className="account-card__initial">{name.slice(0, 1)}</span>
            )}
            <span
              className={`account-status account-status--${status}`}
              role="img"
              aria-label={statusLabel}
              title={statusLabel}
            />
          </span>
          <span className="account-card__identity">
            <span className="account-card__name" title={name}>
              {name}
            </span>
            <span className="account-card__phone">
              {isWhatsApp ? profile.phone || '号码待同步' : service.recipe.name}
            </span>
          </span>
          {unread > 0 && (
            <span className="account-card__unread">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
        <button
          type="button"
          className="account-card__remark"
          onClick={() =>
            this.openDialog('remark', service.id, prefs.remark ?? '')
          }
          title="编辑备注"
        >
          <Icon icon={mdiPencilOutline} size={0.6} />
          <span>{prefs.remark || '暂无备注'}</span>
        </button>
        {isWhatsApp && (
          <button
            type="button"
            className={`account-card__sleep ${sleeping ? 'is-sleeping' : ''}`}
            disabled={this.state.busy}
            aria-pressed={sleeping}
            aria-label={`${name}：${sleeping || !service.isEnabled ? '打开会话' : '休眠会话'}`}
            title={
              sleeping || !service.isEnabled
                ? '打开会话（恢复登录页面）'
                : '休眠会话（关闭页面，保留登录）'
            }
            onClick={() => this.toggleSleep(service)}
          >
            <Icon icon={mdiWeatherNight} size={0.75} />
          </button>
        )}
        <button
          type="button"
          className="account-card__more"
          aria-label={`${name} 的会话菜单`}
          onClick={event =>
            this.setState({
              menu: { id: service.id, anchor: event.currentTarget },
            })
          }
        >
          <Icon icon={mdiDotsVertical} size={0.8} />
        </button>
      </article>
    );
  }

  renderMenu() {
    const { menu, busy } = this.state;
    const service =
      menu && !menu.group ? this.props.stores.services.one(menu.id) : undefined;
    const group = menu?.group
      ? this.config.groups.find(g => g.id === menu.id)
      : undefined;
    const item = (
      label: string,
      icon: string,
      action: () => void,
      disabled = false,
    ) => (
      <MenuItem key={label} disabled={busy || disabled} onClick={action}>
        <Icon icon={icon} size={0.8} />
        <span>{label}</span>
      </MenuItem>
    );
    return (
      <Menu
        anchorEl={menu?.anchor}
        open={Boolean(menu)}
        onClose={() => this.setState({ menu: null })}
        className="account-context-menu"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {service
          ? [
              item(
                '刷新会话',
                mdiReload,
                () => {
                  this.setState({ menu: null });
                  this.props.actions.service.reload({ serviceId: service.id });
                },
                !service.webview,
              ),
              item(
                '全部已读',
                mdiCheckAll,
                () => this.markRead(service),
                service.recipe.id !== 'whatsapp' ||
                  accountStatus(service) !== 'online',
              ),
              item(
                '放大10%',
                mdiMagnifyPlusOutline,
                () => this.zoom(service, 0.1),
                !service.webview,
              ),
              item(
                '缩小10%',
                mdiMagnifyMinusOutline,
                () => this.zoom(service, -0.1),
                !service.webview,
              ),
              item(
                '重置窗口',
                mdiFullscreen,
                () => this.zoom(service),
                !service.webview,
              ),
              item('移动分组', mdiFolderMoveOutline, () =>
                this.openDialog(
                  'move',
                  service.id,
                  accountGroupId(this.config, service.id),
                ),
              ),
              item('修改昵称', mdiAccountEditOutline, () =>
                this.openDialog(
                  'nickname',
                  service.id,
                  this.config.accounts[service.id]?.nickname ?? '',
                ),
              ),
              item('删除会话', mdiDeleteOutline, () =>
                this.openDialog('delete', service.id),
              ),
            ]
          : group
            ? [
                item(
                  '新增会话',
                  mdiPlus,
                  () => this.addSession(group.id),
                  !this.props.stores.services.allServicesRequest.wasExecuted,
                ),
                item(
                  '重命名分组',
                  mdiPencilOutline,
                  () => this.openDialog('rename-group', group.id, group.name),
                  group.id === DEFAULT_GROUP_ID,
                ),
                item(
                  '删除分组',
                  mdiDeleteOutline,
                  () => this.openDialog('delete-group', group.id),
                  group.id === DEFAULT_GROUP_ID,
                ),
              ]
            : null}
      </Menu>
    );
  }

  renderDialog() {
    const { dialog, busy, notice } = this.state;
    if (!dialog) return null;
    const confirming =
      dialog.kind === 'delete' || dialog.kind === 'delete-group';
    return (
      <Dialog
        className="account-dialog"
        open
        onClose={() => {
          if (!busy) this.setState({ dialog: null });
        }}
        fullWidth
        maxWidth="xs"
      >
        <form
          onSubmit={event => {
            event.preventDefault();
            this.submitDialog();
          }}
        >
          <DialogTitle>{dialogTitles[dialog.kind]}</DialogTitle>
          <DialogContent>
            {confirming ? (
              <p>
                {dialog.kind === 'delete'
                  ? '删除后将移除此会话及其本地登录数据。确定删除吗？'
                  : '分组中的会话将移到默认分组，不会删除账号。确定删除吗？'}
              </p>
            ) : (
              <TextField
                autoFocus
                fullWidth
                margin="dense"
                label={
                  dialog.kind === 'move'
                    ? '选择分组'
                    : dialogTitles[dialog.kind]
                }
                select={dialog.kind === 'move'}
                SelectProps={{
                  MenuProps: { className: 'account-context-menu' },
                }}
                value={dialog.value}
                onChange={event =>
                  this.setState({
                    dialog: { ...dialog, value: event.target.value },
                  })
                }
                inputProps={{ maxLength: dialog.kind === 'remark' ? 200 : 60 }}
                helperText={
                  dialog.kind === 'nickname'
                    ? '仅修改本地显示昵称；留空恢复 WhatsApp 昵称。'
                    : dialog.kind === 'remark'
                      ? '留空显示“暂无备注”。'
                      : undefined
                }
              >
                {dialog.kind === 'move'
                  ? this.config.groups.map(group => (
                      <MenuItem value={group.id} key={group.id}>
                        {group.name}
                      </MenuItem>
                    ))
                  : null}
              </TextField>
            )}
            {notice && (
              <p role="alert" className="account-dialog-error">
                {notice}
              </p>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => this.setState({ dialog: null })}
              disabled={busy}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="contained"
              color={confirming ? 'error' : 'primary'}
              disabled={busy}
            >
              {confirming ? '删除' : '保存'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    );
  }

  render() {
    const { config } = this;
    const { services } = this.props.stores;
    return (
      <aside className="account-sidebar" aria-label="账号分组">
        <button
          type="button"
          className="account-sidebar__new-group"
          disabled={this.state.busy}
          onClick={() => this.openDialog('group')}
        >
          <Icon icon={mdiPlus} size={0.9} />
          新增分组
        </button>
        {this.state.notice && !this.state.dialog && (
          <div className="account-sidebar__notice" role="status">
            {this.state.notice}
            <button
              type="button"
              onClick={() => this.setState({ notice: '' })}
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        )}
        <div className="account-sidebar__groups">
          {config.groups.map(group => {
            const accounts = services.all.filter(
              service =>
                !service.isTodosService &&
                accountGroupId(config, service.id) === group.id,
            );
            return (
              <section
                key={group.id}
                className="account-group"
                data-group-id={group.id}
              >
                <header className="account-group__header">
                  <button
                    type="button"
                    className="account-group__toggle"
                    aria-expanded={!group.collapsed}
                    onClick={() => {
                      this.perform(() =>
                        this.save({
                          ...config,
                          groups: config.groups.map(g =>
                            g.id === group.id
                              ? { ...g, collapsed: !g.collapsed }
                              : g,
                          ),
                        }),
                      );
                    }}
                  >
                    <Icon
                      icon={group.collapsed ? mdiChevronRight : mdiChevronDown}
                      size={0.7}
                    />
                    <span>
                      {group.name}（{accounts.length}）
                    </span>
                  </button>
                  <button
                    type="button"
                    className="account-group__add"
                    disabled={
                      this.state.busy ||
                      !this.props.stores.services.allServicesRequest.wasExecuted
                    }
                    onClick={() => this.addSession(group.id)}
                    aria-label={`在${group.name}新增会话`}
                  >
                    <Icon icon={mdiPlus} size={0.65} />
                    新增会话
                  </button>
                  <button
                    type="button"
                    className="account-group__more"
                    aria-label={`${group.name}的分组菜单`}
                    onClick={event =>
                      this.setState({
                        menu: {
                          id: group.id,
                          anchor: event.currentTarget,
                          group: true,
                        },
                      })
                    }
                  >
                    <Icon icon={mdiDotsVertical} size={0.8} />
                  </button>
                </header>
                {!group.collapsed && (
                  <div className="account-group__cards">
                    {accounts.map(service => this.renderCard(service))}
                    {accounts.length === 0 && (
                      <p className="account-group__empty">
                        暂无会话，点击上方新增
                      </p>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <footer className="account-sidebar__footer">
          <button
            type="button"
            onClick={() => this.props.actions.ui.openSettings({ path: 'app' })}
          >
            <Icon icon={mdiCogOutline} size={0.8} />
            设置
          </button>
          <button
            type="button"
            onClick={() =>
              this.props.actions.ui.openSettings({ path: 'services' })
            }
          >
            原有服务
          </button>
          <button
            type="button"
            onClick={() =>
              this.props.actions.ui.openDownloads({ path: 'downloads' })
            }
          >
            下载
          </button>
        </footer>
        {this.renderMenu()}
        {this.renderDialog()}
      </aside>
    );
  }
}
