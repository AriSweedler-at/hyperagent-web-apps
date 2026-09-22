// Computed-style goldens (docs/MIGRATION.md step 14; docs/ARCHITECTURE.md "Testing pyramid":
// "~60 selectors at 390x844 and 1280x800 recorded before any CSS moves"). One browser context per
// game and viewport, with the same seeded `Math.random` and stepping `Date.now` as
// tools/parity/gin-dom-parity.ts, drives the served page through its representative screens (home,
// hosting, a pass-and-play hand with a selection, the result sheet, the overlays, the scorer;
// menu, name forms, lobby with computers, table mid-round, the reveal, the ladder, spectating) and
// at each one reads `getComputedStyle` for every selector in SELECTORS over PROPERTIES, a fixed
// list that depends on neither layout nor font metrics, plus every `--token` the stylesheets
// declare (all of them on `:root`, and on any other element only where its value differs from the
// root's). Animations are rewound to their first frame and transitions finished before each read,
// the mouse is parked in the top-left corner so no `:hover` rule applies, and `font-family` is
// normalised across platforms
// (FONT_ALIASES), so the values are a function of the CSS alone and a golden recorded on macOS
// agrees with the Linux runner. e2e/computed-styles.spec.ts (the `pages` project) replays the capture against the
// served dist/ and deep-equals it with test/fixtures/styles/<game>.<viewport>.json; a CSS move that
// changes any computed value shows up as a selector/property diff.
//
// The comparison is additive for custom properties only: a `--token` the capture declares on a
// selector that the golden never recorded there is a note ("new token --x = v"), printed apart and
// ignored by the exit code, because a new name in the shared vocabulary (web/shared/styles/
// tokens.css, or a theme's alias onto one) changes what no rule reads yet; a `--token` that is
// missing or changed, and every PROPERTIES change, is a difference and fails the check. Re-record
// to absorb the notes once the new names are intended (docs/MIGRATION.md step 14 Deviations).
//
// Locally (Chromium from `npx playwright install`; `npm run build` first):
//   node --experimental-strip-types tools/parity/computed-styles.ts            # rewrite the goldens
//   node --experimental-strip-types tools/parity/computed-styles.ts --check    # compare, exit 1 on a diff
// It serves dist/ through tools/serve-dist.ts and a local PeerServer (`peer`) on free ports; the
// pages reach the broker through their `?peer=` hook and the STUN-only ICE fixture through `?ice=`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';

import { chromium, type Browser, type Page } from '@playwright/test';
import { PeerServer } from 'peer';

import { routeOffline } from '../../e2e/fixtures/offline.ts';
import { seedScript } from '../../e2e/fixtures/seed.ts';
import { PAGES_BASE_PATH } from '../../e2e/fixtures/site.ts';
import { REPO_ROOT, isMain } from '../legacy/extract.ts';
import { startServer } from '../serve-dist.ts';
import { EPOCH, SEED, acceptIfShown, clockScript, readView } from './gin-dom-parity.ts';

export type Game = 'gin-rummy' | 'fidice';
export const GAMES: ReadonlyArray<Game> = ['gin-rummy', 'fidice'];

export type Viewport = Readonly<{ width: number; height: number }>;
/** A phone (iPhone 12-class) and a laptop window. */
export const VIEWPORTS: ReadonlyArray<Viewport> = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
export const viewportName = (v: Viewport): string => `${String(v.width)}x${String(v.height)}`;

export const GOLDEN_DIR = 'test/fixtures/styles';
export const goldenPath = (game: Game, viewport: Viewport): string =>
  resolve(REPO_ROOT, GOLDEN_DIR, `${game}.${viewportName(viewport)}.json`);

/**
 * The properties read for every selector, as Chromium serialises them. Shorthands (`padding`,
 * `margin`, `border-color/style/width`, `border-radius`, `gap`) carry all four sides / both axes in
 * canonical form. Nothing here depends on layout or font metrics: no widths, heights, positions or
 * line heights; `font-size` and `letter-spacing` resolve from the root font size and the viewport
 * only, and `margin` is read through the Typed OM so an `auto` side stays `auto` instead of the
 * pixels layout gave it.
 */
export const PROPERTIES: ReadonlyArray<string> = [
  'background-color',
  'background-image',
  'border-color',
  'border-radius',
  'border-style',
  'border-width',
  'box-shadow',
  'color',
  'display',
  'font-family',
  'font-size',
  'font-weight',
  'gap',
  'letter-spacing',
  'margin',
  'opacity',
  'padding',
  'text-transform',
  'visibility',
];

/** A value longer than this (a data: URL) is stored as its length and sha256 instead. */
const LONG_VALUE = 200;

/**
 * What is read on each page: `:root`, `body`, the ids the markup gives the screens and the
 * class names the TypeScript toggles (theme.css rules named after them), with the state classes
 * combined as the rules combine them (`.card.selected`), and the few pseudo-elements the rules
 * draw. A selector that matches nothing on a screen records `null` there.
 */
