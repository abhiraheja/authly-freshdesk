import type { Environment } from './environment.model';

/** Production — the SPA is served by the API host, so every path is same-origin. */
export const environment: Environment = {
  production: true,
  name: 'prod',
  apiBaseUrl: '',
  chatHubPath: '/hubs/chat',
};
