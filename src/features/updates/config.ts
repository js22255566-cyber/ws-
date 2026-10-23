export const UPDATE_OWNER = 'zhenglin1885-arch';
export const UPDATE_REPO = 'ZL-WA';
export const UPDATE_REPOSITORY = `${UPDATE_OWNER}/${UPDATE_REPO}`;
export const RELEASES_URL = `https://github.com/${UPDATE_REPOSITORY}/releases`;
export const RELEASES_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases`;
export interface UpdateState {
  checking?: boolean;
  downloading?: boolean;
  downloaded?: boolean;
  progress?: number;
  available?: boolean;
  version?: string;
  error?: { message: string };
}