export const SELECTORS: Readonly<Record<Game, ReadonlyArray<string>>> = {
  'gin-rummy': [
    ':root',
    'body',
    '#app',
    'h1',
    '.subtitle',
    '.card-box',
    '.btn',
    '.btn-primary',
    '.btn-gold',
    '.btn-secondary',
    '.btn-ghost',
    '.btn-sm',
    '.btn:disabled',
    'input[type="text"]',
    'input[type="number"]',
    'label',
    '.row',
    '.icon-btn',
    '.code-input',
    '.room-code',
    '.empty-note',
    '.pulse',
    '#tableScreen',
    '.topbar',
    '.badge',
    '.badge.dim',
    '.opp-strip',
    '.opp-name',
    '.opp-score',
    '.opp-cards .card.tiny',
    '.opp-count',
    '.conn-dot',
    '.conn-dot.on',
    '.table-center',
    '.pile-peek',
    '.pile-peek:disabled',
    '.pile',
    '.pile.tappable',
    '.pile.blocked',
    '.pile-label',
    '.status-banner',
    '.status-banner.mine',
    '.status-main',
    '.status-sub',
    '.last-action',
    '.hand-area',
    '.hand-header',
    '.hand-header .dw',
    '.hand-header .dw.tappable-dw',
    '.alt-badge',
    '.arrange-btn',
    '.arrange-btn:disabled',
    '.arrange-btn.due',
    '.hand',
    '.hand.active',
    '.group',
    '.group.n3',
    '.slot',
    '.slot.m0',
    '.slot.dead',
    '.slot.human::after',
    '.slot.head',
    '.slot.ghost',
    '.slot.ghost.open',
    '.slot.ghost.open::before',
    '.slot.ghost.shown',
    '.meld-group.m0',
    '.meld-group.m1',
    '.meld-group.dead',
    '.actions',
    '.actions .btn',
    '.waiting-note',
    '.card',
    '.card.red',
    '.card .rank',
    '.card .rank.br',
    '.card .suit',
    '.card.mini',
    '.card.big',
    '.card.empty',
    '.card.back',
    '.card.back.tiny',
    '.card.selected',
    '.card.fresh',
    '.card.fresh::after',
    '.card.locked',
    '.card.locked::before',
    '.overlay',
    '.sheet',
    '.sheet-title',
    '.sheet-sub',
    '.rules-list',
    '.rules-list li',
    '.rules-list li strong',
    '.rr-panel',
    '.rr-panel.scored',
    '.rr-head',
    '.rr-head small',
    '.rr-pts',
    '.rr-label',
    '.rr-melds',
    '.rr-melds .meld-group',
    '.dc-grid',
    '.dc-row',
    '.dc-suit',
    '.dc',
    '.dc.seen',
    '.dc.held',
    '.dc.top',
    '.dc-toggle',
    '#rrBody',
    '.rr-totals',
    '.rr-totals strong',
    '.history-round',
    '.history-scores',
    '.history-time',
    '.standing-row',
    '.standing-row.winner',
    '.standing-rank',
    '.standing-name',
    '.standing-total',
    '#toast',
    '.setup-players',
    '.player-input-row',
    '.player-card',
    '.player-card.leader',
    '.player-head',
    '.player-name',
    '.player-total',
    '.stepper',
    '.stepper button',
    '.stepper input',
    '.stepper input:disabled',
    '.bonus-row',
    '.chip',
    '.chip.active',
    '#submitRoundBar',
    '.history-actions',
    '.history-actions button',
    '.tabbar',
    '.tab-wrap',
    '.tab-btn',
    '.tab-btn.active',
    '.tab-submenu',
    '.tab-submenu button',
    '.mode-switch',
    '.mode-btn',
    '.mode-btn.active',
    '.voice-fab',
  ],
  fidice: [
    ':root',
    'body',
    'body::before',
    'header',
    '.badge',
    '.brand',
    '.brand .cup',
    'nav.tabs',
    'nav.tabs button',
    'nav.tabs button.active',
    '.pill',
    'main',
    '.panel',
    '.row',
    '.stack',
    '.muted',
    '.small',
    '.spacer',
    'button',
    'button:disabled',
    '.btn-primary',
    '.btn-secondary',
    '.btn-danger',
    '.btn-ghost',
    '.btn-big',
    'input',
    'select',
    'label',
    '.menu',
    '.menu h1',
    '.menu .where',
    '.menu .tag',
    '.menu .links button',
    '.menu-options',
    '.opt',
    '.opt.primary',
    '.opt-ic',
    '.opt-text',
    '.opt-t',
    '.opt-s',
    '.opt-go',
    '.difficulty',
    '.difficulty label',
    '.seg',
    '.seg-btn',
    '.seg-btn.on',
    '#difficultyBlurb',
    '.cfg .cfg-current',
    '.cfg-section',
    '.cfg-section h3',
    '.cfg-grid',
    '.cfg-card',
    '.cfg-card.on',
    '.cfg-card.on::after',
    '.cfg-name',
    '.cfg-blurb',
    '.cfg-tag',
    '.cfg-learner',
    '.bot-strategy',
    '.locals',
    '.locals input',
    '.lost',
    '.lost.clean',
    '.menu .join input',
    '.dice-hero',
    '.dice',
    '.die',
    '.die.sm',
    '.die.xs',
    '.die.hidden-face',
    '.die.hidden-face::after',
    '.die.abs',
    '.die.abs.abs-pine',
    '.die.abs.abs-kayak',
    '.die.abs.abs-blank',
    '.die.abs.abs-step1',
    '.die.abs.abs-step5',
    '.die.clickable',
    '.ladder-head',
    '.ladder-head .legend',
    '.chip',
    '.ladder',
    '.lrow',
    '.lrow.catrow',
    '.lrow.catrow.open',
    '.lrow.catrow .nm',
    '.lrow.catrow .nm::before',
    '.lrow.catrow .sub',
    '.lrow.hand',
    '.lrow .rank',
    '.lrow .rank b',
    '.lrow .nm',
    '.lrow .sub',
    '.lrow .dice',
    '.lrow.group',
    '.lrow.group .nm::before',
    '.lrow.variant',
    '.lrow.variant .nm',
    '.lrow.mark-bid',
    '.lrow.mark-cup',
    '.tab-marker.bid',
    '.tab-marker.cup',
    '.code',
    '.share',
    '.share input',
    '.seats',
    '.seat',
    '.seat.me',
    '.seat.holder',
    '.seat .nm',
    '.seat .lives',
    '.seat .status',
    '.seat .cupbadge',
    '.bot-controls',
    '.bot-controls .bot-name',
    '.dot',
    '.empty-seat',
    '.game',
    '.table',
    '.table::after',
    '.table h3',
    '.zone',
    '.zone .dice',
    '.zone .hint',
    '.cup-visual',
    '.cup-icon',
    '.bidcard',
    '.bidcard .lbl',
    '.bidcard .val',
    '.bidcard .who',
    '.turnbar',
    '.turnbar.wait',
    '.actions',
    '.actions .step',
    '.actions .step h4',
    '.actions .step h4 .num',
    '.actions .step p',
    '.bidpick',
    '.bidsearch input',
    '.bidlist',
    '.bidopt',
    '.bidopt.hi',
    '.bidopt .nm',
    '.bidopt .sub',
    '.tag-g',
    '.bidsel',
    '.bidsel .lbl',
    '.bidsel .val',
    '.side',
    '.log',
    '.log div',
    '.log div.big',
    '.log .t',
    '.reveal',
    '.reveal .bigval',
    '.reveal .res',
    '.reveal .res.good',
    '.reveal .res.bad',
    '.toast',
    '.toast.show',
    '.banner',
    '.spec',
    '.ticker',
    '.ticker .card',
    '.ticker .card.cup',
    '.ticker .card.bid',
    '.ticker .bigval',
    '.toggle',
    '.bidhist',
    '.bidhist div',
    '.bidhist div.cur',
    '.rules',
    '.rules h2',
    '.rules h3',
    '.rules p',
    '.rules .steps li',
    '.rules .steps li::before',
    '.rules .ex',
  ],
};

