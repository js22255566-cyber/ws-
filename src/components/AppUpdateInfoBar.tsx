import { mdiInformation } from '@mdi/js';
import type { MouseEventHandler } from 'react';
import InfoBar from './ui/InfoBar';
import Icon from './ui/icon';

import { onAuthGoToReleaseNotes } from '../helpers/update-helpers';

export interface IProps {
  onInstallUpdate: MouseEventHandler<HTMLButtonElement>;
  onHide: () => void;
  updateVersionParsed: string;
}

const AppUpdateInfoBar = (props: IProps) => {
  const { onInstallUpdate, updateVersionParsed, onHide } = props;

  return (
    <InfoBar
      type="primary"
      ctaLabel="前往 GitHub 下载"
      onClick={onInstallUpdate}
      onHide={onHide}
    >
      <Icon icon={mdiInformation} />
      <p style={{ padding: '0 0.5rem 0 1rem' }}>
        发现 ZL-WA 新版本{' '}
        {new URLSearchParams(updateVersionParsed).get('version')}。
      </p>

      <button
        className="info-bar__inline-button"
        type="button"
        onClick={() => {
          window.location.href = onAuthGoToReleaseNotes(
            window.location.href,
            updateVersionParsed,
          );
        }}
      >
        <u>查看更新说明</u>
      </button>
    </InfoBar>
  );
};

export default AppUpdateInfoBar;
