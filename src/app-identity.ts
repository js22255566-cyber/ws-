// ZL-WA modification: independent identity and profile paths (based on Ferdium 7.2.3).
import { join } from 'node:path';

export const APP_NAME = 'ZL-WA';
export const APP_PROTOCOL = 'zl-wa';

export function getProfilePath(
  appData: string,
  isDevMode: boolean,
  env: Record<string, string | undefined> = process.env,
): string {
  // Deliberately ignore FERDIUM_APPDATA_DIR to avoid opening Ferdium's profile.
  if (env.ZL_WA_APPDATA_DIR) return env.ZL_WA_APPDATA_DIR;

  if (env.PORTABLE_EXECUTABLE_DIR) {
    return join(
      env.PORTABLE_EXECUTABLE_DIR,
      `${APP_NAME}AppData${isDevMode ? 'Dev' : ''}`,
    );
  }

  return join(appData, `${APP_NAME}${isDevMode ? 'Dev' : ''}`);
}
