// A media query as the App learns it (docs/design/backgammon-landscape.md §5D: the turn gate,
// web/shared/ui/shell.ts `gateOpen`, dispatched by the boot as `viewport/portrait` and
// `viewport/landscape` for a game whose `ShellConfig.orientation` is `'landscape'`; the two
// predicates are spelled here once, `LANDSCAPE_PHONE` and `PORTRAIT_PHONE`, and every landscape
// `@media` in a theme copies the first verbatim: test/dist/landscape-predicate.test.ts).
// `watchMedia` asks the host's `matchMedia` once and reports `matches` now and on every `change`,
// so the orientation is state the reducer holds and the paint reads (docs/ARCHITECTURE.md: the
// paint is a function of the App), never a media query the painter consults. The host is
// structural (`MediaHostLike`: the window, or the boot's ctx carrying the window's `matchMedia`
// bound to it, boot.ts `BootCtx`); a host without `matchMedia` (the boot test's window) is
// reported nothing, so the page behaves as if the query never matched. `addEventListener` is
// optional on the list too: a list without it reports once and is never heard from again.

/**
 * A phone held sideways (docs/design/backgammon-landscape.md §3.1): a coarse pointer, landscape,
 * under 500px tall. The phone's shape, never its width (a Pixel 8 and every Pro Max are 900px
 * wide sideways); a fine pointer (every desktop window, the 1280x800 goldens) never matches.
 * `any-pointer`, not `pointer`: a mouse click in an emulated touch context flips `pointer: coarse`
 * off, and a phone answers both alike. The theme's landscape blocks and the boot's watcher read
 * the same string, so the board's layout and the App's `landscapePhone` cannot disagree.
 */
export const LANDSCAPE_PHONE =
  '(any-pointer: coarse) and (orientation: landscape) and (max-height: 500px)';

/**
 * A phone held upright, as the turn gate asks the window (docs/design/backgammon-landscape.md
 * §5D): the mirror of `LANDSCAPE_PHONE` with the bound on the short side, a short side under 500px
 * (a portrait tablet is 744+ wide and fits a stood-on-end board anyway).
 */
export const PORTRAIT_PHONE =
  '(any-pointer: coarse) and (orientation: portrait) and (max-width: 500px)';

/** What `matchMedia` returns, the two members the watcher reads. */
export type MediaQueryListLike = Readonly<{
  matches: boolean;
  addEventListener?: (
    type: 'change',
    listener: (event: Readonly<{ matches: boolean }>) => void,
  ) => void;
}>;

/** The window (or the boot's ctx) as the watcher reads it: `matchMedia`, where there is one. */
export type MediaHostLike = Readonly<{
  matchMedia?: (query: string) => MediaQueryListLike;
}>;

/** Report `query`'s `matches` now and on every change; nothing without `matchMedia`. */
export const watchMedia = (
  host: MediaHostLike,
  query: string,
  onChange: (matches: boolean) => void,
): void => {
  const list = host.matchMedia?.(query);
  if (list === undefined) return;
  onChange(list.matches);
  list.addEventListener?.('change', (event) => {
    onChange(event.matches);
  });
};
