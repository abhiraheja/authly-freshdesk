/** Shape every environment file must satisfy. */
export interface Environment {
  /** Angular production build — disables dev-only warnings. */
  readonly production: boolean;
  /** Short name for diagnostics and feature gating: 'local' | 'dev' | 'beta' | 'prod'. */
  readonly name: 'local' | 'dev' | 'beta' | 'prod';
  /**
   * API origin. Empty string means "same origin as the SPA", which is the case in
   * every deployment — the session cookie is same-site, so a cross-origin API
   * would not receive it. Only set this if you knowingly run a split origin with
   * CORS credentials configured on the server.
   */
  readonly apiBaseUrl: string;
  /** SignalR live-chat hub path, relative to {@link apiBaseUrl}. */
  readonly chatHubPath: string;
  /** SignalR release hub path — live ticks while a deployment is being run. */
  readonly releaseHubPath: string;
  /** SignalR widget hub path — an agent's reply reaching an embedded panel. */
  readonly widgetHubPath: string;
  /** SignalR ticket hub path — a customer's reply reaching the agent's screen. */
  readonly ticketHubPath: string;
}