// ---- the golden --------------------------------------------------------------------------------------

/** One element's reading: PROPERTIES in order, plus the custom properties that differ from the root's. */
export type StyleRecord = Readonly<{
  v: ReadonlyArray<string>;
  vars: Readonly<Record<string, string>>;
}>;

/** Selector -> style hash, or null when nothing matched. */
export type Screen = Readonly<Record<string, string | null>>;

/** The capture as the driver and the comparison see it: every screen in full. */
export type Golden = Readonly<{
  game: Game;
  viewport: string;
  properties: ReadonlyArray<string>;
  /** The `:root` custom properties, as read on the first screen (every screen reads them again). */
  tokens: Readonly<Record<string, string>>;
  /** Screen (numbered in capture order) -> its reading. */
  screens: Readonly<Record<string, Screen>>;
  /** Style hash -> the reading it names; equal readings on any screen share one entry. */
  styles: Readonly<Record<string, StyleRecord>>;
}>;

/**
 * The file form, kept small: every distinct value string once in `values`, style records as
 * indices into it, and each screen as the selectors whose hash changed since the previous screen
 * (the first screen is written in full). Keys of every object are sorted.
 */
export type GoldenFile = Readonly<{
  game: Game;
  viewport: string;
  properties: ReadonlyArray<string>;
  tokens: Readonly<Record<string, string>>;
  values: ReadonlyArray<string>;
  styles: Readonly<
    Record<string, Readonly<{ v: ReadonlyArray<number>; vars: Readonly<Record<string, number>> }>>
  >;
  screens: ReadonlyArray<Readonly<{ name: string; changes: Screen }>>;
}>;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Platform spellings of one font-family, collapsed to the macOS form so goldens agree between
 * macOS and the Linux runners: Chromium on macOS resolves the `BlinkMacSystemFont` alias to
 * `system-ui` when it parses the stylesheet, and the UA's default serif (what `:root` shows before
 * any rule sets a font) is `Times` on macOS and `"Times New Roman"` on Linux.
 */
export const FONT_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBlinkMacSystemFont\b/g, '"system-ui"'],
  [/"Times New Roman"/g, 'Times'],
];

export const normaliseFont = (value: string): string =>
  FONT_ALIASES.reduce((v, [from, to]) => v.replace(from, to), value);

/** A data: URL or other very long value keeps its length and hash, which still pins it. */
export const compactValue = (value: string): string =>
  value.length > LONG_VALUE
    ? `<${String(value.length)} chars sha256:${sha256(value).slice(0, 16)}>`
    : value;

export const hashRecord = (record: StyleRecord): string =>
  sha256(JSON.stringify({ v: record.v, vars: sortKeys(record.vars) })).slice(0, 12);

const byKey = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number =>
  a < b ? -1 : a > b ? 1 : 0;
const sortKeys = <T>(record: Readonly<Record<string, T>>): Readonly<Record<string, T>> =>
  Object.fromEntries(Object.entries(record).sort(byKey));

export const encode = (golden: Golden): GoldenFile => {
  const values = [
    ...new Set(Object.values(golden.styles).flatMap((r) => [...r.v, ...Object.values(r.vars)])),
  ].sort();
  const index = new Map(values.map((value, i) => [value, i] as const));
  const at = (value: string): number => index.get(value) ?? -1;
  const names = Object.keys(golden.screens).sort();
  const screens = names.map((name, i) => {
    const current = golden.screens[name] ?? {};
    const previous = i === 0 ? null : (golden.screens[names[i - 1] ?? ''] ?? {});
    const changes = Object.fromEntries(
      Object.entries(current).filter(([sel, hash]) => previous?.[sel] !== hash),
    );
    return { name, changes: sortKeys(changes) };
  });
  return {
    game: golden.game,
    viewport: golden.viewport,
    properties: golden.properties,
    tokens: sortKeys(golden.tokens),
    values,
    styles: sortKeys(
      Object.fromEntries(
        Object.entries(golden.styles).map(([hash, r]) => [
          hash,
          {
            v: r.v.map(at),
            vars: sortKeys(Object.fromEntries(Object.entries(r.vars).map(([k, v]) => [k, at(v)]))),
          },
        ]),
      ),
    ),
    screens,
  };
};

