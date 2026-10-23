import { mdiInformation } from '@mdi/js';
import type { MouseEventHandler } from 'react';
import InfoBar from './ui/InfoBar';
import Icon from './ui/icon';

import { onAuthGoToReleaseNotes } from '../helpers/update-helpers';

export interface IProps {
  onInstallUpdate: MouseEventHandler<HTMLButtonElement>;
  onHide: () => void;
  updateVersionParsed: string;
  downloaded?: boolean;
  downloading?: boolean;
  progress?: number;
}

const AppUpdateInfoBar = (props: IProps) => {
  const {
    onInstallUpdate,
    updateVersionParsed,
    onHide,
    downloaded,
    downloading,
    progress,
  } = props;

  return (
    <InfoBar
      type="primary"
      ctaLabel={
        downloaded
          ? '退出并安装'
          : downloading
            ? `下载中 ${progress || 0}%`
            : '下载安装更新'
      }
      onClick={onInstallUpdate}
      onHide={onHide}
    >
      <Icon icon={mdiInformation} />
      <p style={{ padding: '0 0.5rem 0 1rem' }}>
        {downloaded ? '更新包已下载并校验：' : '发现 ZL-WA 新版本'}{' '}
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
