// The space audit (docs/design/space-audit.md; the owner, 2026-09-30: "now that we have a better
// story around the shell bordering stuff, audit all games. Only backgammon gets a border. But just
// check each game ... to make sure it looks reasonable and doesn't waste space ... find a
// deterministic way to accomplish this"). Every page x every catalogued phone x orientation x
// display mode (a tab twice: bar shown, hidden; `emulationsOf`) x the page's screens (the home,
// then the table reached through pass and play or the page's own start; the sandbox's preview (a)),
// stood up in Playwright Chromium at the device's viewport, screen and pixel ratio with the insets
// through the shell's seam (tools/shell-emulate.ts `seamScript`) and one seed for every deal, then
// measured by one page-side script (`measureScript`) and judged by one pure function
// (tools/space-audit/judge.ts). A page that plays one way (`data-plays`) held the other way stops
// at the shell's turn gate: that screen is judged as a gate; backgammon adds a `kept` screen
// upright, the gate dismissed with "Play upright", judged as a table. Output per page under
// shots/space-audit/<page>/ (gitignored): a PNG per screen, index.html (tools/space-audit/sheet.ts)
// and report.json; a `check` table per page on stdout (tools/space-audit/rows.ts `checkTable`: one
// row per case x screen, the six columns, ok/FAIL/tier/gate) and a combined report.json with the
// totals; exit 1 on any failure. A second case type joins every default run: the desktop windows
// (`DESKTOP_WINDOWS`: a fine pointer, no touch, no seam, a browser tab at five sizes), judged by
// `DESKTOP_LIMITS` and a 32px target, grouped last on the sheet; `--device desktop` runs them alone,
// and any of `--device <phone>`, `--orientation`, `--mode`, `--bar` leaves them out. Every case's
// screens report the layout bucket the page put itself in (`data-layout`, docs/design/layout-buckets.md).
//   npm run audit:space [-- --game <page>] [--device <id>|desktop] [--orientation ..] [--mode ..] [--bar ..]
//                       [--url <site> | --serve] [--out <dir>] [--port <n>] [--jobs <n>]
//                       [--baseline <page report.json>]
// `--serve` (the default without `--url`) serves dist/ (run `npm run build` first) on `--port`
// (0: a free one); `--jobs` cases run at once (4); `--baseline` prints, instead of the check table,
// only the rows whose outcome moved against that earlier report. The pure parts are
// tools/space-audit/judge.test.ts's.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { chromium, type Browser, type Page } from '@playwright/test';

import {
  BARS,
  DEVICES,
  DISPLAY_MODES,
  ORIENTATIONS,
  deviceById,
  emulationFor,
  emulationsOf,
  type Bar,
  type DisplayMode,
  type Emulation,
  type Orientation,
} from '../web/shared/lib/devices.ts';
import type { OrientationType } from '../web/shared/lib/safeArea.ts';
import { PAGES_BASE_PATH } from '../e2e/fixtures/site.ts';
import { PAGE_HOOKS } from './games.ts';
import { DICE_STILL, SEED_SCRIPT, seamScript } from './shell-emulate.ts';
import { startServer } from './serve-dist.ts';
import {
  COLUMNS,
  PAGE_IDS,
  caseName,
  insetsOf,
  isDesktop,
  judge,
  orientationOf,
  type AuditCase,
  type AuditVerdict,
  type DesktopWindow,
  type Measured,
  type PageId,
  type Screen,
} from './space-audit/judge.ts';
import {
  changedRows,
  changesTable,
  checkTable,
  rowsOf,
  rowsOfReport,
  type Row,
} from './space-audit/rows.ts';
import { cardPasses, sheetHtml, type AuditCard, type ScreenResult } from './space-audit/sheet.ts';

export type AuditArgs = Readonly<{
  game: PageId | null;
  device: string | null;
  orientation: Orientation | null;
  mode: DisplayMode | null;
  bar: Bar | null;
  url: string | null;
  out: string;
  port: number;
  jobs: number;
  /** An earlier page report.json: print the rows whose outcomes moved, not the whole table. */
  baseline: string | null;
}>;