export const decode = (file: GoldenFile): Golden => {
  const value = (i: number): string => file.values[i] ?? `<no value ${String(i)}>`;
  const screens = file.screens.reduce<Readonly<Record<string, Screen>>>((acc, screen, i) => {
    const previous = i === 0 ? {} : (acc[file.screens[i - 1]?.name ?? ''] ?? {});
    return { ...acc, [screen.name]: { ...previous, ...screen.changes } };
  }, {});
  return {
    game: file.game,
    viewport: file.viewport,
    properties: file.properties,
    tokens: file.tokens,
    screens,
    styles: Object.fromEntries(
      Object.entries(file.styles).map(([hash, r]) => [
        hash,
        {
          v: r.v.map(value),
          vars: Object.fromEntries(Object.entries(r.vars).map(([k, i]) => [k, value(i)])),
        },
      ]),
    ),
  };
};

/** JSON with objects one key per line and arrays of primitives on one line; arrays of objects one per line. */
const format = (value: unknown, indent: string): string => {
  if (Array.isArray(value)) {
    const items: ReadonlyArray<unknown> = value;
    if (items.length === 0) return '[]';
    if (items.every((v) => typeof v !== 'object' || v === null))
      return `[${items.map((v) => JSON.stringify(v)).join(', ')}]`;
    return `[\n${items.map((v) => `${indent}  ${format(v, `${indent}  `)}`).join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${format(v, `${indent}  `)}`)
      .join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
};

/** The golden's JSON (see `format`), with a trailing newline. */
export const serialise = (golden: Golden): string => `${format(encode(golden), '')}\n`;
export const parse = (text: string): Golden => decode(JSON.parse(text) as GoldenFile);

// ---- the reading -------------------------------------------------------------------------------------

/**
 * Runs in the page (a string: this file is node-side and has no DOM types). Returns
 * `{ [selector]: { v, vars } | null }`. Every transition is finished and every animation rewound
 * to its first frame and paused, the declared custom properties are collected from the
 * stylesheets.
 */
const READ_SCRIPT = `((selectors, properties) => {
  document.getAnimations().forEach((a) => {
    try {
      if (a instanceof CSSTransition) a.finish();
      else { a.pause(); a.currentTime = 0; }
    } catch (_) {}
  });
  const declared = new Set();
  const walk = (rules) => Array.from(rules).forEach((r) => {
    if (r.style) (r.style.cssText.match(/--[A-Za-z0-9_-]+(?=\\s*:)/g) || []).forEach((p) => declared.add(p));
    if (r.cssRules) walk(r.cssRules);
  });
  Array.from(document.styleSheets).forEach((s) => { try { walk(s.cssRules); } catch (_) {} });
  const tokens = Array.from(declared).sort();
  const root = document.documentElement;
  const rootStyle = getComputedStyle(root);
  // getComputedStyle resolves an auto margin to the pixels layout gave it; the Typed OM keeps the
  // computed value ('auto'), which is what the stylesheet says. Pseudo-elements have no Typed OM.
  const SIDES = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
  const margin = (el, pseudo, cs) => {
    if (pseudo !== null || typeof el.computedStyleMap !== 'function') return cs.getPropertyValue('margin');
    const map = el.computedStyleMap();
    return SIDES.map((side) => String(map.get(side))).join(' ');
  };
  const read = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo);
    const vars = {};
    tokens.forEach((p) => {
      const value = cs.getPropertyValue(p);
      if (value === '') return;
      if (el === root && pseudo === null) vars[p] = value;
      else if (value !== rootStyle.getPropertyValue(p)) vars[p] = value;
    });
    return {
      v: properties.map((p) => (p === 'margin' ? margin(el, pseudo, cs) : cs.getPropertyValue(p))),
      vars,
    };
  };
  const out = {};
  selectors.forEach((sel) => {
    const m = /^(.*?)(::[a-z-]+)?$/.exec(sel);
    const base = m[1];
    const pseudo = m[2] || null;
    const el = base === ':root' ? root : document.querySelector(base);
    out[sel] = el ? read(el, pseudo) : null;
  });
  return out;
})`;

type RawReading = Readonly<Record<string, StyleRecord | null>>;

const readStyles = async (page: Page, game: Game): Promise<RawReading> => {
  const raw = await page.evaluate<RawReading>(
    `${READ_SCRIPT}(${JSON.stringify(SELECTORS[game])}, ${JSON.stringify(PROPERTIES)})`,
  );
  return Object.fromEntries(
    Object.entries(raw).map(([sel, r]) => [
      sel,
      r === null
        ? null
        : {
            v: r.v.map((value, i) =>
              compactValue(PROPERTIES[i] === 'font-family' ? normaliseFont(value) : value),
            ),
            vars: Object.fromEntries(
              Object.entries(r.vars).map(([k, value]) => [k, compactValue(value)]),
            ),
          },
    ]),
  );
};

/** Collects the screens of one page into a Golden. */
class Recorder {
  private readonly game: Game;
  private readonly viewport: Viewport;
  private readonly page: Page;
  private readonly screens: Record<string, Record<string, string | null>> = {};
  private readonly styles: Record<string, StyleRecord> = {};
  private tokens: Readonly<Record<string, string>> | null = null;
  private count = 0;
  private readonly started = Date.now();

  constructor(game: Game, viewport: Viewport, page: Page) {
    this.game = game;
    this.viewport = viewport;
    this.page = page;
  }

  /** Read every selector now and file it under `name` (numbered so the JSON keeps capture order). */
  readonly shot = async (name: string): Promise<void> => {
    // The last click left the pointer over its target; park it so no :hover rule is read (where
    // that target sits depends on font metrics, which differ between platforms).
    await this.page.mouse.move(0, 0);
    const reading = await readStyles(this.page, this.game);
    if (process.env['STYLES_TRACE'] !== undefined)
      console.log(`${String(Date.now() - this.started).padStart(6)} ms  shot: ${name}`);
    this.count += 1;
    const key = `${String(this.count).padStart(2, '0')} ${name}`;
    const byId = Object.fromEntries(
      Object.entries(reading).map(([sel, r]) => {
        if (r === null) return [sel, null];
        const hash = hashRecord(r);
        this.styles[hash] = r;
        return [sel, hash];
      }),
    );
    this.screens[key] = byId;
    this.tokens ??= reading[':root']?.vars ?? {};
  };

