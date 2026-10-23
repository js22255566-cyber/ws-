import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import GitHubUpdates from '../src/electron/GitHubUpdates';

const data = Buffer.from('MZ synthetic installer fixture');
const digest = `sha256:${createHash('sha256').update(data).digest('hex')}`;
const filename = 'ZL-WA-win-AutoSetup-7.3.0-x64.exe';

describe('public online installer updates', () => {
  let root: string;
  let fetcher: jest.Mock;
  let launch: jest.Mock;
  let updater: GitHubUpdates;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zl-update-download-'));
    launch = jest.fn(async () => {});
    fetcher = jest.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'v7.3.0',
              draft: false,
              prerelease: false,
              assets: [{ name: filename, size: data.length, digest }],
            },
          ]),
        ),
    );
    updater = new GitHubUpdates({
      version: '7.2.9',
      directory: root,
      supported: true,
      launch,
      fetch: fetcher,
      notify: jest.fn(),
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  it('downloads only the repository installer, verifies its hash and waits for explicit install', async () => {
    await updater.check(false);
    fetcher.mockResolvedValue(new Response(data));
    expect(await updater.download()).toMatchObject({
      downloaded: true,
      downloading: false,
      progress: 100,
    });
    expect(launch).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[1][0]).toBe(
      `https://github.com/zhenglin1885-arch/ZL-WA/releases/download/v7.3.0/${filename}`,
    );
    expect(fetcher.mock.calls[1][1].headers).toBeUndefined();
    await updater.install();
    expect(launch).toHaveBeenCalledWith(join(root, filename));
  });
  it('rejects corrupted downloads and leaves no partial installer', async () => {
    await updater.check(false);
    fetcher.mockResolvedValue(new Response(Buffer.alloc(data.length)));
    expect(await updater.download()).toMatchObject({
      downloaded: false,
      error: { message: expect.stringContaining('校验失败') },
    });
    expect(existsSync(join(root, `${filename}.part`))).toBe(false);
    await expect(updater.install()).rejects.toThrow('请先下载');
    expect(launch).not.toHaveBeenCalled();
  });
  it('rechecks the file before launching so local changes cannot be installed', async () => {
    await updater.check(false);
    fetcher.mockResolvedValue(new Response(data));
    await updater.download();
    writeFileSync(join(root, filename), 'changed');
    await expect(updater.install()).rejects.toThrow('已变化');
    expect(launch).not.toHaveBeenCalled();
  });
  it('deduplicates simultaneous download clicks', async () => {
    await updater.check(false);
    fetcher.mockResolvedValue(new Response(data));
    await Promise.all([updater.download(), updater.download()]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