const oneOf = <T extends string>(
  name: string,
  value: string | undefined,
  allowed: ReadonlyArray<T>,
): T | null => {
  if (value === undefined) return null;
  if ((allowed as ReadonlyArray<string>).includes(value)) return value as T;
  throw new Error(`--${name} must be one of ${allowed.join(', ')}, got: ${value}`);
};
const count = (name: string, value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${name} must be a whole number, got: ${value}`);
  return n;
};

/** The command line; `--serve` is accepted and is the default without `--url`. */
export const parseAuditArgs = (argv: ReadonlyArray<string>): AuditArgs => {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      game: { type: 'string' },
      device: { type: 'string' },
      orientation: { type: 'string' },
      mode: { type: 'string' },
      bar: { type: 'string' },
      url: { type: 'string' },
      serve: { type: 'boolean', default: false },
      out: { type: 'string', default: 'shots/space-audit' },
      port: { type: 'string' },
      jobs: { type: 'string' },
      baseline: { type: 'string' },
    },
  });
  const device = values.device ?? null;
  if (device !== null && device !== DESKTOP && deviceById(device) === null)
    throw new Error(
      `--device ${device} is not in the catalogue (or \`${DESKTOP}\`); shell-emulate \`list\` prints the ids`,
    );
  return {
    game: oneOf('game', values.game, PAGE_IDS),
    device,
    orientation: oneOf('orientation', values.orientation, ORIENTATIONS),
    mode: oneOf('mode', values.mode, DISPLAY_MODES),
    bar: oneOf('bar', values.bar, BARS),
    url: values.url ?? null,
    out: values.out,
    port: count('port', values.port, 0),
    jobs: Math.max(1, count('jobs', values.jobs, 4)),
    baseline: values.baseline ?? null,
  };
};

/** The phones: every supported row but the iPads (the owner's ask names phones; the iPads reach the audit through `--device`). */
export const PHONES: ReadonlyArray<(typeof DEVICES)[number]> = DEVICES.filter(
  (d) => d.kind !== 'ipad' && d.supported,
);
/** `--device desktop`: the desktop windows alone. */
export const DESKTOP = 'desktop';
const window_ = (width: number, height: number): DesktopWindow => ({
  kind: 'desktop',
  viewport: { width, height },
});
/**
 * The desktop windows (docs/design/space-audit.md §5; web/shared/lib/layout.ts `desktop` and
 * `desktop-wide`): a narrow half-screen window (900x700), the smallest standard window (1024x768),
 * the goldens' laptop (1280x800, e2e/fixtures/geometry.ts `DESKTOP`), a 13-inch MacBook Air's
 * default (1440x900) and a 1080p monitor (1920x1080). Each a fine pointer with no touch and no
 * insets, in a browser tab.
 */
export const DESKTOP_WINDOWS: ReadonlyArray<DesktopWindow> = [
  window_(900, 700),
  window_(1024, 768),
  window_(1280, 800),
  window_(1440, 900),
  window_(1920, 1080),
];

const narrowed = (args: AuditArgs, e: Emulation): boolean =>
  (args.orientation === null || e.orientation === args.orientation) &&
  (args.mode === null || e.mode === args.mode) &&
  (args.bar === null || e.mode !== 'browser' || e.bar === args.bar);

/** The desktop windows join a run with no filter at all, or `--device desktop` (a filter names a phone's way of being held, which no window has). */
const desktopsFor = (args: AuditArgs): ReadonlyArray<DesktopWindow> =>
  args.device === DESKTOP ||
  (args.device === null && args.orientation === null && args.mode === null && args.bar === null)
    ? DESKTOP_WINDOWS
    : [];

