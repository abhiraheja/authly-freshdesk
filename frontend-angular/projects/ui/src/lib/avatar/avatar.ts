import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';
import { avatarColor, initials } from '@trackly/core';

/**
 * Initials avatar with a deterministic colour, or an image when one exists.
 *
 * The colour is derived from the name and is identical in light and dark on
 * purpose — an avatar's colour is part of how a person is recognised at a
 * glance, so it must not shift with the theme.
 */
@Component({
  selector: 'tk-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.background]': 'background()',
  },
  template: `
    @if (imageUrl()) {
      <img [src]="imageUrl()" [alt]="name()" />
    } @else {
      <span [style.font-size.px]="fontSize()">{{ label() }}</span>
    }
  `,
})
export class Avatar {
  readonly name = input<string | null>('');
  readonly imageUrl = input<string | null>(null);
  readonly size = input(32);
  /** Circular instead of the default squircle. Use for people in dense lists. */
  readonly round = input(false, { transform: booleanAttribute });
  /** Fallback glyph when there is no name at all — 'G' for guests. */
  readonly fallback = input('?');

  protected readonly label = computed(() => initials(this.name(), this.fallback()));
  protected readonly fontSize = computed(() => Math.max(9, Math.round(this.size() * 0.38)));

  protected readonly classes = computed(() =>
    ['avatar', this.round() ? 'avatar-round' : ''].filter(Boolean).join(' '),
  );

  /** Null for image avatars, so the tint can't bleed through a transparent PNG. */
  protected readonly background = computed(() =>
    this.imageUrl() ? null : avatarColor(this.name()),
  );
}
