import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { provideTracklyCore } from '@trackly/core';
import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { TranslocoHttpLoader } from './i18n/transloco-loader';

/** Restores the visitor's chosen language, defaulting to English. */
function savedLang(): string {
  try {
    return localStorage.getItem('trackly-lang') === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}

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
      releaseHubPath: environment.releaseHubPath,
      widgetHubPath: environment.widgetHubPath,
      ticketHubPath: environment.ticketHubPath,
    }),
    // Localisation. No user-visible string is hard-coded anywhere in this
    // workspace — see the `trackly-i18n` skill. Messages load from
    // public/i18n/<lang>.json.
    provideTransloco({
      config: {
        availableLangs: ['en', 'hi'],
        defaultLang: savedLang(),
        fallbackLang: 'en',
        reRenderOnLangChange: true,
        prodMode: environment.production,
      },
      loader: TranslocoHttpLoader,
    }),
    // Load the active language BEFORE the first render.
    //
    // Without this, Transloco resolves every key to an empty string until the
    // JSON arrives, so the first paint shows a blank page title and empty
    // `<option>` labels that fill in a moment later. Blocking bootstrap on one
    // small JSON file is far cheaper than that flash.
    provideAppInitializer(() => {
      const transloco = inject(TranslocoService);
      return firstValueFrom(transloco.load(transloco.getActiveLang()));
    }),
  ],
};
