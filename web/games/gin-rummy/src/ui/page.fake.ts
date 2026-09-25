// The gin page as a page fake for the tests beside ui/{render,home,local}.ts and scorer/main.ts:
// the shell page (web/shared/edge/page.fake.ts `shellPage`: one fake element per `id="…"` in the
// page's markup, web/games/gin-rummy/index.html, which the test reads and passes in, with the
// classes, attributes and the input value as the markup has them, so the fixture cannot drift from
// the page, plus the mode buttons the home paint reaches through `#playModeSwitch .mode-btn` and
// `#playSubmenu button`; docs/design/shared-shell.md §5 B1, dry-round-2 E7) with gin's three modes,
// `sandbox` shipping hidden, and the pile labels the table paint writes into declared here. A test
// may add its own queries and children for an id.
import {
  fakeEl,
  shellPage,
  type FakeEl,
  type FakeElOptions,
  type ShellPage,
} from '../../../../shared/edge/page.fake.ts';

/** The three play modes, in the switch's order; `sandbox` ships hidden (docs/design/gin-sandbox.md). */
const MODES = ['online', 'local', 'sandbox'] as const;

export type GinPage = ShellPage &
  Readonly<{
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
  const stockLabel = fakeEl('stockLabel', { classes: ['pile-label'] });
  const discardLabel = fakeEl('discardLabel', { classes: ['pile-label'] });
  const page = shellPage(
    markup,
    { modes: MODES, hiddenModes: ['sandbox'] },
    {
      stockPile: { queries: { '.pile-label': [stockLabel] } },
      discardPile: { queries: { '.pile-label': [discardLabel] } },
    },
    extra,
    [stockLabel, discardLabel, ...more],
  );
  return { ...page, stockLabel, discardLabel };
};
