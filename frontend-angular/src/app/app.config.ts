import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { apiErrorInterceptor, credentialsInterceptor } from './core/api/http.interceptors';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Signals all the way down — no zone.js. Every component here is OnPush and
    // signal-driven, so there is nothing for zone patching to do.
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      // Route and query params bind straight to component `input()`s, which is
      // what lets a list's filters live in the URL with no subscription code.
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(withInterceptors([credentialsInterceptor, apiErrorInterceptor])),
  ],
};