  golden(): Golden {
    return {
      game: this.game,
      viewport: viewportName(this.viewport),
      properties: PROPERTIES,
      tokens: this.tokens ?? {},
      screens: this.screens,
      styles: this.styles,
    };
  }
}

// ---- the drivers -------------------------------------------------------------------------------------

type Shot = (name: string) => Promise<void>;

const click = async (page: Page, selector: string): Promise<void> => {
  await page.locator(selector).first().click();
};
const fill = async (page: Page, selector: string, value: string): Promise<void> => {
  await page.locator(selector).fill(value);
};
const visible = async (page: Page, selector: string): Promise<void> => {
  await page.locator(selector).first().waitFor({ state: 'visible' });
};

/**
 * Gin: the home tabs, hosting on the broker, a pass-and-play hand to a knock (the driver reads the
 * legacy hook `window.__gin.app.view` for its choices as gin-dom-parity does, a one-point target so
 * the first scored hand ends the game), the overlays, the endgame and a Score Counter session. A
 * draw is shot twice: the drawn card in the ghost slot, then accepted into the hand
 * (docs/design/gin-draw-ghost-slot.md §9).
 */
const driveGin = async (page: Page, shot: Shot): Promise<void> => {
  await page.waitForFunction('typeof window.__gin === "object"');
  await visible(page, '#homeScreen');
  await shot('home: play tab, online');
  await click(page, '#tabRulesBtn');
  await shot('home: rules tab');
  await click(page, '#tabScoreBtn');
  await shot('home: score tab');
  await click(page, '#tabPlayBtn');
  await shot('home: play tab with the submenu');

  // ---- hosting: the room opens on the local broker ----
  await fill(page, '#nameInput', 'Ann');
  await click(page, '#hostBtn');
  await visible(page, '#hostWaitScreen');
  await page
    .locator('#hostWaitStatus')
    .filter({ hasText: 'Waiting for your opponent to join' })
    .waitFor();
  await shot('host: waiting for the opponent');
  await click(page, '#cancelHostBtn');
  await visible(page, '#homeScreen');

  // ---- pass and play ----
  await click(page, '#playModeSwitch .mode-btn[data-mode="local"]');
  await shot('home: pass & play mode');
  await fill(page, '#p1NameInput', 'Ann');
  await fill(page, '#p2NameInput', 'Bob');
  await fill(page, '#localTargetInput', '1');
  await click(page, '#localBtn');
  await visible(page, '#curtainOverlay');
  await shot('local: dealt, curtain up');
  await click(page, '#curtainBtn');
  await shot('local: upcard decision');
  await click(page, '#actions [data-act="passUpcard"]');
  await click(page, '#curtainBtn');
  await click(page, '#actions [data-act="takeUpcard"]');
  await shot('local: dealer took the upcard (locked card)');
  await acceptIfShown(page);
  const taken = await readView(page);
  const lockedId = taken?.drawnFromDiscard ?? null;
  const firstFree = taken?.me.hand.find((c) => c.id !== lockedId)?.id ?? null;
  if (lockedId === null || firstFree === null) throw new Error('no upcard was taken');
  await click(page, `#hand .card[data-card="${firstFree}"]`);
  await shot('local: a card selected');
  await click(page, '#actions [data-act="discard"]');
  await shot('local: discarded, curtain for the other seat');

  // Turns until a knock: draw from the stock, discard what leaves the least deadwood. A hand
  // whose stock runs out is void: its sheet is continued and the redeal played on.
  const shotOnce = new Set<string>();
  const once = async (name: string): Promise<void> => {
    if (shotOnce.has(name)) return;
    shotOnce.add(name);
    await shot(name);
  };
  const playTurn = async (): Promise<'knocked' | 'played' | 'void'> => {
    // The curtain is up between seats; after a void hand's redeal the table shows directly.
    if (await page.locator('#curtainOverlay').isVisible()) await click(page, '#curtainBtn');
    const before = await readView(page);
    if (before === null) throw new Error('no view');
    if (before.phase === 'roundOver') return 'void';
    if (before.phase === 'upcard') {
      // A redeal after a void hand: both seats pass the upcard, then the non-dealer draws.
      await click(page, '#actions [data-act="passUpcard"]');
      return 'played';
    }
    if (before.phase === 'draw') {
      if (before.forceStock) await once('turn: both passed, the discard pile is blocked');
      await click(page, '#stockPile');
      await once('turn: drew from the stock (ghost slot shown)');
      await acceptIfShown(page);
      await once('turn: accepted the drawn card (fresh)');
    }
    const view = await readView(page);
    const discardOptions = view?.discardOptions ?? null;
    if (discardOptions === null) throw new Error('no discard options');
    const options = Object.entries(discardOptions)
      .filter(([, o]) => o.locked !== true)
      .map(([id, o]) => ({ id, deadwood: o.deadwood ?? Infinity, canKnock: o.canKnock === true }));
    const knock = options.find((o) => o.canKnock);
    const best = [...options].sort((a, b) => a.deadwood - b.deadwood)[0];
    if ((view?.meldOptions.length ?? 0) > 1) {
      await click(page, '#deadwoodInfo');
      await once('turn: meld chooser open');
      await click(page, '#meldOptionList [data-meld-opt]');
    }
    if (knock !== undefined) {
      await click(page, `#hand .card[data-card="${knock.id}"]`);
      await shot('turn: knock available');
      await click(page, '#actions [data-act="knock"]');
      await shot('round over: result sheet');
      return 'knocked';
    }
    if (best === undefined) throw new Error('no discard');
    await click(page, `#hand .card[data-card="${best.id}"]`);
    await click(page, '#actions [data-act="discard"]');
    const after = await readView(page);
    if (after?.phase === 'roundOver') {
      await once('round over: void hand (stock ran out)');
      return 'void';
    }
    return 'played';
  };
  const untilKnock = async (turn: number): Promise<void> => {
    if (turn > 80) throw new Error('no knock within 80 turns; pick another SEED');
    const outcome = await playTurn();
    if (outcome === 'knocked') return;
    if (outcome === 'void') {
      await click(page, '#rrContinueBtn');
      await page.locator('#roundResultOverlay').waitFor({ state: 'hidden' });
    }
    await untilKnock(turn + 1);
  };
  await untilKnock(1);

  // ---- the hand over: the table behind the sheet, the overlays, the endgame ----
  await click(page, '#rrHideBtn');
  await shot('round over: table behind the sheet');
  await click(page, '#historyBtn');
  await shot('round over: history overlay');
  await click(page, '#closeHistoryBtn');
  await click(page, '#rulesBtnGame');
  await shot('round over: rules overlay');
  await click(page, '#closeRulesBtn');
  await click(page, '#actions [data-act="showResult"]');
  await click(page, '#rrContinueBtn');
  await shot('game over: endgame under the sheet');
  await click(page, '#rrHideBtn');
  await shot('game over: endgame screen');
  await click(page, '#leaveBtnEnd');
  await visible(page, '#homeScreen');

  // ---- the Score Counter: two players, the pass-and-play names ----
  await click(page, '#tabScoreBtn');
  await shot('scorer: setup, two players');
  const names = page.locator('#scPlayers input');
  await names.nth(0).fill('Ann');
  await names.nth(1).fill('Bob');
  await fill(page, '#scTargetInput', '30');
  await click(page, '#scStartBtn');
  await visible(page, '#scGameScreen');
  await shot('scorer: board');
  // Ann knocks with 5 against 40: her 35 reach the target of 30, so the end screen follows.
  await click(page, '#scBoard .player-card >> nth=0 >> .chip[data-k="knock"]');
  await page.locator('#scBoard .player-card >> nth=0 >> input.dw').fill('5');
  await page.locator('#scBoard .player-card >> nth=1 >> input.dw').fill('40');
  await shot('scorer: entries (knock chip, stepper)');
  await click(page, '#scSubmitBtn');
  await shot('scorer: hand result overlay');
  await click(page, '#scResContinue');
  await visible(page, '#scEndScreen');
  await shot('scorer: end screen');
  await click(page, '#scEndHistoryBtn');
  await shot('scorer: history overlay');
  await click(page, '#closeHistoryBtn');
  await click(page, '#scEndNewBtn');
  await visible(page, '#homeScreen');
  await shot('home: after scoring');
};

