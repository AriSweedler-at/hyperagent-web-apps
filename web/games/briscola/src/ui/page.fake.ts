// The briscola page as a page fake for the tests beside ui/{render,home,local}.ts (docs/design/
// briscola.md §5.6 "Painter tests over `briscolaPage(markup)`"): the shell page (web/shared/edge/
// page.fake.ts `shellPage`: one fake element per `id="…"` in the page's markup,
// web/games/briscola/index.html, which the test reads through `?raw` and passes in, with the
// classes, attributes and the input value as the markup has them, so the fixture cannot drift from
// the page, plus the mode buttons the home paint reaches through `#playModeSwitch .mode-btn` and
// `#playSubmenu button[data-mode]`) with its two modes, `online` shipping `active`. The table's
// containers all carry ids; what the paint reaches inside them by query (the trump badge's `<use>`,
// the cards a keyed rebuild wrote) has none, so the badge's symbol is declared here and a test
// declares the cards it wants to see toggled (`extra`), as backgammon's opponent strip is.
import {
  fakeEl,
  shellPage,
  type FakeEl,
  type FakeElOptions,
  type ShellPage,
} from '../../../../shared/edge/page.fake.ts';

/** The two play modes, in the markup's order (design §5.8: Online · Pass the phone). */
export const MODES = ['online', 'local'] as const;

export type BriscolaPage = ShellPage &
  Readonly<{
    /** The `<use>` inside `#trumpBadge` (render.ts `paintTrump` points its `href` at the suit's symbol). */
    trumpUse: FakeEl;
  }>;

/**
 * Every element of the page, from its markup; `extra` adds queries or children to an id (its
 * classes and value still come from the markup) and `more` adds elements the markup has no id for.
 */
export const briscolaPage = (
  markup: string,
  extra: Readonly<Record<string, FakeElOptions>> = {},
  more: ReadonlyArray<FakeEl> = [],
): BriscolaPage => {
  const trumpUse = fakeEl('trumpUse', { attrs: { href: '#suit-C' } });
  const page = shellPage(
    markup,
    { modes: MODES, activeSwitchMode: 'online' },
    { trumpBadge: { queries: { use: [trumpUse] } } },
    extra,
    [trumpUse, ...more],
  );
  return { ...page, trumpUse };
};
