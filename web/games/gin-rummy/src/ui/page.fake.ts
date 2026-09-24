// The gin page as a page fake for the tests beside ui/{render,home,local}.ts and scorer/main.ts:
// one fake element per `id="…"` in the page's markup (web/games/gin-rummy/index.html, which the
// test reads and passes in), with the classes, attributes and the input value as the markup has
// them, so the fixture cannot drift from the page (web/shared/edge/page.fake.ts `pageFromMarkup`,
// docs/design/shared-shell.md §5 B1). The buttons without ids that the paint reaches through
// queries (`#playModeSwitch .mode-btn`, `#playSubmenu button`) and the pile labels the paint
// writes into are declared here; a test may add its own queries and children for an id.
import {
  fakeEl,
  modeButtons,
  pageFromMarkup,
  type FakeEl,
  type FakeElOptions,
  type FakePage,
} from '../../../../shared/edge/page.fake.ts';

/** The three play modes, in the switch's order; `sandbox` ships hidden (docs/design/gin-sandbox.md). */
const MODES = ['online', 'local', 'sandbox'] as const;

export type GinPage = FakePage &
  Readonly<{
    /** The six mode buttons: the switch's and the submenu's, online, local, then sandbox. */
    modeButtons: ReadonlyArray<FakeEl>;
    submenuButtons: ReadonlyArray<FakeEl>;
    stockLabel: FakeEl;
    discardLabel: FakeEl;
  }>;

/**
 * Every element of the page, from its markup; `extra` adds queries or children to an id (its
 * classes and value still come from the markup) and `more` adds elements the markup has no id for.
 */
export const ginPage = (
  markup: string,
  extra: Readonly<Record<string, FakeElOptions>> = {},
  more: ReadonlyArray<FakeEl> = [],
): GinPage => {
  const switchButtons = modeButtons('modeSwitch', MODES, (mode) => [
    'mode-btn',
    ...(mode === 'sandbox' ? ['hidden'] : []),
  ]);
  const submenuButtons = modeButtons('submenu', MODES, (mode) =>
    mode === 'sandbox' ? ['hidden'] : [],
  );
  const sandboxOnly = (buttons: ReadonlyArray<FakeEl>): ReadonlyArray<FakeEl> =>
    buttons.slice(2, 3);
  const stockLabel = fakeEl('stockLabel', { classes: ['pile-label'] });
  const discardLabel = fakeEl('discardLabel', { classes: ['pile-label'] });
  const declared: Readonly<Record<string, FakeElOptions>> = {
    playModeSwitch: {
      queries: {
        '.mode-btn': switchButtons,
        '.mode-btn[data-mode="sandbox"]': sandboxOnly(switchButtons),
      },
    },
    playSubmenu: {
      queries: {
        button: submenuButtons,
        'button[data-mode]': submenuButtons,
        'button[data-mode="sandbox"]': sandboxOnly(submenuButtons),
      },
    },
    stockPile: { queries: { '.pile-label': [stockLabel] } },
    discardPile: { queries: { '.pile-label': [discardLabel] } },
  };
  const page = pageFromMarkup(markup, declared, extra, [
    ...switchButtons,
    ...submenuButtons,
    stockLabel,
    discardLabel,
    ...more,
  ]);
  return { ...page, modeButtons: switchButtons, submenuButtons, stockLabel, discardLabel };
};