/** The cases: `--device`'s eight (or the one the filters pick), else every phone's, narrowed by the filters; then the desktop windows (`desktopsFor`). */
export const casesFor = (args: AuditArgs): ReadonlyArray<AuditCase> => {
  if (args.device === DESKTOP) return DESKTOP_WINDOWS;
  const device = args.device === null ? null : deviceById(args.device);
  if (device !== null && args.orientation !== null && args.mode !== null)
    return [emulationFor(device, args.orientation, args.mode, args.bar ?? 'shown')];
  const rows = device === null ? PHONES : [device];
  return [
    ...rows.flatMap((d) => emulationsOf(d).filter((e) => narrowed(args, e))),
    ...desktopsFor(args),
  ];
};

/** The pages an invocation audits: `--game`'s, else all six. */
export const pagesFor = (args: AuditArgs): ReadonlyArray<PageId> =>
  args.game === null ? PAGE_IDS : [args.game];

// ---- the page-side measurement -------------------------------------------------------------------

/** The controls the 44px rule reads: native controls and the shell's button classes. */
export const TARGET_SELECTOR =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], .btn, .icon-btn, .tab-btn, .mode-btn, .chip';

/**
 * The script that reads one screen (a `Measured`): the viewport and the document; the body's
 * `fixed-screen` and `data-frame`; `#app`'s padding and `--gutter`; the union of the content
 * boxes under `#app` (visible, not clipped away as an `sr-only` span is, over a pixel each way, and
 * painting something: a text node of
 * its own, media or a control, a fill, an image, a shadow or a border; a surface covering 95% of
 * the viewport both ways is a backdrop, not content), clipped to the viewport; every nowrap
 * element wider than its box; every control's box; every text-bearing box crossing one of the
 * case's inset bands (the page cannot read the insets here: headless reports 0, so the case's are
 * spliced in); the body's `data-plays` and `data-layout` (the bucket, docs/design/layout-buckets.md);
 * whether a `fixed-screen` body's computed `overflow-y` is `visible` (the theme's scroll tier
 * lifted it); whether the turn gate (`#turnGate`) is shown.
 */
