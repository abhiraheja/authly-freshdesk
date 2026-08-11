import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { PublicApi } from '../api/public.api';

/**
 * Puts the workspace's logo on the browser tab.
 *
 * <h3>Why this is a service and not a build-time asset</h3>
 * `favicon.ico` ships with the image, so every installation wore Trackly's mark
 * on the tab no matter whose desk it was on — the one piece of chrome that
 * escaped invariant 6's "customer-facing surfaces wear the workspace's
 * branding". A self-hosted deployment belongs to whoever runs it, and the tab is
 * the most-seen 16 pixels in the product.
 *
 * <h3>Applied once, from the root component</h3>
 * The tab icon is global — it is not per-route, and swapping it on navigation
 * would make it flicker. This runs after bootstrap rather than blocking it: a
 * favicon that arrives 50ms late costs nothing, and holding first paint on a
 * decorative fetch would.
 *
 * Failures are swallowed on purpose. `PublicApi.branding` already answers null
 * rather than throwing, and the shipped `favicon.ico` is a perfectly good
 * fallback — there is no state of the world where a tab icon is worth an error.
 */
@Injectable({ providedIn: 'root' })
export class FaviconService {
  private readonly publicApi = inject(PublicApi);
  private readonly document = inject(DOCUMENT);

  async applyWorkspaceLogo(): Promise<void> {
    const branding = await this.publicApi.branding();
    // No logo uploaded: keep Trackly's own, which is better than an empty tab.
    if (!branding?.logoUrl) return;
    this.setHref(branding.logoUrl);
  }

  /**
   * Points every icon link at `href`.
   *
   * The `type` attribute is dropped rather than guessed. A logo may be PNG, SVG,
   * JPEG or WebP, the URL carries no extension to infer from, and a wrong `type`
   * is worse than none — browsers sniff the bytes, but some will skip a link
   * whose declared type they do not support.
   */
  private setHref(href: string): void {
    const links = this.document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
    if (links.length === 0) {
      const link = this.document.createElement('link');
      link.rel = 'icon';
      link.href = href;
      this.document.head.appendChild(link);
      return;
    }
    links.forEach((link) => {
      link.removeAttribute('type');
      link.href = href;
    });
  }
}
