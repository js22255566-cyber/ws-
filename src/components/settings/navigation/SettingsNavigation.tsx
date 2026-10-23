import { inject, observer } from 'mobx-react';
import { Component } from 'react';
import { type WrappedComponentProps, injectIntl } from 'react-intl';
import { NavLink } from 'react-router-dom';
import type { StoresProps } from '../../../@types/ferdium-components.types';
import globalMessages from '../../../i18n/globalMessages';

interface IProps extends Partial<StoresProps>, WrappedComponentProps {
  serviceCount: number;
  workspaceCount: number;
}

@inject('stores', 'actions')
@observer
class SettingsNavigation extends Component<IProps> {
  // ZL-WA: accounts are managed in the account sidebar and no Ferdium server
  // account is used, so service, workspace, account and logout pages are not
  // offered here. Their routes still exist for direct links.
  render() {
    const { stores, intl } = this.props;

    return (
      <div className="settings-navigation">
        <NavLink
          to="/settings/app"
          className={({ isActive }) =>
            isActive
              ? 'settings-navigation__link is-active'
              : 'settings-navigation__link'
          }
        >
          {intl.formatMessage(globalMessages.settings)}
          {stores!.settings.app.automaticUpdates &&
            (stores!.ui.showServicesUpdatedInfoBar ||
              stores!.app.updateStatus ===
                stores!.app.updateStatusTypes.AVAILABLE ||
              stores!.app.updateStatus ===
                stores!.app.updateStatusTypes.DOWNLOADED) && (
              <span className="update-available">•</span>
            )}
        </NavLink>
      </div>
    );
  }
}

export default injectIntl(SettingsNavigation);