export const measureScript = (e: AuditCase): string => `(() => {
  const TOL = 0.5;
  const insets = ${JSON.stringify(insetsOf(e))};
  const W = innerWidth, H = innerHeight;
  const app = document.getElementById('app');
  const cs = (el) => getComputedStyle(el);
  const px = (v) => parseFloat(v) || 0;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const shown = (el) => { if (el.getClientRects().length === 0) return false; const s = cs(el); return s.visibility !== 'hidden' && s.opacity !== '0' && s.clipPath === 'none' && s.clip === 'auto'; };
  const name = (el) => el.id !== '' ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() !== '' ? '.' + el.className.trim().split(/\\s+/)[0] : '');
  const hasText = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
  const MEDIA = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);
  const alpha = (color) => { const m = /rgba?\\(([^)]+)\\)/.exec(color); if (m === null) return color === 'transparent' ? 0 : 1; const parts = m[1].split(/[\\s,\\/]+/).map(Number); return parts.length >= 4 ? parts[3] : 1; };
  const paints = (el, s) => hasText(el) || MEDIA.has(el.tagName) || alpha(s.backgroundColor) > 0 || s.backgroundImage !== 'none' || s.boxShadow !== 'none' || (px(s.borderTopWidth) > 0 && alpha(s.borderTopColor) > 0) || (px(s.outlineWidth) > 0 && s.outlineStyle !== 'none');
  const all = app === null ? [] : Array.from(app.querySelectorAll('*'));
  const visible = all.filter(shown).map((el) => ({ el, s: cs(el), r: rect(el) })).filter(({ r }) => r.w > 1 && r.h > 1);
  const content = visible.filter(({ el, s, r }) => paints(el, s) && !(r.w >= 0.95 * W && r.h >= 0.95 * H));
  const clip = (r) => ({ x: Math.max(0, r.x), y: Math.max(0, r.y), r: Math.min(W, r.x + r.w), b: Math.min(H, r.y + r.h) });
  const union = content.map(({ r }) => clip(r)).filter((c) => c.r > c.x && c.b > c.y).reduce((u, c) => u === null ? c : { x: Math.min(u.x, c.x), y: Math.min(u.y, c.y), r: Math.max(u.r, c.r), b: Math.max(u.b, c.b) }, null);
  const used = union === null ? null : { x: union.x, y: union.y, w: union.r - union.x, h: union.b - union.y };
  const clipped = visible.filter(({ el, s }) => s.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth + 1).map(({ el }) => ({ sel: name(el), over: el.scrollWidth - el.clientWidth }));
  const targets = visible.filter(({ el }) => el.matches(${JSON.stringify(TARGET_SELECTOR)})).map(({ el, r }) => ({ sel: name(el), w: r.w, h: r.h }));
  const bands = [['top', (r) => r.y < insets.top - TOL], ['right', (r) => r.x + r.w > W - insets.right + TOL], ['bottom', (r) => r.y + r.h > H - insets.bottom + TOL], ['left', (r) => r.x < insets.left - TOL]].filter(([side]) => insets[side] > 0);
  const underInset = visible.filter(({ el }) => hasText(el)).flatMap(({ el, r }) => bands.filter(([, hit]) => hit(r)).map(([side]) => ({ sel: name(el), side })));
  const appStyle = app === null ? null : cs(app);
  const pad = appStyle === null ? { top: 0, right: 0, bottom: 0, left: 0 } : { top: px(appStyle.paddingTop), right: px(appStyle.paddingRight), bottom: px(appStyle.paddingBottom), left: px(appStyle.paddingLeft) };
  const gutterRaw = appStyle === null ? '' : appStyle.getPropertyValue('--gutter').trim();
  const fixedScreen = document.body.classList.contains('fixed-screen');
  const plays = document.body.getAttribute('data-plays');
  const gateEl = document.getElementById('turnGate');
  return {
    inner: { w: W, h: H },
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    fixedScreen,
    lifted: fixedScreen && cs(document.body).overflowY === 'visible',
    frame: document.body.hasAttribute('data-frame'),
    plays: plays === 'landscape' || plays === 'portrait' ? plays : null,
    layout: document.body.getAttribute('data-layout'),
    gate: gateEl !== null && shown(gateEl),
    locked: document.fullscreenElement !== null,
    pad,
    gutterToken: gutterRaw === '' ? null : px(gutterRaw),
    used,
    clipped,
    targets,
    underInset,
  };
})()`;

// ---- the pages and their screens --------------------------------------------------------------

/** What a screen's reach gets: the page's URL for this case and the case. */
type Reach = (page: Page, url: string, e: AuditCase) => Promise<void>;
/** A screen and how to reach it; `only` keeps it to one orientation (backgammon's `kept` is upright's). */
type ScreenDrive = Screen & Readonly<{ reach: Reach; only?: Orientation }>;
type PageDrive = Readonly<{
  /** The page's path under the site root, with any query the audited path needs. */
  path: string;
  hook: string;
  screens: ReadonlyArray<ScreenDrive>;
}>;

/** No CSS animation or transition is running (a tumble, a deal, a slide), or four seconds passed. */
const settle = async (page: Page): Promise<void> => {
  await page
    .waitForFunction(
      `document.getAnimations().every((a) => a.playState !== 'running')`,
      undefined,
      {
        timeout: 4000,
      },
    )
    .catch(() => undefined);
  await page.waitForTimeout(120);
};
const hookReady = (page: Page, hook: string): Promise<unknown> =>
  page.waitForFunction(`typeof ${hook} === 'object'`);

/** The home: the page loaded, its hook up, the paint settled. */
const home =
  (hook: string): Reach =>
  async (page, url) => {
    await page.goto(url);
    await hookReady(page, hook);
    await settle(page);
  };

/**
 * The shell's pass-and-play start (e2e/fixtures/shell.ts `startLocal`): the switch, two names,
 * Start; the table up. Where the turn gate stands (a page that plays sideways, the phone upright)
 * the drive stops there and says so: that screen is the gate's, judged as one.
 */
