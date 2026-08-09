import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The union of `SsoProviderKind` and `EmailProviderKind` in @trackly/core — kept
 * in step with both. Google and Microsoft appear in each; a workspace that signs
 * in with Google and sends mail through Google should see one mark, not two.
 */
export type ProviderMarkName =
  | 'google'
  | 'microsoft'
  | 'facebook'
  | 'authly'
  | 'oidc'
  | 'saml'
  | 'yahoo'
  | 'smtp'
  | 'ses';

/**
 * The brand mark for one identity or mail provider — the thing that makes a row
 * of sign-in buttons or a grid of provider cards scannable at a glance.
 *
 * Separate from `tk-icon` on purpose. `Icon` is a Lucide subset: 24×24, stroked,
 * `currentColor`, so it inherits the surface it sits on. A brand mark is the
 * opposite of all four — Google's G is four fixed colours at its own aspect
 * ratio, and it is wrong the moment it inherits anything.
 *
 * **The literal hex here is deliberate** and is the one exception to the
 * no-hex-outside-styles.scss rule. These are the vendors' colours, not Trackly's
 * palette: they must not shift with the theme, and there is no token that could
 * define them. The generic marks (authly, oidc, saml, smtp) are *not* brands, so
 * they use `currentColor` like any other icon and tint from the call site.
 */
@Component({
  selector: 'tk-provider-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    @switch (name()) {
      @case ('google') {
        <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
        </svg>
      }
      @case ('microsoft') {
        <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 23 23" aria-hidden="true">
          <path fill="#F25022" d="M1 1h10v10H1z" />
          <path fill="#7FBA00" d="M12 1h10v10H12z" />
          <path fill="#00A4EF" d="M1 12h10v10H1z" />
          <path fill="#FFB900" d="M12 12h10v10H12z" />
        </svg>
      }
      @case ('facebook') {
        <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#1877F2"
            d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"
          />
        </svg>
      }
      @case ('yahoo') {
        <!-- Yahoo's mark is a wordmark, which is unreadable at 28px. Their
             purple with the Y it starts from carries the recognition that
             matters here. -->
        <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" aria-hidden="true">
          <rect width="24" height="24" rx="5" fill="#5F01D1" />
          <path
            fill="#fff"
            d="M6.2 6.6h2.9l2.6 4.3 2.6-4.3h2.9l-4.2 6.6v4.2h-2.6v-4.2z"
          />
        </svg>
      }
      @case ('ses') {
        <!-- Amazon SES. The AWS smile is a wordmark lockup; their orange on the
             cloud that SES actually is reads at tile size and stays theirs. -->
        <svg
          [attr.width]="size()"
          [attr.height]="size()"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#FF9900"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      }
      @case ('smtp') {
        <!-- Not a brand: "any mail server you can reach". Lucide "server",
             verbatim, tinted by the call site like every other generic mark. -->
        <svg
          [attr.width]="size()"
          [attr.height]="size()"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
          <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
          <path d="M6 6h.01" />
          <path d="M6 18h.01" />
        </svg>
      }
      @case ('saml') {
        <!-- Generic: a document that has been signed. SAML's whole security
             model is the signature on the assertion. -->
        <svg
          [attr.width]="size()"
          [attr.height]="size()"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      }
      @case ('authly') {
        <!-- Authly ships no logo mark, so this stands in for it: a fingerprint,
             because Authly's job is establishing who someone is. Distinct from
             the custom-OIDC key on purpose — the two sit side by side in the
             provider grid, and two identical tiles is worse than neither. -->
        <svg
          [attr.width]="size()"
          [attr.height]="size()"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
          <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
          <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
          <path d="M2 12a10 10 0 0 1 18-6" />
          <path d="M2 16h.01" />
          <path d="M21.8 16c.2-2 .131-5.354 0-6" />
          <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
          <path d="M8.65 22c.21-.66.45-1.32.57-2" />
          <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
        </svg>
      }
      @default {
        <!-- Custom OIDC: Lucide "key-round", verbatim. -->
        <svg
          [attr.width]="size()"
          [attr.height]="size()"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path
            d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
          />
          <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
        </svg>
      }
    }
  `,
})
export class ProviderMark {
  readonly name = input.required<ProviderMarkName>();
  /** 18 in a button · 20 in a list row · 28 on a provider tile. */
  readonly size = input(20);
}
