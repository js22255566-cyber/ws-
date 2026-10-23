import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { valid, gt, rcompare, prerelease } from 'semver';
import {
  RELEASES_API,
  RELEASES_URL,
  type UpdateState,
} from '../features/updates/config';

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; size: number; digest?: string }[];
  body?: string;
}
export default class GitHubUpdates {
  state: UpdateState = {};

  private pending?: Promise<UpdateState>;

  private pendingBeta = false;

  private link = RELEASES_URL;

  constructor(
    private options: {
      version: string;
      directory: string;
      supported: boolean;
      launch: (path: string) => Promise<void>;
      fetch: (url: string, options: RequestInit) => Promise<Response>;
      notify: (state: UpdateState) => void;
    },
  ) {}

  private installer?: {
    name: string;
    size: number;
    digest: string;
    url: string;
  };

  private downloaded?: string;

  private downloading?: Promise<UpdateState>;

  async download(): Promise<UpdateState> {
    if (this.downloading) return this.downloading;
    if (!this.options.supported)
      throw new Error('在线安装更新目前仅支持 Windows');
    if (!this.installer || !this.state.available)
      throw new Error('请先检查可用更新');
    const asset = { ...this.installer };
    if (!/^sha256:[\da-f]{64}$/.test(asset.digest))
      throw new Error('更新包缺少 SHA-256 校验信息，请稍后重试');
    const destination = join(this.options.directory, asset.name);
    const temporary = `${destination}.part`;
    this.downloading = (async () => {
      this.publish({
        ...this.state,
        downloading: true,
        downloaded: false,
        progress: 0,
        error: undefined,
      });
      try {
        await mkdir(this.options.directory, { recursive: true });
        const response = await this.options.fetch(asset.url, {
          signal: AbortSignal.timeout(300_000),
          redirect: 'follow',
        });
        if (!response.ok || !response.body)
          throw new Error('更新包下载失败，请检查网络后重试');
        const hash = createHash('sha256');
        let size = 0;
        let progress = -1;
        const stream = new Transform({
          transform: (chunk, _encoding, callback) => {
            size += chunk.length;
            if (size > asset.size || size > 1_000_000_000) {
              callback(new Error('更新包大小异常'));
              return;
            }
            hash.update(chunk);
            const percent = Math.min(99, Math.floor((size / asset.size) * 100));
            if (percent !== progress) {
              progress = percent;
              this.publish({ ...this.state, progress });
            }
            callback(null, chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(response.body as any),
          stream,
          createWriteStream(temporary, { mode: 0o600 }),
        );
        if (
          size !== asset.size ||
          `sha256:${hash.digest('hex')}` !== asset.digest
        )
          throw new Error('更新包校验失败，请重新下载');
        await rm(destination, { force: true });
        await rename(temporary, destination);
        this.downloaded = destination;
        return this.publish({
          ...this.state,
          downloading: false,
          downloaded: true,
          progress: 100,
        });
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        this.downloaded = undefined;
        return this.publish({
          ...this.state,
          downloading: false,
          downloaded: false,
          error: {
            message:
              error instanceof Error ? error.message : '更新包下载失败，请重试',
          },
        });
      } finally {
        this.downloading = undefined;
      }
    })();
    return this.downloading;
  }

  async install() {
    if (
      !this.options.supported ||
      !this.downloaded ||
      !this.installer ||
      this.downloading
    )
      throw new Error('请先下载并校验更新包');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(this.downloaded))
      hash.update(chunk);
    if (`sha256:${hash.digest('hex')}` !== this.installer.digest) {
      this.downloaded = undefined;
      this.publish({
        ...this.state,
        downloaded: false,
        error: { message: '更新包已变化，请重新下载' },
      });
      throw new Error('更新包已变化，请重新下载');
    }
    await this.options.launch(this.downloaded);
  }

  private async request(url: string) {
    let response: Response;
    try {
      response = await this.options.fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `ZL-WA/${this.options.version}`,
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
    } catch {
      throw new Error('无法连接 GitHub，请检查网络后重试');
    }
    if (response.status === 404)
      throw new Error(
        '更新服务器未找到发布包，请稍后重试；此结果不代表已经是最新版。',
      );
    if (response.status === 401)
      throw new Error('更新服务器拒绝访问，请稍后重试');
    if (response.status === 403 || response.status === 429)
      throw new Error('更新服务器拒绝访问或请求频率超限，请稍后重试');
    if (!response.ok)
      throw new Error(
        `GitHub 更新检查失败（HTTP ${response.status}），请稍后重试`,
      );
    try {
      return await response.json();
    } catch {
      throw new Error('GitHub 返回了无效的更新数据，请稍后重试');
    }
  }

  private publish(state: UpdateState) {
    this.state = state;
    this.options.notify(state);
    return state;
  }

  check(beta: boolean): Promise<UpdateState> {
    if (this.downloading) return this.downloading;
    if (this.pending)
      return this.pendingBeta === beta
        ? this.pending
        : this.pending.then(() => this.check(beta));
    this.pendingBeta = beta;
    this.publish({ checking: true });
    this.pending = this.find(beta)
      .catch(() =>
        this.publish({
          error: { message: '无法连接 GitHub，请检查网络后重试' },
        }),
      )
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async find(beta: boolean): Promise<UpdateState> {
    try {
      const releases: Release[] = [];
      for (let page = 1; page <= 10; page += 1) {
        // eslint-disable-next-line no-await-in-loop -- GitHub pagination depends on the preceding page length.
        const batch = await this.request(
          `${RELEASES_API}?per_page=100&page=${page}`,
        );
        if (!Array.isArray(batch))
          throw new Error('GitHub 返回了无效的更新数据，请稍后重试');
        releases.push(...batch);
        if (batch.length < 100) break;
        if (page === 10)
          throw new Error(
            '版本列表过长，无法确认最新版本，请打开 GitHub 发布页查看',
          );
      }
      const choices = releases
        .filter(release => {
          const version = valid(release.tag_name);
          return (
            version &&
            !release.draft &&
            (beta || (!release.prerelease && !prerelease(version))) &&
            Array.isArray(release.assets) &&
            release.assets.some(
              asset =>
                asset.name === `ZL-WA-win-AutoSetup-${version}-x64.exe` &&
                asset.size > 0,
            )
          );
        })
        .sort((a, b) => rcompare(valid(a.tag_name)!, valid(b.tag_name)!));
      const release = choices[0];
      if (!release)
        throw new Error(
          'GitHub 尚未发布可用的 ZL-WA Windows 安装包，请打开发布页查看',
        );
      const version = valid(release.tag_name)!;
      const available = gt(version, this.options.version);
      const asset = release.assets.find(
        a => a.name === `ZL-WA-win-AutoSetup-${version}-x64.exe`,
      )!;
      this.installer = {
        name: asset.name,
        size: asset.size,
        digest: asset.digest || '',
        url: `https://github.com/zhenglin1885-arch/ZL-WA/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`,
      };
      this.downloaded = undefined;
      this.link = available
        ? `${RELEASES_URL}/tag/${encodeURIComponent(release.tag_name)}`
        : RELEASES_URL;
      return this.publish({ available, version });
    } catch (error) {
      const message =
        error instanceof Error &&
        !['TypeError', 'AbortError', 'TimeoutError'].includes(error.name)
          ? error.message
          : '无法连接 GitHub，请检查网络后重试';
      return this.publish({ error: { message } });
    }
  }

  releaseUrl() {
    return this.link;
  }

  async notes(version: string): Promise<string> {
    if (!valid(version)) throw new Error('无效版本号');
    const result = await this.request(
      `${RELEASES_API}/tags/${encodeURIComponent(`v${version}`)}`,
    );
    return typeof result.body === 'string'
      ? result.body
      : '该版本尚未填写更新说明。';
  }
}