const shellLocal = async (page: Page): Promise<'gate' | 'table'> => {
  await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
  await page.locator('#p1NameInput').fill('Ari');
  await page.locator('#p2NameInput').fill('Ethan');
  await page.locator('#localBtn').click();
  await page.locator('#tableScreen').waitFor({ state: 'visible' });
  return (await page.locator('#turnGate').isVisible()) ? 'gate' : 'table';
};
/** backgammon's rolled board from the lifted curtain: the roll modal rolled, the dice still. */
const rolledBoard = async (page: Page): Promise<void> => {
  await reveal(page);
  await page.locator('#rollOverlay').waitFor({ state: 'visible' });
  await page.locator('#rollModalBtn').click();
  await page.locator('#board[data-rolled="1"]').waitFor();
  await page.locator('#rollOverlay').waitFor({ state: 'hidden' });
  await page.waitForFunction(DICE_STILL);
  await settle(page);
};
/** The curtain is up; the seat behind it taps; it goes. */
const reveal = async (page: Page): Promise<void> => {
  await page.locator('#curtainOverlay').waitFor({ state: 'visible' });
  await page.locator('#curtainBtn').click();
  await page.locator('#curtainOverlay').waitFor({ state: 'hidden' });
};

const PAGES: Readonly<Record<PageId, PageDrive>> = {
  'gin-rummy': {
    path: 'games/gin-rummy/',
    hook: PAGE_HOOKS['gin-rummy'],
    screens: [
      { id: 'home', kind: 'home', reach: home(PAGE_HOOKS['gin-rummy']) },
      {
        id: 'table',
        kind: 'table',
        // The upcard decision: ten cards in the hand, the piles up.
        reach: async (page) => {
          await shellLocal(page);
          await reveal(page);
          await page.waitForFunction(`document.querySelectorAll('#hand .card').length >= 10`);
          await settle(page);
        },
      },
    ],
  },
  fidice: {
    // The shell path (docs/design/fidice-shell-adoption.md M4): the flag boots the composed page.
    path: 'games/fidice/?shell=1',
    hook: PAGE_HOOKS.fidice,
    screens: [
      { id: 'home', kind: 'home', reach: home(PAGE_HOOKS.fidice) },
      {
        id: 'table',
        kind: 'table',
        // The legacy game screen mounted in #fidiceTable, the cup holder's view.
        reach: async (page) => {
          await shellLocal(page);
          await reveal(page);
          await page.locator('#screen-game').waitFor({ state: 'visible' });
          await settle(page);
        },
      },
    ],
  },
  briscola: {
    path: 'games/briscola/',
    hook: PAGE_HOOKS.briscola,
    screens: [
      { id: 'home', kind: 'home', reach: home(PAGE_HOOKS.briscola) },
      {
        id: 'table',
        kind: 'table',
        // Two seats, the leader's three cards dealt and at rest.
        reach: async (page) => {
          await shellLocal(page);
          await reveal(page);
          await page.waitForFunction(`document.querySelectorAll('#hand .card').length >= 3`);
          await settle(page);
        },
      },
    ],
  },
  backgammon: {
    path: 'games/backgammon/',
    hook: PAGE_HOOKS.backgammon,
    screens: [
      { id: 'home', kind: 'home', reach: home(PAGE_HOOKS.backgammon) },
      {
        id: 'table',
        kind: 'table',
        // Sideways, shell-emulate's drive: the curtain, the roll modal, the rolled board with the
        // dice still. Upright the turn gate stands over the table and the curtain: the screen.
        reach: async (page) => {
          if ((await shellLocal(page)) === 'gate') {
            await settle(page);
            return;
          }
          await rolledBoard(page);
        },
      },
      {
        id: 'kept',
        kind: 'table',
        kept: true,
        only: 'portrait',
        // The player's opt-out: "Play upright" dismisses the gate; the board rolled as sideways.
        // Where no gate stood (the `table` screen reached the board) the board is already up.
        reach: async (page) => {
          const gate = page.locator('#turnGate');
          if (!(await gate.isVisible())) return;
          await page.locator('#turnGateKeepBtn').click();
          await gate.waitFor({ state: 'hidden' });
          await rolledBoard(page);
        },
      },
    ],
  },
  rps: {
    path: 'games/rps/',
    hook: PAGE_HOOKS.rps,
    screens: [
      { id: 'home', kind: 'home', reach: home(PAGE_HOOKS.rps) },
      {
        id: 'play',
        kind: 'table',
        // Go: the round is armed, Stop shows.
        reach: async (page) => {
          await page.locator('#goBtn').click();
          await page.locator('#stopBtn').waitFor({ state: 'visible' });
          await settle(page);
        },
      },
    ],
  },
  'ui-sandbox': {
    path: 'games/ui-sandbox/',
    hook: PAGE_HOOKS['ui-sandbox'],
    screens: [
      { id: 'info', kind: 'home', reach: home(PAGE_HOOKS['ui-sandbox']) },
      {
        id: 'preview',
        kind: 'tool',
        // The preview screen around example (a) under the case's primary orientation type.
        reach: async (page, url, e) => {
          const type: OrientationType =
            orientationOf(e) === 'landscape' ? 'landscape-primary' : 'portrait-primary';
          await page.goto(`${url}?screen=preview&example=cover&type=${type}`);
          await hookReady(page, PAGE_HOOKS['ui-sandbox']);
          await settle(page);
        },
      },
    ],
  },
};

