import {
  type ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideTracklyCore } from '@trackly/core';
import { routes } from './app.routes';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Signals all the way down — no zone.js. Every component is OnPush and
    // signal-driven, so there is nothing for zone patching to do.
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      // Route and query params bind straight to component `input()`s, which is
      // what lets a list's filters live in the URL with no subscription code.
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    // The app owns `environment`; the libraries receive what they need. This is
    // the only place environment values cross into @trackly/*.
    provideTracklyCore({
      apiBaseUrl: environment.apiBaseUrl,
      chatHubPath: environment.chatHubPath,
    }),
  ],
};