/**
 * Fidice: the menu, the ladder (collapsed, a category, a group, all open), the rules, the name
 * forms (solo with the difficulty picker and the computer configuration, pass the phone, join),
 * hosting on the broker: the lobby alone, with two computers, the table until it is our turn, our
 * bid through the picker (or a minimum raise), the ladder with the bid marked, the reveal, and the
 * spectator screen of "Watch the computers".
 */
const driveFidice = async (page: Page, shot: Shot): Promise<void> => {
  await page.waitForFunction('typeof window.__fidice === "object"');
  await visible(page, '#screen-menu');
  await shot('menu');

  // ---- the ladder and the rules ----
  await click(page, 'nav.tabs button[data-tab="ladder"]');
  await visible(page, '#mainLadder');
  await shot('ladder: collapsed');
  await click(page, '#main-cat-pair');
  await visible(page, '.lrow.group');
  await shot('ladder: a category open');
  await click(page, '.lrow.group');
  await visible(page, '.lrow.variant');
  await shot('ladder: a group open (variants)');
  await click(page, '#btnExpandAll');
  await shot('ladder: all open');
  await click(page, '#btnExpandAll');
  await click(page, 'nav.tabs button[data-tab="rules"]');
  await visible(page, '#tab-rules');
  await shot('rules');
  await click(page, 'nav.tabs button[data-tab="play"]');

  // ---- the name forms ----
  await click(page, '#btnSolo');
  await visible(page, '#difficulty');
  await shot('name: solo, difficulty picker');
  await click(page, '#btnConfigSolo');
  await visible(page, '#screen-config');
  await shot('config: computer strategies');
  await click(page, '#btnConfigDone');
  await click(page, '#btnNameBack');
  await click(page, '#btnLocal');
  await visible(page, '#locals');
  await shot('name: pass the phone');
  await click(page, '#btnNameBack');
  await click(page, '#btnJoin');
  await fill(page, '#joinCode', 'ABCDE');
  await shot('name: join with a code');
  await click(page, '#btnNameBack');

  // ---- hosting: the lobby opens on the local broker ----
  await click(page, '#btnCreate');
  await fill(page, '#nameInput', 'Ann');
  await shot('name: host a table');
  await click(page, '#btnNameGo');
  await page
    .locator('#lobbyCode')
    .filter({ hasText: /^[A-Z0-9]{5}$/ })
    .waitFor();
  await page.locator('#startHint').filter({ hasText: 'Share the player link' }).waitFor();
  await shot('lobby: one seat');
  await click(page, '#btnAddBot');
  await click(page, '#btnAddBot');
  await page.locator('#screen-lobby [data-seat]').nth(2).waitFor();
  await shot('lobby: two computers');
  await click(page, '#btnStart');
  await visible(page, '#screen-game');

  // ---- the table: the host opens; bidding the lowest rung makes the computers raise, so the
  // next turn faces a bid (10 s of computer turns), which is called for an immediate reveal ----
  await page.locator('.turnbar:not(.wait)').first().waitFor({ timeout: 60_000 });
  await shot('table: opening the round');
  await fill(page, '#bidSearch', '1');
  await visible(page, '#bidList');
  await shot('table: bid picker open');
  await page
    .locator('#bidList .bidopt')
    .filter({ hasText: /rung 1 / })
    .first()
    .dispatchEvent('mousedown');
  await shot('table: bid selected');
  await click(page, '#btnPlaceBid');
  await page.locator('.turnbar:not(.wait)').first().waitFor({ timeout: 60_000 });
  await visible(page, '#stepDecide');
  await shot('table: facing a bid');
  await click(page, 'nav.tabs button[data-tab="ladder"]');
  await visible(page, '#mainLadder');
  await shot('ladder: the bid marked');
  await click(page, 'nav.tabs button[data-tab="play"]');
  await click(page, '#btnCall');
  await visible(page, '.reveal');
  await shot('table: reveal');
  await click(page, '#btnLeaveGame');
  await visible(page, '#screen-menu');

  // ---- watching the computers ----
  await click(page, '#btnWatchBots');
  await visible(page, '#screen-spec');
  // The first bid of the computers' round marks the ladder and fills the bid history.
  await page.locator('#specBidHist div.cur').waitFor({ timeout: 60_000 });
  await shot('spectator: the ladder with the cup and the bid');
  await click(page, '#btnLeaveSpec');
  await visible(page, '#screen-menu');
};