/** The screens a page is audited on, in the order the drive reaches them; held `orientation`, only that way's (every screen when null). */
export const screensOf = (
  page: PageId,
  orientation: Orientation | null = null,
): ReadonlyArray<Screen> =>
  PAGES[page].screens
    .filter((s) => orientation === null || s.only === undefined || s.only === orientation)
    .map(({ id, kind, kept }) => (kept === undefined ? { id, kind } : { id, kind, kept }));

// ---- the drive -----------------------------------------------------------------------------------

const fileNameOf = (e: AuditCase, screen: string): string =>
  `${caseName(e).replace(/\s+/g, '_')}--${screen}.png`;

/** A verdict for a screen the drive never reached: every column fails with the reason. */
const failed = (reason: string): AuditVerdict => ({
  pass: false,
  checks: COLUMNS.map((name) => ({
    name,
    pass: false,
    outcome: 'FAIL',
    detail: `not reached: ${reason}`,
  })),
});
/** An empty measurement for a screen the drive never reached (the sheet still prints the card). */
const unmeasured = (e: AuditCase): Measured => ({
  inner: { w: e.viewport.width, h: e.viewport.height },
  scrollHeight: 0,
  scrollWidth: 0,
  fixedScreen: false,
  lifted: false,
  frame: false,
  plays: null,
  layout: null,
  gate: false,
  locked: false,
  pad: { top: 0, right: 0, bottom: 0, left: 0 },
  gutterToken: null,
  used: null,
  clipped: [],
  targets: [],
  underInset: [],
});

/**
 * One case of one page: a context at the device (viewport, screen, pixel ratio, touch, mobile),
 * the seed and the seam installed (a desktop window: the viewport alone, a fine pointer, no seam),
 * then each screen reached, shot and measured in order. A screen the drive cannot reach (a
 * timeout, a missing control) fails every column with the reason and stops the case there.
 */
