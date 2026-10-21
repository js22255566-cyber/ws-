import { join } from 'node:path';
import { getProfilePath } from '../src/app-identity';

describe('ZL-WA profile isolation', () => {
  it('keeps installed and development profiles separate from Ferdium', () => {
    expect(getProfilePath('/profiles', false, {})).toBe(
      join('/profiles', 'ZL-WA'),
    );
    expect(getProfilePath('/profiles', true, {})).toBe(
      join('/profiles', 'ZL-WADev'),
    );
  });

  it('does not reuse an inherited Ferdium profile override', () => {
    expect(
      getProfilePath('/profiles', false, {
        FERDIUM_APPDATA_DIR: '/profiles/Ferdium',
      }),
    ).toBe(join('/profiles', 'ZL-WA'));
  });

  it('keeps portable data beside the executable without a nested profile', () => {
    const env = { PORTABLE_EXECUTABLE_DIR: '/portable' };
    expect(getProfilePath('/profiles', false, env)).toBe(
      join('/portable', 'ZL-WAAppData'),
    );
    expect(getProfilePath('/profiles', true, env)).toBe(
      join('/portable', 'ZL-WAAppDataDev'),
    );
  });

  it('honors an explicit ZL-WA profile in both run modes', () => {
    const env = {
      ZL_WA_APPDATA_DIR: '/custom/zl-wa',
      PORTABLE_EXECUTABLE_DIR: '/portable',
      FERDIUM_APPDATA_DIR: '/profiles/Ferdium',
    };
    expect(getProfilePath('/profiles', false, env)).toBe('/custom/zl-wa');
    expect(getProfilePath('/profiles', true, env)).toBe('/custom/zl-wa');
  });
});
