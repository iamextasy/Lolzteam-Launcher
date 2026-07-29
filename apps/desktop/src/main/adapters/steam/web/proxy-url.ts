import type { ProxyEntry } from '@shared-types';

export const proxyUrlForSteamSession = (proxy: ProxyEntry): string => {
  const scheme = proxy.protocol === 'https' ? 'https' : 'http';
  const auth =
    proxy.username != null && proxy.username !== ''
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@`
      : '';
  return `${scheme}://${auth}${proxy.host}:${proxy.port}`;
};
