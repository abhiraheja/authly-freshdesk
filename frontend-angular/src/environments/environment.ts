import type { Environment } from './environment.model';

/** Local development — the dev server proxies /api and /hubs (see proxy.conf.js). */
export const environment: Environment = {
  production: false,
  name: 'local',
  apiBaseUrl: '',
  chatHubPath: '/hubs/chat',
  releaseHubPath: '/hubs/releases',
  widgetHubPath: '/hubs/widget',
  ticketHubPath: '/hubs/tickets',
};
