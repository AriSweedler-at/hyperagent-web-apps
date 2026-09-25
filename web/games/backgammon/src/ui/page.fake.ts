// The Sheshbesh page as a page fake for the tests beside ui/{render,home,local}.ts (design §7
// "Painter tests over `backgammonPage(markup)`"): the shell page (web/shared/edge/page.fake.ts
// `shellPage`: one fake element per `id="…"` in the page's markup, web/games/backgammon/index.html,
// which the test reads through `?raw` and passes in, with the classes, attributes and the input
// value as the markup has them, so the fixture cannot drift from the page, plus the mode buttons the
// home paint reaches through `#playModeSwitch .mode-btn` and `#playSubmenu button[data-mode]`;
// docs/design/shared-shell.md §5 B1, dry-round-2 E7) with its two modes, `online` shipping
// `active`. The 24 points, the bars, the dice and the trays all carry ids, so the board needs no
// declared queries; the opponent's strip has none and is declared here. A test may add its own
// queries and children for an id.
import {
  fakeEl,
  shellPage,
  type FakeEl,
  type FakeElOptions,
  type ShellPage,
} from '../../../../shared/edge/page.fake.ts';

/** The two play modes, in the markup's order (design §2.4: Online · Pass the phone). */
export const MODES = ['online', 'local'] as const;

export type BackgammonPage = ShellPage;

/**
 * Every element of the page, from its markup; `extra` adds queries or children to an id (its
 * classes and value still come from the markup) and `more` adds elements the markup has no id for.
 */
export const backgammonPage = (
  markup: string,
  extra: Readonly<Record<string, FakeElOptions>> = {},
  more: ReadonlyArray<FakeEl> = [],
): BackgammonPage => {
  // The opponent's strip has no id (render.ts toggles `to-move` on it through `#tableScreen`).
  const oppStrip = fakeEl('oppStrip', { classes: ['opp-strip'] });
  return shellPage(
    markup,
    { modes: MODES, activeSwitchMode: 'online' },
    { tableScreen: { queries: { '.opp-strip': [oppStrip] } } },
    extra,
    [oppStrip, ...more],
  );
};
