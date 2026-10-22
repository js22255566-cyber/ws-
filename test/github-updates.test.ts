import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import GitHubUpdates from '../src/electron/GitHubUpdates';
import { RELEASES_API, RELEASES_URL } from '../src/features/updates/config';

const release = (version: string, extra = {}) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  assets: [{ name: `ZL-WA-win-AutoSetup-${version}-x64.exe`, size: 100 }],
  ...extra,
});
describe('ZL-WA GitHub release notifier', () => {
  let root: string;
  let path: string;
  let fetcher: jest.Mock;
  let notify: jest.Mock;
  let updater: GitHubUpdates;
  let secure: boolean;
  const secrets = {
    available: () => secure,
    encrypt: (text: string) => Buffer.from(text).toString('base64'),
    decrypt: (text: string) => Buffer.from(text, 'base64').toString(),
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zl-github-'));
    path = join(root, 'updates.json');
    secure = true;
    notify = jest.fn();
    fetcher = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([release('7.2.5')]), { status: 200 }),
      );
    updater = new GitHubUpdates({
      version: '7.2.5',
      path,
      secrets,
      fetch: fetcher,
      notify,
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  it('checks only our repository and sorts semver rather than publication order', async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify([
          release('7.2.3'),
          release('7.2.9'),
          release('7.2.10'),
          release('7.2.5'),
        ]),
      ),
    );
    expect(await updater.check(false)).toEqual({
      available: true,
      version: '7.2.10',
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      `${RELEASES_API}?per_page=100&page=1`,
    );
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    expect(updater.releaseUrl()).toBe(`${RELEASES_URL}/tag/v7.2.10`);
  });
  it('excludes drafts, prereleases, malformed tags and releases without an installer', async () => {
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify([
            release('7.2.6-beta.1', { prerelease: true }),
            release('7.2.7-beta.1'),
            release('8.0.0', { draft: true }),
            release('9.0.0', { assets: [] }),
            release('bad'),
            release('7.2.5'),
          ]),
        ),
    );
    expect(await updater.check(false)).toEqual({
      available: false,
      version: '7.2.5',
    });
    expect(await updater.check(true)).toEqual({
      available: true,
      version: '7.2.7-beta.1',
    });
  });
  it.each([401, 403, 404, 429, 500])(
    'reports HTTP %s as failure rather than claiming latest',
    async status => {
      fetcher.mockImplementation(async () => new Response('{}', { status }));
      const result = await updater.check(false);
      expect(result.error?.message).toBeTruthy();
      expect(result.available).toBeUndefined();
      fetcher.mockImplementation(
        async () => new Response(JSON.stringify([release('7.2.6')])),
      );
      expect(await updater.check(false)).toEqual({
        available: true,
        version: '7.2.6',
      });
    },
  );
  it('does not leak transport error details and recovers after failure', async () => {
    fetcher.mockRejectedValue(new Error('fetch failed secret-token'));
    expect(JSON.stringify(await updater.check(false))).not.toContain(
      'secret-token',
    );
    expect(updater.state.error).toBeDefined();
  });
  it('stores optional user credentials encrypted and clears them without returning the token', async () => {
    const token = 'github_pat_fake_123456789';
    expect(updater.saveToken(token)).toEqual({
      hasToken: true,
      releasesUrl: RELEASES_URL,
    });
    expect(readFileSync(path, 'utf8')).not.toContain(token);
    const restored = new GitHubUpdates({
      version: '7.2.5',
      path,
      secrets,
      fetch: fetcher,
      notify,
    });
    expect(restored.configuration().hasToken).toBe(true);
    await restored.check(false);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      `Bearer ${token}`,
    );
    restored.saveToken(null);
    expect(restored.configuration().hasToken).toBe(false);
    secure = false;
    expect(() => restored.saveToken(token)).toThrow('安全存储');
    expect(() => restored.saveToken('bad token')).toThrow('有效');
  });
  it('reads additional release pages and rejects empty release data', async () => {
    fetcher
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(Array.from({ length: 100 }, () => release('7.2.5'))),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([release('7.2.8')])));
    expect(await updater.check(false)).toEqual({
      available: true,
      version: '7.2.8',
    });
    expect(fetcher.mock.calls[1][0]).toContain('page=2');
    fetcher.mockResolvedValue(new Response('[]'));
    const result = await updater.check(false);
    expect(result.error).toBeDefined();
  });
  it('shares in-flight checks and fetches release notes from our authenticated endpoint', async () => {
    const first = updater.check(false);
    const second = updater.check(false);
    expect(first).toBe(second);
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ body: 'ZL-WA changes' })),
    );
    expect(await updater.notes('7.2.5')).toBe('ZL-WA changes');
    expect(fetcher.mock.calls[1][0]).toBe(`${RELEASES_API}/tags/v7.2.5`);
    await expect(updater.notes('../other')).rejects.toThrow('无效');
  });
});
