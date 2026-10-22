import { ipcRenderer } from 'electron';
import { type IntlShape, defineMessages } from 'react-intl';

export const getFerdiumVersion = (
  currentLocation: string,
  ferdiumVersion: string,
): string => {
  const matches = currentLocation.match(/version=([^&]*)/);
  if (matches !== null) {
    return `v${matches[1]}`;
  }
  return `v${ferdiumVersion}`;
};

export const updateVersionParse = (updateVersion: string): string => {
  return updateVersion === '' ? '' : `?version=${updateVersion}`;
};

export const onAuthGoToReleaseNotes = (
  currentLocation: string,
  updateVersionParsed: string = '',
): string => {
  return currentLocation.includes('#/auth')
    ? `#/auth/releasenotes${updateVersionParsed}`
    : `#/releasenotes${updateVersionParsed}`;
};

const messages = defineMessages({
  connectionError: {
    id: 'settings.releasenotes.connectionError',
    defaultMessage:
      'An error occurred when connecting to Github, please try again later.',
  },
  connectionErrorPageMissing: {
    id: 'settings.releasenotes.connectionErrorPageMissing',
    defaultMessage:
      'An error occurred when connecting to Github, the page you are looking for is missing.',
  },
});

export async function getUpdateInfoFromGH(
  currentLocation: string,
  ferdiumVersion: string,
  intl: IntlShape,
): Promise<string> {
  try {
    const tag = getFerdiumVersion(currentLocation, ferdiumVersion);
    return await ipcRenderer.invoke('zl-updates-notes', tag.slice(1));
  } catch {
    return `### ${intl.formatMessage(messages.connectionErrorPageMissing)}\n\n请打开 ZL-WA 的 GitHub 发布页查看更新说明；私有仓库需要在更新设置中配置访问权限。`;
  }
}