const DRIVERS: Readonly<Record<Game, (page: Page, shot: Shot) => Promise<void>>> = {
  'gin-rummy': driveGin,
  fidice: driveFidice,
};

// ---- the harness -------------------------------------------------------------------------------------

const HOST = '127.0.0.1';

export type Harness = Readonly<{
  /** The pages origin plus the GitHub Pages mount, with its trailing slash. */
  pagesUrl: string;
  /** `host:port` of the local PeerServer for the pages' `?peer=` hook. */
  peerHost: string;
  close: () => Promise<void>;
}>;

const freePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolvePort(port);
      });
    });
  });

const startPeerServer = (port: number): Promise<() => Promise<void>> =>
  new Promise((resolveServer) => {
    PeerServer({ host: HOST, port, path: '/' }, (httpServer) => {
      resolveServer(
        () =>
          new Promise((done) => {
            httpServer.close(() => {
              done();
            });
          }),
      );
    });
  });

/** dist/ on the pages mount (with the ICE fixture aliased in) and a PeerServer, both on free ports. */
export const startHarness = async (dist = resolve(REPO_ROOT, 'dist')): Promise<Harness> => {
  const peerPort = await freePort();
  const [closePeer, pages] = await Promise.all([
    startPeerServer(peerPort),
    startServer({
      root: dist,
      base: PAGES_BASE_PATH,
      host: HOST,
      port: 0,
      aliases: { 'e2e-ice.json': resolve(REPO_ROOT, 'e2e/fixtures/e2e-ice.json') },
    }),
  ]);
  return {
    pagesUrl: `${pages.url}${PAGES_BASE_PATH}`,
    peerHost: `${HOST}:${String(peerPort)}`,
    close: async () => {
      await Promise.all([pages.close(), closePeer()]);
    },
  };
};

export const pageUrl = (harness: Harness, game: Game): string =>
  `${harness.pagesUrl}games/${game}/?peer=${harness.peerHost}&ice=${encodeURIComponent(`${harness.pagesUrl}e2e-ice.json`)}`;

export type Captured = Readonly<{ golden: Golden; errors: ReadonlyArray<string> }>;

/** Drive one game at one viewport in a fresh context; `errors` are the page's uncaught exceptions. */
export const capture = async (
  browser: Browser,
  harness: Harness,
  game: Game,
  viewport: Viewport,
): Promise<Captured> => {
  const context = await browser.newContext({ viewport });
  context.setDefaultTimeout(15_000);
  await context.addInitScript({ content: `${seedScript(SEED)}\n${clockScript(EPOCH)}` });
  await routeOffline(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
  });
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  try {
    await page.goto(pageUrl(harness, game));
    const recorder = new Recorder(game, viewport, page);
    try {
      await DRIVERS[game](page, recorder.shot);
    } catch (e: unknown) {
      // A step that could not be applied: say where the page is and what was shot last.
      const screens = await page.evaluate<string>(
        `Array.from(document.querySelectorAll('#app > div, .overlay, main > section > *')).filter((e) => e.id && !e.classList.contains('hidden')).map((e) => '#' + e.id).join(' ')`,
      );
      const last = Object.keys(recorder.golden().screens).at(-1) ?? 'start';
      throw new Error(
        `${game} @ ${viewportName(viewport)}: after "${last}" (visible: ${screens}): ${e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e)}`,
        { cause: e },
      );
    }
    return { golden: recorder.golden(), errors };
  } finally {
    await context.close();
  }
};

// ---- comparing ---------------------------------------------------------------------------------------

export const readGolden = (game: Game, viewport: Viewport): Golden | null => {
  const path = goldenPath(game, viewport);
  return existsSync(path) ? parse(readFileSync(path, 'utf8')) : null;
};

export const writeGolden = (golden: Golden, viewport: Viewport): string => {
  const path = goldenPath(golden.game, viewport);
  mkdirSync(resolve(REPO_ROOT, GOLDEN_DIR), { recursive: true });
  writeFileSync(path, serialise(golden));
  return path;
};

/**
 * What a comparison says. `differences` fail the check: a PROPERTIES value that changed, a custom
 * property that vanished or changed on a selector, a selector or screen that matched differently.
 * `notes` only inform: a `--token` the capture declares that the golden never recorded on that
 * selector (a new name in the shared vocabulary) is additive, and the goldens are re-recorded to
 * absorb it once it is intended. One note per selector and token, however many screens record it.
 */
export type GoldenDiff = Readonly<{
  differences: ReadonlyArray<string>;
  notes: ReadonlyArray<string>;
}>;

type DiffLine = Readonly<{ kind: 'difference' | 'note'; text: string }>;

