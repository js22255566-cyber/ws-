/* eslint-disable no-void -- Detached, internally handled translation jobs must not block account polling. */
/* eslint-disable @typescript-eslint/no-loop-func -- stopped is intentionally shared by pending jobs on cleanup. */
import { ipcRenderer } from 'electron';
import type { RealStores } from '../../stores';
import { type ToolsConfig } from './config';
import {
  translationTick,
  translationResult,
  type TranslationRequest,
} from './guest';

const configs = new Map<string, ToolsConfig>();
export async function getTools(id: string): Promise<ToolsConfig> {
  if (!configs.has(id))
    configs.set(id, await ipcRenderer.invoke('account-tools-get', id));
  return configs.get(id)!;
}
export async function saveTools(
  id: string,
  config: ToolsConfig,
): Promise<ToolsConfig> {
  const saved = await ipcRenderer.invoke('account-tools-save', id, config);
  configs.set(id, saved);
  return saved;
}
export async function configureTranslation(
  service: RealStores['services']['all'][number],
): Promise<void> {
  const config = await getTools(service.id);
  if (service.webview)
    await service.webview.executeJavaScript(
      `(${translationTick.toString()})(${JSON.stringify(config.translation)},false)`,
    );
}
export function startTranslations(stores: RealStores): () => void {
  let stopped = false;
  const running = new Set<string>();
  const pending = new Set<string>();
  const cache = new Map<string, { text: string; error: boolean }>();
  const tick = async (service: RealStores['services']['all'][number]) => {
    const view = service.webview;
    if (
      !view ||
      service.isHibernating ||
      service.isLoading ||
      service.recipe.id !== 'whatsapp' ||
      running.has(service.id)
    )
      return;
    running.add(service.id);
    try {
      const c = await getTools(service.id);
      const jobs: TranslationRequest[] = await view.executeJavaScript(
        `(${translationTick.toString()})(${JSON.stringify(c.translation)})`,
      );
      for (const job of jobs.sort(
        (a, b) =>
          Number(b.direction === 'outgoing') -
          Number(a.direction === 'outgoing'),
      )) {
        const requestKey = `${service.id}:${job.token}:${job.id}`;
        if (pending.has(requestKey)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        pending.add(requestKey);
        const key = JSON.stringify([
          service.id,
          c.translation,
          job.direction,
          job.text,
        ]);
        void (async () => {
          let result = cache.get(key);
          try {
            if (!result)
              result = await ipcRenderer.invoke(
                'account-tools-translate',
                service.id,
                job.text,
                job.direction,
              );
            if (result && !result.error) {
              if (cache.size > 500) cache.clear();
              cache.set(key, result);
            }
          } catch {
            result = { text: '', error: true };
          }
          try {
            if (!stopped && service.webview === view)
              await view.executeJavaScript(
                `(${translationResult.toString()})(${job.id},${JSON.stringify(job.token)},${JSON.stringify(result ?? { text: '', error: true })})`,
              );
          } catch {
            /* A navigation or sleep discards the old document's request. */
          } finally {
            pending.delete(requestKey);
          }
        })();
      }
    } catch {
      /* QR/login pages do not expose message elements. Retry after loading. */
    } finally {
      running.delete(service.id);
    }
  };
  const timer = setInterval(() => {
    for (const service of stores.services.all) void tick(service);
  }, 400);
  return () => {
    stopped = true;
    clearInterval(timer);
    configs.clear();
    cache.clear();
  };
}
