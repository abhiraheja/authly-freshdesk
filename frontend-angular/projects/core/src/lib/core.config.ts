import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { InjectionToken, type EnvironmentProviders, type Provider, makeEnvironmentProviders } from '@angular/core';
import {
  apiErrorInterceptor,
  credentialsInterceptor,
  widgetVisitorInterceptor,
} from './api/http.interceptors';

/**
 * Runtime configuration `@trackly/core` needs.
 *
 * A library must never import the host app's `environment.ts` — that would make
 * it un-consumable by any other app and un-testable without the app's file
 * layout. The app owns environment; it hands the values down here.
 */
export interface TracklyConfig {
  /**
   * API origin. Empty string means "same origin as the SPA", which is the case
   * in every deployment — the session cookie is same-site, so a cross-origin API
   * would never receive it. Only set this for a knowingly split origin with CORS
   * credentials configured server-side.
   */
  readonly apiBaseUrl: string;
  /** SignalR live-chat hub path, relative to {@link apiBaseUrl}. */
  readonly chatHubPath: string;
  /** SignalR release hub path — live ticks while a deployment is being run. */
  readonly releaseHubPath: string;
}

export const TRACKLY_CONFIG = new InjectionToken<TracklyConfig>('TRACKLY_CONFIG');

/**
 * Wires the core layer into an application.
 *
 * Provides the config, `HttpClient`, and the two interceptors every Trackly call
 * depends on — the session cookie and `ApiError` normalisation. Call it once, in
 * the app's `appConfig`:
 *
 * ```ts
 * provideTracklyCore({
 *   apiBaseUrl: environment.apiBaseUrl,
 *   chatHubPath: environment.chatHubPath,
 * })
 * ```
 */
export function provideTracklyCore(config: TracklyConfig): EnvironmentProviders {
  const providers: Provider[] = [{ provide: TRACKLY_CONFIG, useValue: config }];
  return makeEnvironmentProviders([
    ...providers,
    provideHttpClient(
      withInterceptors([credentialsInterceptor, widgetVisitorInterceptor, apiErrorInterceptor]),
    ),
  ]);
}
