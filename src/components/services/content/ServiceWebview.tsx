// ZL-WA modification: independent WhatsApp sessions, live metadata and overlay focus.
import { join } from 'node:path';
import { ipcRenderer } from 'electron';
import {
  type IReactionDisposer,
  action,
  makeObservable,
  observable,
  reaction,
  runInAction,
} from 'mobx';
import { observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import ElectronWebView from 'react-electron-web-view';
import type ServiceModel from '../../../models/Service';
import type { RealStores } from '../../../stores';
import {
  readWhatsAppSnapshot,
  mergeAccountSnapshot,
} from '../../../features/accounts/whatsapp';
import { configureTranslation } from '../../../features/accountTools/runtime';

const debug = require('../../../preload-safe-debug')('Ferdium:Services');

type WebviewElement = ElectronWebView['view'];

interface IProps {
  service: ServiceModel;
  setWebviewReference: (options: {
    serviceId: string;
    webview: ElectronWebView | null;
  }) => void;
  detachService: (options: { service: ServiceModel }) => void;
  isSpellcheckerEnabled: boolean;
  stores?: RealStores;
}

@observer
class ServiceWebview extends Component<IProps> {
  @observable webview: ElectronWebView | null = null;

  @observable proxyReady = false;

  @observable proxyError = '';

  componentDidMount(): void {
    this.prepareProxy();
  }

  prepareProxy = (): void => {
    if (this.props.service.recipe.id !== 'whatsapp') return;
    runInAction(() => {
      this.proxyError = '';
    });
    ipcRenderer
      .invoke('account-tools-prepare', this.props.service.id)
      .then(() => {
        runInAction(() => {
          this.proxyReady = true;
        });
      })
      .catch(() => {
        runInAction(() => {
          this.proxyError =
            '账号代理初始化失败，请检查右侧代理设置后重新打开会话';
        });
      });
  };

  private webviewReactionDisposer: IReactionDisposer;

  private didAttachTimeout: ReturnType<typeof setTimeout> | null = null;

  private accountPollTimer: ReturnType<typeof setInterval> | null = null;

  private accountPollRunning = false;

  private lastAppliedZoom: number | null = null;

  pollAccount = async (): Promise<void> => {
    const { service, stores } = this.props;
    const view = this.webview?.view;
    if (!view || service.recipe?.id !== 'whatsapp' || this.accountPollRunning)
      return;
    this.accountPollRunning = true;
    try {
      await configureTranslation(service);
      const snapshot = await view.executeJavaScript(
        `(${readWhatsAppSnapshot.toString()})()`,
      );
      if (this.webview?.view !== view) return;
      runInAction(() => {
        service.accountSnapshot = mergeAccountSnapshot(
          service.accountSnapshot,
          snapshot,
        );
        if (
          Number.isFinite(snapshot.unreadMessages) ||
          snapshot.status === 'logged-out'
        ) {
          service.unreadDirectMessageCount = snapshot.unreadMessages ?? 0;
          service.unreadIndirectMessageCount = 0;
        }
      });
      const zoom =
        stores?.settings.app.accountSidebar?.accounts[service.id]?.zoom ?? 1;
      if (zoom !== this.lastAppliedZoom) {
        view.setZoomFactor(zoom);
        this.lastAppliedZoom = zoom;
      }
    } catch {
      if (this.webview?.view === view) {
        runInAction(() => {
          service.accountSnapshot = {
            ...service.accountSnapshot,
            status: 'error',
          };
        });
      }
    } finally {
      this.accountPollRunning = false;
    }
  };

  accountNavigationStarted = (): void => {
    this.lastAppliedZoom = null;
    runInAction(() => {
      this.props.service.accountSnapshot = {
        ...this.props.service.accountSnapshot,
        status: 'loading',
      };
    });
  };

  constructor(props: IProps) {
    super(props);

    this._setWebview = this._setWebview.bind(this);

    makeObservable(this);

    this.webviewReactionDisposer = reaction(
      () => this.webview?.view ?? null,
      (webview, previousWebview) => {
        this.removeWebviewEventListeners(previousWebview);
        this.addWebviewEventListeners(webview);
      },
    );
  }

  componentWillUnmount(): void {
    const { service, detachService } = this.props;
    this.webviewReactionDisposer();
    this.removeWebviewEventListeners(this.webview?.view ?? null);
    if (this.didAttachTimeout) {
      clearTimeout(this.didAttachTimeout);
      this.didAttachTimeout = null;
    }
    detachService({ service });
  }

  handleConsoleMessage = (e): void => {
    debug('Service logged a message:', e.message);
  };

  @action handleDidNavigate = (): void => {
    if (this.props.service._webview) {
      this.props.service.pageTitle = this.props.service._webview.getTitle();
    }
  };

  @action handlePageTitleUpdated = (
    event: Electron.PageTitleUpdatedEvent,
  ): void => {
    this.props.service.pageTitle = event.title;
  };

  handleWebviewRef = (webview: ElectronWebView | null): void => {
    this._setWebview(webview);
  };

  handleDidAttach = (): void => {
    const { service, setWebviewReference } = this.props;

    // Force the event handler to run in a new task.
    // This resolves a race condition when the `did-attach` is called,
    // but the webview is not attached to the DOM yet:
    // https://github.com/electron/electron/issues/31918
    // This prevents us from immediately attaching listeners such as `did-stop-load`:
    // https://github.com/ferdium/ferdium-app/issues/157
    this.didAttachTimeout = setTimeout(() => {
      setWebviewReference({
        serviceId: service.id,
        webview: this.webview?.view ?? null,
      });
      this.didAttachTimeout = null;
    }, 0);
  };

  refocusWebview = (): void => {
    if (
      typeof document !== 'undefined' &&
      document.querySelector?.('[role="dialog"], [role="menu"]')
    )
      return;
    const { webview } = this;
    debug('Refocus Webview is called', this.props.service);
    if (!webview) {
      return;
    }

    if (this.props.service.isActive) {
      webview.view.blur();
      webview.view.focus();
    } else {
      debug('Refocus not required - Not active service');
    }
  };

  addWebviewEventListeners(webview: WebviewElement | null): void {
    if (!webview) {
      return;
    }

    webview.addEventListener('console-message', this.handleConsoleMessage);
    webview.addEventListener('did-navigate', this.handleDidNavigate);
    webview.addEventListener('page-title-updated', this.handlePageTitleUpdated);
    webview.addEventListener('did-stop-loading', this.refocusWebview);
    if (this.props.service.recipe?.id === 'whatsapp') {
      webview.addEventListener(
        'did-start-loading',
        this.accountNavigationStarted,
      );
      webview.addEventListener('did-stop-loading', this.pollAccount);
      this.accountPollTimer = setInterval(() => {
        this.pollAccount();
      }, 6000);
    }
  }

  removeWebviewEventListeners(webview: WebviewElement | null): void {
    if (this.accountPollTimer) {
      clearInterval(this.accountPollTimer);
      this.accountPollTimer = null;
    }
    if (!webview) {
      return;
    }

    webview.removeEventListener('console-message', this.handleConsoleMessage);
    webview.removeEventListener('did-navigate', this.handleDidNavigate);
    webview.removeEventListener(
      'page-title-updated',
      this.handlePageTitleUpdated,
    );
    webview.removeEventListener('did-stop-loading', this.refocusWebview);
    webview.removeEventListener(
      'did-start-loading',
      this.accountNavigationStarted,
    );
    webview.removeEventListener('did-stop-loading', this.pollAccount);
  }

  @action _setWebview(webview: ElectronWebView | null): void {
    this.webview = webview;
  }

  render(): ReactElement {
    const { service, isSpellcheckerEnabled, stores } = this.props;

    if (service.recipe.id === 'whatsapp' && !this.proxyReady) {
      return (
        <div role="status">
          {this.proxyError || '正在准备账号独立网络环境…'}
          {this.proxyError && (
            <button type="button" onClick={this.prepareProxy}>
              重试加载会话
            </button>
          )}
        </div>
      );
    }

    const { sandboxServices } = stores!.settings.app;

    const { sandboxServices: sandboxes } = stores!.app;

    const checkForSandbox = () => {
      const sandbox = sandboxes.find(s => s.services.includes(service.id));

      if (sandbox) {
        return `persist:sandbox-${sandbox.id}`;
      }

      return service.partition;
    };

    const preloadScript = join(
      __dirname,
      '..',
      '..',
      '..',
      'webview',
      'recipe.js',
    );

    return (
      <ElectronWebView
        ref={this.handleWebviewRef}
        autosize
        src={service.url}
        preload={preloadScript}
        partition={
          service.recipe.id === 'whatsapp'
            ? `persist:service-${service.id}`
            : sandboxServices
              ? checkForSandbox()
              : 'persist:general-session'
        }
        onDidAttach={this.handleDidAttach}
        // onUpdateTargetUrl={this.updateTargetUrl} // TODO: [TS DEBT] need to check where its from
        useragent={service.userAgent}
        disablewebsecurity={
          service.recipe.disablewebsecurity ? true : undefined
        }
        allowpopups
        nodeintegration
        webpreferences={`spellcheck=${
          isSpellcheckerEnabled ? 1 : 0
        }, contextIsolation=1`}
      />
    );
  }
}

export default ServiceWebview;
