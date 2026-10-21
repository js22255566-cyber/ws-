import { session } from '@electron/remote';
import { action, autorun, observable } from 'mobx';

const debug = require('../../preload-safe-debug')(
  'Ferdium:feature:serviceProxy',
);

export const config = observable({
  isEnabled: true,
});

export default function init(stores: {
  services: { enabled: any };
  settings: { proxy: any };
}) {
  debug('Initializing `serviceProxy` feature');

  const setIsEnabled = action((value: boolean) => {
    config.isEnabled = value;
  });

  autorun(() => {
    setIsEnabled(true);

    const services = stores.services.enabled;
    const proxySettings = stores.settings.proxy;

    debug('Service Proxy autorun');

    for (const service of services) {
      // WhatsApp proxies are managed by the privileged account-tools API.
      // eslint-disable-next-line no-continue
      if (service.recipe?.id === 'whatsapp') continue;
      const s = session.fromPartition(`persist:service-${service.id}`);

      if (config.isEnabled) {
        const serviceProxyConfig = proxySettings[service.id];

        if (serviceProxyConfig?.isEnabled && serviceProxyConfig.host) {
          const proxyHost = `${serviceProxyConfig.host}${
            serviceProxyConfig.port ? `:${serviceProxyConfig.port}` : ''
          }`;
          debug(
            `Setting proxy config from service settings for "${service.name}" (${service.id}) to`,
            proxyHost,
          );

          s.setProxy({ proxyRules: proxyHost })
            .then(() => {
              debug(
                `Using proxy "${proxyHost}" for "${service.name}" (${service.id})`,
              );
            })
            .catch(error => console.error(error));
        }
      }
    }
  });
}