export const driveCase = async (
  browser: Browser,
  site: string,
  pageId: PageId,
  e: AuditCase,
  dir: string,
): Promise<AuditCard> => {
  const row = PAGES[pageId];
  const [path = '', query = ''] = row.path.split('?');
  const url = `${site}${path}${query === '' ? '' : `?${query}`}`;
  const context = await browser.newContext(
    isDesktop(e)
      ? { viewport: { width: e.viewport.width, height: e.viewport.height } }
      : {
          viewport: { width: e.viewport.width, height: e.viewport.height },
          screen: { width: e.screen.width, height: e.screen.height },
          deviceScaleFactor: e.dpr,
          isMobile: true,
          hasTouch: true,
        },
  );
  await context.addInitScript({ content: SEED_SCRIPT });
  if (!isDesktop(e)) {
    await context.addInitScript({ content: seamScript(e) });
    if (e.device.kind !== 'android') await context.addInitScript({ content: NO_LOCK_SCRIPT });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  type Acc = Readonly<{ done: ReadonlyArray<ScreenResult>; stopped: boolean }>;
  const one = async (prev: Promise<Acc>, s: ScreenDrive): Promise<Acc> => {
    const { done, stopped } = await prev;
    const picture = fileNameOf(e, s.id);
    const screen: Screen =
      s.kept === undefined ? { id: s.id, kind: s.kind } : { id: s.id, kind: s.kind, kept: s.kept };
    if (stopped)
      return {
        done: [
          ...done,
          {
            screen,
            measured: unmeasured(e),
            verdict: failed('an earlier screen was not reached'),
            picture,
          },
        ],
        stopped,
      };
    try {
      await s.reach(page, url, e);
      await page.screenshot({ path: resolve(dir, picture) });
      const measured = await page.evaluate<Measured>(measureScript(e));
      const verdict = judge({ page: pageId, screen, e, m: measured });
      return { done: [...done, { screen, measured, verdict, picture }], stopped: false };
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? (error.message.split('\n')[0] ?? 'error') : String(error);
      await page.screenshot({ path: resolve(dir, picture) }).catch(() => undefined);
      return {
        done: [...done, { screen, measured: unmeasured(e), verdict: failed(reason), picture }],
        stopped: true,
      };
    }
  };
  try {
    const orientation = orientationOf(e);
    const screens = row.screens.filter((s) => s.only === undefined || s.only === orientation);
    const { done } = await screens.reduce(one, Promise.resolve({ done: [], stopped: false }));
    return { e, screens: done };
  } finally {
    await context.close();
  }
};

/**
 * No `screen.orientation.lock` on an iPhone or iPad row, as no browser there has one (shell.ts
 * `canLock`; e2e/backgammon-gate.spec.ts's `absent`): Chromium's emulated phone has the function
 * and grants it, so without this the shell's Android lock would take the upright table into
 * fullscreen and no turn gate would ever stand. An Android row keeps Chromium's: the lock is held
 * there as on the phone, and the judge reads it (`locked`).
 */
const NO_LOCK_SCRIPT = `Object.defineProperty(ScreenOrientation.prototype, 'lock', { value: undefined, configurable: true });`;

const chunk = <T>(items: ReadonlyArray<T>, n: number): ReadonlyArray<ReadonlyArray<T>> =>
  Array.from({ length: Math.ceil(items.length / n) }, (_, i) => items.slice(i * n, (i + 1) * n));

/** `jobs` at a time, in order. */
const pooled = <T, R>(
  items: ReadonlyArray<T>,
  jobs: number,
  fn: (item: T) => Promise<R>,
): Promise<ReadonlyArray<R>> =>
  chunk(items, jobs).reduce<Promise<ReadonlyArray<R>>>(
    async (prev, group) => [...(await prev), ...(await Promise.all(group.map(fn)))],
    Promise.resolve([]),
  );

const stampNow = (): string => {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
};

/** One page's totals for the combined report and the PR body. */
export type PageTotals = Readonly<{
  cases: number;
  casesPassed: number;
  screens: number;
  screensPassed: number;
  /** Failures per column over every screen. */
  failures: Readonly<Record<string, number>>;
}>;
export const totalsOf = (cards: ReadonlyArray<AuditCard>): PageTotals => {
  const screens = cards.flatMap((c) => c.screens);
  const failures = screens
    .flatMap((s) => s.verdict.checks.filter((k) => !k.pass).map((k) => k.name))
    .reduce<Readonly<Record<string, number>>>(
      (acc, name) => ({ ...acc, [name]: (acc[name] ?? 0) + 1 }),
      {},
    );
  return {
    cases: cards.length,
    casesPassed: cards.filter(cardPasses).length,
    screens: screens.length,
    screensPassed: screens.filter((s) => s.verdict.pass).length,
    failures,
  };
};

const totalsLine = (page: PageId, t: PageTotals): string =>
  `${page}: ${String(t.casesPassed)} of ${String(t.cases)} cases pass, ${String(t.screensPassed)} of ${String(t.screens)} screens; failures ${
    Object.keys(t.failures).length === 0
      ? 'none'
      : Object.entries(t.failures)
          .map(([k, n]) => `${k} ${String(n)}`)
          .join(', ')
  }`;

type Served = Readonly<{ url: string; close: () => Promise<void> }>;
const siteUrl = async (args: AuditArgs): Promise<Served> => {
  if (args.url !== null)
    return {
      url: args.url.endsWith('/') ? args.url : `${args.url}/`,
      close: () => Promise.resolve(),
    };
  const running = await startServer({
    root: resolve('dist'),
    base: PAGES_BASE_PATH,
    host: '127.0.0.1',
    port: args.port,
    aliases: {},
  });
  return { url: `${running.url}${PAGES_BASE_PATH}`, close: running.close };
};

/** One page: every case driven, the pictures, the sheet and the report written, the check table (or, against a baseline, the changed rows) printed; the totals. */
const auditPage = async (
  browser: Browser,
  site: string,
  args: AuditArgs,
  page: PageId,
  stamp: string,
  baseline: ReadonlyArray<Row> | null,
): Promise<PageTotals> => {
  const dir = resolve(args.out, page);
  mkdirSync(dir, { recursive: true });
  const cards = await pooled(casesFor(args), args.jobs, async (e) => {
    const card = await driveCase(browser, site, page, e, dir);
    const bucket = card.screens[0]?.measured.layout ?? 'no bucket';
    console.log(`${cardPasses(card) ? 'pass' : 'FAIL'}  ${page} ${caseName(e)}  [${bucket}]`);
    return card;
  });
  writeFileSync(resolve(dir, 'index.html'), sheetHtml(page, cards, stamp));
  writeFileSync(
    resolve(dir, 'report.json'),
    `${JSON.stringify(
      {
        page,
        stamp,
        totals: totalsOf(cards),
        cases: cards.map((c) => ({ case: caseName(c.e), emulation: c.e, screens: c.screens })),
      },
      null,
      2,
    )}\n`,
  );
  const rows = rowsOf(cards);
  console.log(`\n${page}${baseline === null ? '' : ` against ${String(args.baseline)}`}`);
  console.log(
    baseline === null ? checkTable(rows) : changesTable(changedRows(baseline, rows), rows.length),
  );
  console.log(`sheet -> ${resolve(dir, 'index.html')}\n`);
  return totalsOf(cards);
};

/** `--baseline`'s rows, read once; null without the option. */
const baselineRows = (args: AuditArgs): ReadonlyArray<Row> | null =>
  args.baseline === null
    ? null
    : rowsOfReport(JSON.parse(readFileSync(resolve(args.baseline), 'utf8')) as unknown);

const run = async (args: AuditArgs): Promise<number> => {
  const baseline = baselineRows(args);
  const served = await siteUrl(args);
  const browser = await chromium.launch();
  const stamp = stampNow();
  try {
    const pages = pagesFor(args);
    const totals = await pages.reduce<Promise<Readonly<Record<string, PageTotals>>>>(
      async (prev, page) => ({
        ...(await prev),
        [page]: await auditPage(browser, served.url, args, page, stamp, baseline),
      }),
      Promise.resolve({}),
    );
    mkdirSync(resolve(args.out), { recursive: true });
    writeFileSync(
      resolve(args.out, 'report.json'),
      `${JSON.stringify({ stamp, pages: totals }, null, 2)}\n`,
    );
    console.log(
      Object.entries(totals)
        .map(([page, t]) => totalsLine(page as PageId, t))
        .join('\n'),
    );
    console.log(`report -> ${resolve(args.out, 'report.json')}`);
    return Object.values(totals).every((t) => t.casesPassed === t.cases) ? 0 : 1;
  } finally {
    await browser.close();
    await served.close();
  }
};

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  run(parseAuditArgs(process.argv.slice(2))).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error('space-audit:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
