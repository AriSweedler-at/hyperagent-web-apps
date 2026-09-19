// The gin page as a page fake for the tests beside ui/{render,home,local}.ts and scorer/main.ts:
// one fake element per `id="…"` in the page's markup (web/games/gin-rummy/index.html, which the
// test reads and passes in), with the classes and the input value as the markup has them, so the
// fixture cannot drift from the page. The buttons without ids that the paint reaches through
// queries (`#playModeSwitch .mode-btn`, `#playSubmenu button`) and the pile labels the paint
// writes into are declared here; a test may add its own queries and children for an id.
import {
  fakeEl,
  fakePage,
  type FakeEl,
  type FakeElOptions,
  type FakePage,
} from '../../../../shared/edge/page.fake.ts';

const TAG = /<(\w+)([^>]*?)\bid="([^"]+)"([^>]*)>/g;

const attrOf = (attrs: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

/** `id -> options` from the markup: classes and value as written. */
const optionsFromMarkup = (markup: string): ReadonlyMap<string, FakeElOptions> =>
  new Map(
    [...markup.matchAll(TAG)].map((m: Readonly<RegExpExecArray>) => {
      const attrs = `${m[2] ?? ''} ${m[4] ?? ''}`;
      const classes = attrOf(attrs, 'class');
      const value = attrOf(attrs, 'value');
      const title = attrOf(attrs, 'title');
      return [
        m[3] ?? '',
        {
          classes: classes === undefined ? [] : classes.split(/\s+/).filter((c) => c !== ''),
          ...(value === undefined ? {} : { value }),
          ...(title === undefined ? {} : { attrs: { title } }),
        },
      ];
    }),
  );

export type GinPage = FakePage &
  Readonly<{
    /** The four mode buttons: the switch's and the submenu's, online then local. */
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
  const fromMarkup = optionsFromMarkup(markup);
  const modeButtons = ['online', 'local'].map((mode) =>
    fakeEl(`modeSwitch-${mode}`, { classes: ['mode-btn'], attrs: { 'data-mode': mode } }),
  );
  const submenuButtons = ['online', 'local'].map((mode) =>
    fakeEl(`submenu-${mode}`, { attrs: { 'data-mode': mode } }),
  );
  const stockLabel = fakeEl('stockLabel', { classes: ['pile-label'] });
  const discardLabel = fakeEl('discardLabel', { classes: ['pile-label'] });
  const declared: Readonly<Record<string, FakeElOptions>> = {
    playModeSwitch: { queries: { '.mode-btn': modeButtons } },
    playSubmenu: { queries: { button: submenuButtons, 'button[data-mode]': submenuButtons } },
    stockPile: { queries: { '.pile-label': [stockLabel] } },
    discardPile: { queries: { '.pile-label': [discardLabel] } },
  };
  // Elements other ids declare as children are created first so the parents can reference them.
  const plain = [...fromMarkup.keys()].filter((id) => !(id in declared) && !(id in extra));
  const plainEls = new Map(plain.map((id) => [id, fakeEl(id, fromMarkup.get(id))]));
  const withChildren = (id: string, options: FakeElOptions): FakeEl =>
    fakeEl(id, { ...fromMarkup.get(id), ...options });
  const composed = [...fromMarkup.keys()]
    .filter((id) => id in declared || id in extra)
    .map((id) => withChildren(id, { ...declared[id], ...extra[id] }));
  const page = fakePage([
    ...plainEls.values(),
    ...composed,
    ...modeButtons,
    ...submenuButtons,
    stockLabel,
    discardLabel,
    ...more,
  ]);
  return { ...page, modeButtons, submenuButtons, stockLabel, discardLabel };
};
