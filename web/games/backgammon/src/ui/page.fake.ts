// The Sheshbesh page as a page fake for the tests beside ui/{render,home,local}.ts (gin's
// ui/page.fake.ts shape, design §7 "Painter tests over `backgammonPage(markup)`"): one fake
// element per `id="…"` in the page's markup (web/games/backgammon/index.html, which the test reads
// through `?raw` and passes in), with the classes, attributes and the input value as the markup
// has them, so the fixture cannot drift from the page (web/shared/edge/page.fake.ts
// `pageFromMarkup`, docs/design/shared-shell.md §5 B1). The 24 points, the bars, the dice and the
// trays all carry ids, so the board needs no declared queries; the mode buttons the home paint
// reaches through `#playModeSwitch .mode-btn` and `#playSubmenu button[data-mode]` have none and
// are declared here. A test may add its own queries and children for an id.
import {
  fakeEl,
  modeButtons,
  pageFromMarkup,
  type FakeEl,
  type FakeElOptions,
  type FakePage,
} from '../../../../shared/edge/page.fake.ts';

/** The two play modes, in the markup's order (design §2.4: Online · Pass the phone). */
export const MODES = ['online', 'local'] as const;

export type BackgammonPage = FakePage &
  Readonly<{
    /** The switch's mode buttons: online (the markup's `active`), then local. */
    modeButtons: ReadonlyArray<FakeEl>;
    /** The Play tab submenu's mode buttons, same order. */
    submenuButtons: ReadonlyArray<FakeEl>;
  }>;

/**
 * Every element of the page, from its markup; `extra` adds queries or children to an id (its
 * classes and value still come from the markup) and `more` adds elements the markup has no id for.
 */
export const backgammonPage = (
  markup: string,
  extra: Readonly<Record<string, FakeElOptions>> = {},
  more: ReadonlyArray<FakeEl> = [],
): BackgammonPage => {
  const switchButtons = modeButtons('modeSwitch', MODES, (mode) => [
    'mode-btn',
    ...(mode === 'online' ? ['active'] : []),
  ]);
  const submenuButtons = modeButtons('submenu', MODES);
  // The opponent's strip has no id (render.ts toggles `to-move` on it through `#tableScreen`).
  const oppStrip = fakeEl('oppStrip', { classes: ['opp-strip'] });
  const declared: Readonly<Record<string, FakeElOptions>> = {
    tableScreen: { queries: { '.opp-strip': [oppStrip] } },
    playModeSwitch: { queries: { '.mode-btn': switchButtons } },
    playSubmenu: { queries: { button: submenuButtons, 'button[data-mode]': submenuButtons } },
  };
  const page = pageFromMarkup(markup, declared, extra, [
    ...switchButtons,
    ...submenuButtons,
    oppStrip,
    ...more,
  ]);
  return { ...page, modeButtons: switchButtons, submenuButtons };
};
