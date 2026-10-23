// ZL-WA modification: no Ferdium account is needed for WhatsApp multi-session
// use, so the welcome screen starts the local (accountless) session directly.
import { inject, observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import { type WrappedComponentProps, injectIntl } from 'react-intl';
import type { StoresProps } from '../../@types/ferdium-components.types';
import serverlessLogin from '../../helpers/serverless-helpers';
import type RecipePreview from '../../models/RecipePreview';
import { H1 } from '../ui/headline';

interface IProps extends Partial<StoresProps>, WrappedComponentProps {
  loginRoute: string;
  signupRoute: string;
  changeServerRoute: string;
  recipes: RecipePreview[];
}

@inject('actions')
@observer
class Welcome extends Component<IProps> {
  componentDidMount(): void {
    this.start();
  }

  start = (): void => {
    serverlessLogin(this.props.actions);
  };

  render(): ReactElement {
    return (
      <div className="welcome">
        <div className="welcome__content">
          <img
            src="./assets/images/logo.svg"
            className="welcome__logo"
            alt=""
          />
        </div>
        <div className="welcome__text">
          <H1>ZL-WA</H1>
          <p>正在启动…</p>
        </div>
        <div className="welcome__buttons">
          {/* Fallback in case the automatic start was interrupted. */}
          <button type="button" className="button" onClick={this.start}>
            开始使用
          </button>
        </div>
      </div>
    );
  }
}

export default injectIntl(Welcome);
