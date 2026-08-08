import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  booleanAttribute,
  inject,
  input,
  signal,
} from '@angular/core';

/**
 * Makes a popup escape whatever is trying to clip it.
 *
 * **The problem this exists to end.** A menu positioned `absolute` inside its
 * control is at the mercy of every ancestor: a table wrapped in
 * `overflow-x-auto` clips it (CSS computes the *other* axis to `auto` too, so
 * the card grows a scrollbar and swallows the list), and a modal body scrolls,
 * so it clips it as well. Both are ordinary places for a select to live, and the
 * failure looks like a broken component rather than a layout rule.
 *
 * `position: fixed` alone does not fix it either. A transformed ancestor becomes
 * the containing block for fixed descendants, and Trackly's modal animates in
 * with a transform — so a fixed menu inside a dialog is positioned against the
 * *dialog* and then clipped away by its `overflow: hidden`.
 *
 * The only thing that works is leaving the subtree, so this directive moves its
 * element to `<body>` and positions it against the viewport. Angular keeps
 * owning the node: its bindings still update, and it removes it by asking for
 * the node's *current* parent.
 *
 * ```html
 * <ul [tkFloating]="host.nativeElement" matchWidth>…</ul>
 * <div [tkFloating]="host.nativeElement" align="end">…</div>
 * ```
 *
 * Consumers still handle two things themselves, because only they can:
 * a focus-out check has to test this element separately (it is no longer inside
 * the host), and the element must be created only while the popup is open.
 */
@Directive({
  selector: '[tkFloating]',
  host: {
    class: 'menu-floating',
    '[style.left.px]': 'box().left',
    '[style.top.px]': 'box().top',
    '[style.width.px]': 'matchWidth() ? box().width : null',
    '[style.max-height.px]': 'box().maxHeight',
    // Hidden for exactly one frame: `end` alignment and the `.menu` min-width
    // both depend on the element's own size, which does not exist until it has
    // been laid out once. Showing it first means a visible jump.
    '[style.visibility]': 'ready() ? null : "hidden"',
  },
})
export class FloatingMenu {
  private readonly self = inject(ElementRef<HTMLElement>);

  /** The element to hang off — normally the control's host. */
  readonly anchor = input.required<HTMLElement>({ alias: 'tkFloating' });

  /** `end` right-aligns the menu with the anchor. Use it in the top bar. */
  readonly align = input<'start' | 'end'>('start');

  /** Take the anchor's width (a select) rather than sizing to content (a menu). */
  readonly matchWidth = input(false, { transform: booleanAttribute });

  protected readonly box = signal({ left: 0, top: 0, width: 0, maxHeight: 240 });
  protected readonly ready = signal(false);

  constructor() {
    // NOT measured here. `anchor` is a required input, and required inputs are
    // not set until after construction — reading one in a constructor throws
    // NG0950 and takes the whole popup with it. That is what `ready` is for:
    // the first measurement happens in afterNextRender, and until it lands the
    // element is hidden rather than parked at 0,0.
    const reposition = () => this.measure();
    // Capture phase: the scroll that matters is usually an ancestor's — a
    // table's overflow wrapper, a modal body, the page shell — and scroll
    // events do not bubble.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    afterNextRender(() => {
      document.body.appendChild(this.self.nativeElement);
      this.measure();
      this.ready.set(true);
    });

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      // Angular cannot clean up a node it can no longer reach from the view if
      // the owner is destroyed while the popup is open.
      this.self.nativeElement.remove();
    });
  }

  /**
   * Places the menu below the anchor, or above it when there is no room.
   *
   * Flipping matters: these sit near the bottom of a modal or a long table often
   * enough that a menu pinned below would open off-screen with no way to reach it.
   */
  private measure(): void {
    const rect = this.anchor().getBoundingClientRect();
    const gap = 4;
    const below = window.innerHeight - rect.bottom - gap;
    const above = rect.top - gap;
    const preferBelow = below >= 160 || below >= above;
    const maxHeight = Math.min(240, Math.max(120, preferBelow ? below : above));

    // Only knowable once laid out; falls back to the anchor on the first pass.
    const width = this.self.nativeElement.offsetWidth || rect.width;
    const left = this.align() === 'end' ? rect.right - width : rect.left;

    this.box.set({
      // Never off the left edge — a right-aligned menu wider than its trigger
      // sitting in a narrow column would otherwise start at a negative x.
      left: Math.max(gap, left),
      top: preferBelow ? rect.bottom + gap : rect.top - gap - maxHeight,
      width: rect.width,
      maxHeight,
    });
  }
}
