import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Trackly's own mark — a conversation bubble carrying a ticket's perforations,
 * which is the product in one shape: a ticket that talks back.
 *
 * Not a `tk-icon` case. `Icon` is a Lucide subset — 24×24, stroked, `fill:none`
 * — and this is filled at 256×256 with `fill-rule="evenodd"` cutting the two
 * message bars out of the body. Forcing it through that wrapper would mean
 * either a stroked outline of a solid mark or a second set of attributes on a
 * shared `<svg>`, and the brand would drift the first time the icon wrapper
 * changed. `tk-provider-mark` exists for exactly this reason; this is Trackly's
 * entry in the same category.
 *
 * **Colour comes from the call site.** The fill is `currentColor`, not the teal
 * of `public/favicon.svg`, because in the app the mark always sits on the brand
 * gradient tile and reads white — the bars become holes and the gradient shows
 * through them. The teal is for surfaces with no tile behind them: the browser
 * tab, and anywhere the file is used directly.
 */
@Component({
  selector: 'tk-trackly-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 256 256"
      fill="currentColor"
      fill-rule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M52 32h152a36 36 0 0 1 36 36v24a22 22 0 0 0 0 44v20a36 36 0 0 1-36 36H124l-44 40v-40H52a36 36 0 0 1-36-36v-20a22 22 0 0 0 0-44V68a36 36 0 0 1 36-36Z M76 104h104v22H76Z M76 144h64v22H76Z"
      />
    </svg>
  `,
})
export class TracklyMark {
  readonly size = input(24);
}
