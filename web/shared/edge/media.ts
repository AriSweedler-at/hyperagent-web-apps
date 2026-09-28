// A media query as the App learns it (docs/design/backgammon-landscape.md §5D: the turn gate,
// web/games/backgammon/src/ui/state.ts `gateOpen`, dispatched by main.ts as `viewport/portrait`).
// `watchMedia` asks the host's `matchMedia` once and reports `matches` now and on every `change`,
// so the orientation is state the reducer holds and the paint reads (docs/ARCHITECTURE.md: the
// paint is a function of the App), never a media query the painter consults. The host is
// structural (`MediaHostLike`: the window, or the boot's ctx carrying the window's `matchMedia`
// bound to it, boot.ts `BootCtx`); a host without `matchMedia` (the boot test's window) is
// reported nothing, so the page behaves as if the query never matched. `addEventListener` is
// optional on the list too: a list without it reports once and is never heard from again.

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