const difference = (text: string): DiffLine => ({ kind: 'difference', text });
const note = (text: string): DiffLine => ({ kind: 'note', text });

/** PROPERTIES by name, so two files whose property lists differ still compare what they share. */
const fixedByName = (golden: Golden, r: StyleRecord): Readonly<Record<string, string>> =>
  Object.fromEntries(golden.properties.map((p, i) => [p, r.v[i] ?? '']));

const compareRecords = (
  where: string,
  sel: string,
  expected: Golden,
  eh: string,
  actual: Golden,
  ah: string,
): ReadonlyArray<DiffLine> => {
  const er = expected.styles[eh];
  const ar = actual.styles[ah];
  if (er === undefined || ar === undefined)
    return [difference(`${where} / ${sel}: <missing style> ${eh} -> ${ah}`)];
  const ep = fixedByName(expected, er);
  const ap = fixedByName(actual, ar);
  const props = [...new Set([...Object.keys(ep), ...Object.keys(ap)])].sort();
  const fixed = props.flatMap((p) =>
    ep[p] === ap[p]
      ? []
      : [
          difference(
            `${where} / ${sel} / ${p}: ${JSON.stringify(ep[p] ?? '')} -> ${JSON.stringify(ap[p] ?? '')}`,
          ),
        ],
  );
  const names = [...new Set([...Object.keys(er.vars), ...Object.keys(ar.vars)])].sort();
  const vars = names.flatMap((name) => {
    const ev = er.vars[name];
    const av = ar.vars[name];
    if (ev === av) return [];
    if (ev === undefined) return [note(`${sel}: new token ${name} = ${av ?? ''}`)];
    return [
      difference(
        `${where} / ${sel} / ${name}: ${JSON.stringify(ev)} -> ${JSON.stringify(av ?? '')}`,
      ),
    ];
  });
  return [...fixed, ...vars];
};

/** Human-readable lines per differing screen/selector/property, split into differences and notes. */
export const diffGoldens = (expected: Golden, actual: Golden): GoldenDiff => {
  const header =
    JSON.stringify(expected.properties) === JSON.stringify(actual.properties)
      ? []
      : [
          `properties: ${JSON.stringify(expected.properties)} -> ${JSON.stringify(actual.properties)}`,
        ];
  const screenNames = [
    ...new Set([...Object.keys(expected.screens), ...Object.keys(actual.screens)]),
  ].sort();
  const body = screenNames.flatMap((screen): ReadonlyArray<DiffLine> => {
    const e = expected.screens[screen];
    const a = actual.screens[screen];
    if (e === undefined) return [difference(`${screen}: only in the capture`)];
    if (a === undefined) return [difference(`${screen}: only in the golden`)];
    const selectors = [...new Set([...Object.keys(e), ...Object.keys(a)])].sort();
    return selectors.flatMap((sel) => {
      const eh = e[sel] ?? null;
      const ah = a[sel] ?? null;
      if (eh === ah) return [];
      if (eh === null)
        return [difference(`${screen} / ${sel}: matched nothing in the golden, matches now`)];
      if (ah === null)
        return [difference(`${screen} / ${sel}: matched in the golden, matches nothing now`)];
      return compareRecords(screen, sel, expected, eh, actual, ah);
    });
  });
  const texts = (kind: DiffLine['kind']): ReadonlyArray<string> =>
    body.filter((line) => line.kind === kind).map((line) => line.text);
  return {
    differences: [...header, ...texts('difference')],
    notes: [...new Set(texts('note'))],
  };
};

// ---- CLI ---------------------------------------------------------------------------------------------

if (isMain(import.meta.url)) {
  const check = process.argv.includes('--check');
  const dist = resolve(REPO_ROOT, 'dist');
  if (!existsSync(resolve(dist, 'games', 'fidice', 'index.html'))) {
    console.error('dist/ has no game pages: run `npm run build` first');
    process.exit(1);
  }
  const harness = await startHarness(dist);
  const browser = await chromium.launch({ args: ['--no-first-run'] });
  try {
    const runs = GAMES.flatMap((game) => VIEWPORTS.map((viewport) => ({ game, viewport })));
    const results = await runs.reduce<Promise<ReadonlyArray<boolean>>>(
      async (previous, { game, viewport }) => {
        const done = await previous;
        const { golden, errors } = await capture(browser, harness, game, viewport);
        const label = `${game} @ ${viewportName(viewport)}`;
        const screens = Object.keys(golden.screens).length;
        const styles = Object.keys(golden.styles).length;
        errors.forEach((e) => {
          console.log(`${label}: page error: ${e}`);
        });
        if (check) {
          const expected = readGolden(game, viewport);
          const { differences, notes } =
            expected === null
              ? { differences: ['no golden recorded'], notes: [] }
              : diffGoldens(expected, golden);
          differences.forEach((line) => {
            console.log(`${label}: ${line}`);
          });
          notes.forEach((line) => {
            console.log(`${label}: note: ${line}`);
          });
          const ok = differences.length === 0 && errors.length === 0;
          console.log(
            `${ok ? 'ok  ' : 'DIFF'} ${label}: ${String(screens)} screens, ${String(styles)} distinct styles, ${String(differences.length)} differences, ${String(notes.length)} notes`,
          );
          return [...done, ok];
        }
        const path = writeGolden(golden, viewport);
        console.log(
          `wrote ${path}: ${String(screens)} screens, ${String(styles)} distinct styles, ${String(readFileSync(path).byteLength)} bytes`,
        );
        return [...done, errors.length === 0];
      },
      Promise.resolve([]),
    );
    process.exitCode = results.every((ok) => ok) ? 0 : 1;
  } catch (e: unknown) {
    // `process.exit()` below would otherwise swallow a driver error as a silent success.
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await harness.close();
    // The PeerServer keeps housekeeping intervals after its listener closes; do not wait for them.
    process.exit();
  }
}
