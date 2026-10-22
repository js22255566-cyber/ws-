import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  assets: { name: string; size: number }[];
  body?: string;
}
interface Secrets {
  available: () => boolean;
  encrypt: (value: string) => string;
  decrypt: (value: string) => string;
}
export default class GitHubUpdates {
  state: UpdateState = {};

  private pending?: Promise<UpdateState>;

  private pendingBeta = false;

  private link = RELEASES_URL;

  constructor(
    private options: {
      version: string;
      path: string;
      secrets: Secrets;
      fetch: (url: string, options: RequestInit) => Promise<Response>;
      notify: (state: UpdateState) => void;
    },
  ) {}

  private credential(): string {
    if (!existsSync(this.options.path)) return '';
    try {
      const value = JSON.parse(readFileSync(this.options.path, 'utf8')).token;
      return value ? this.options.secrets.decrypt(value) : '';
    } catch {
      throw new Error('无法读取更新访问凭据，请重新保存 GitHub Token');
    }
  }

  configuration() {
    return { hasToken: Boolean(this.credential()), releasesUrl: RELEASES_URL };
  }

  saveToken(value: unknown) {
    if (
      value !== null &&
      (typeof value !== 'string' || !/^[\w-]{10,500}$/.test(value))
    )
      throw new Error('请输入有效的 GitHub Token');
    if (value !== null && !this.options.secrets.available())
      throw new Error('系统安全存储不可用，不能保存 GitHub Token');
    const token =
      value === null ? '' : this.options.secrets.encrypt(value as string);
    writeFileSync(`${this.options.path}.tmp`, JSON.stringify({ token }), {
      mode: 0o600,
    });
    renameSync(`${this.options.path}.tmp`, this.options.path);
    return { hasToken: Boolean(token), releasesUrl: RELEASES_URL };
  }

  private async request(url: string) {
    const token = this.credential();
    let response: Response;
    try {
      response = await this.options.fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `ZL-WA/${this.options.version}`,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
    } catch {
      throw new Error('无法连接 GitHub，请检查网络后重试');
    }
    if (response.status === 404)
      throw new Error(
        '无法访问 ZL-WA 的 GitHub Releases。仓库为私有时，请配置有此仓库 Contents 只读权限的 GitHub Token；此结果不代表已经是最新版。',
      );
    if (response.status === 401)
      throw new Error('GitHub Token 无效或已过期，请重新配置');
    if (response.status === 403 || response.status === 429)
      throw new Error(
        'GitHub 拒绝访问或请求频率超限，请检查 Token 权限并稍后重试',
      );
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
