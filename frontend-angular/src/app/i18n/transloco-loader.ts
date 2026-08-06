import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';

/**
 * Loads `public/i18n/<lang>.json` at runtime.
 *
 * Runtime rather than build-time i18n on purpose: Trackly ships one bundle that
 * serves every workspace, and a customer following a branded link should get
 * their language without a separate deployment per locale.
 */
@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string) {
    return this.http.get<Translation>(`/i18n/${lang}.json`);
  }
}
