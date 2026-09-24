// The Sheshbesh page as a page fake for the tests beside ui/{render,home,local}.ts (gin's
// ui/page.fake.ts shape, design §7 "Painter tests over `backgammonPage(markup)`"): one fake
// element per `id="…"` in the page's markup (web/games/backgammon/index.html, which the test reads
// through `?raw` and passes in), with the classes, attributes and the input value as the markup
// has them, so the fixture cannot drift from the page. The 24 points, the bars, the dice and the
// trays all carry ids, so the board needs no declared queries; the mode buttons the home paint
// reaches through `#playModeSwitch .mode-btn` and `#playSubmenu button[data-mode]` have none and
// are declared here. A test may add its own queries and children for an id.
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

/**
 * The `data-*` attributes of a tag, as written (`data-abs`, `data-own`, `data-seat`, `data-owner`),
 * and the boolean `disabled`/`checked` the controls ship with (`#undoBtn`, `#menuCurtainToggle`).
 */
const markupAttrsOf = (attrs: string): Readonly<Record<string, string>> => ({
  ...Object.fromEntries(
    [...attrs.matchAll(/\b(data-[\w-]+)="([^"]*)"/g)].map((m: Readonly<RegExpExecArray>) => [
      m[1] ?? '',
      m[2] ?? '',
    ]),
  ),
  ...(/\bdisabled\b/.test(attrs) ? { disabled: '' } : {}),
  ...(/\bchecked\b/.test(attrs) ? { checked: '' } : {}),
});

/** `id -> options` from the markup: classes, value, title and data attributes as written. */
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
          attrs: { ...markupAttrsOf(attrs), ...(title === undefined ? {} : { title }) },
        },
      ];
    }),
  );

/** The two play modes, in the markup's order (design §2.4: Online · Pass the phone). */
export const MODES = ['online', 'local'] as const;

export type BackgammonPage = FakePage &
  Readonly<{
    /** The switch's mode buttons: online, then local (the online one ships hidden, design §5.3). */
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
  const fromMarkup = optionsFromMarkup(markup);
  const modeButtons = MODES.map((mode) =>
    fakeEl(`modeSwitch-${mode}`, {
      classes: ['mode-btn', ...(mode === 'online' ? ['hidden'] : ['active'])],
      attrs: { 'data-mode': mode },
    }),
  );
  const submenuButtons = MODES.map((mode) =>
    fakeEl(`submenu-${mode}`, {
      classes: mode === 'online' ? ['hidden'] : [],
      attrs: { 'data-mode': mode },
    }),
  );
  const onlineOnly = (buttons: ReadonlyArray<FakeEl>): ReadonlyArray<FakeEl> => buttons.slice(0, 1);
  // The opponent's strip has no id (render.ts toggles `to-move` on it through `#tableScreen`).
  const oppStrip = fakeEl('oppStrip', { classes: ['opp-strip'] });
  const declared: Readonly<Record<string, FakeElOptions>> = {
    tableScreen: { queries: { '.opp-strip': [oppStrip] } },
    playModeSwitch: {
      queries: {
        '.mode-btn': modeButtons,
        '.mode-btn[data-mode="online"]': onlineOnly(modeButtons),
      },
    },
    playSubmenu: {
      queries: {
        button: submenuButtons,
        'button[data-mode]': submenuButtons,
        'button[data-mode="online"]': onlineOnly(submenuButtons),
      },
    },
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
    oppStrip,
    ...more,
  ]);
  return { ...page, modeButtons, submenuButtons };
};
