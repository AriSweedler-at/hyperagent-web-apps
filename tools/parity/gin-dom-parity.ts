// DOM-snapshot parity for the gin port (docs/MIGRATION.md step 12; docs/ARCHITECTURE.md "Testing
// pyramid": ~60 recorded views compared against the legacy page). Two browser contexts with the
// same seeded `Math.random` and the same stepping `Date.now` open the LEGACY page and the NEW page
// and play the same pass-and-play game and the same Score Counter session through the UI, control
// by control; at every checkpoint the normalised `outerHTML` of the home screen, the curtain, the
// sheets, the endgame, the history and rules overlays, the scorer screens and the toast's text are
// compared, and any difference is a mismatch. The table screen is out of the snapshot since the
// ghost draw slot (docs/design/gin-draw-ghost-slot.md §9): it diverges by design (slots, the ghost
// cell, the undo button in the actions row, one pile size, shorter labels), while everything the
// table opens (the sheets, the overlays, the toast) still compares at every checkpoint. Only
// whitespace, the two rules slots' ids and the `#handoffBtn` and `#curtainHandoffBtn` buttons
// (the new page's markup additions) are normalised.
// What is read from the pages is compared; what is decided (which card
// to discard) is read from the legacy page's `window.__gin` hook and applied to both, so the two
// never diverge on a choice; after a draw the new page's ghost card is accepted (`acceptIfShown`)
// so both pages hold the same accepted state before the next click.
//
// Locally (Chromium from `npx playwright install`; `npm run build` first):
//   node --experimental-strip-types tools/parity/gin-dom-parity.ts
// It serves legacy/gin-rummy/index.html through tools/serve-dist.ts aliases and dist/ on a second
// server, prints every checkpoint and exits 1 on a mismatch. e2e/gin-dom-parity.spec.ts runs the
// same driver in CI on the harness's `pages` origin, where the legacy page is aliased under legacy/
// (e2e/fixtures/site.ts) beside the served dist/.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { routeOffline } from '../../e2e/fixtures/offline.ts';
import { seedScript } from '../../e2e/fixtures/seed.ts';
import { PAGES_BASE_PATH } from '../../e2e/fixtures/site.ts';
import { REPO_ROOT, isMain } from '../legacy/extract.ts';
import { startServer } from '../serve-dist.ts';

export const SEED = 12;
/** The pinned clock's first tick, the epoch of the other gin oracles. */
export const EPOCH = 1_700_000_000_000;
/** A stepping clock: every `Date.now()` is one second after the last, on both pages alike. */
export const clockScript = (epoch: number): string =>
  `(() => { let t = ${String(epoch)}; Date.now = () => (t += 1000); })();`;

/** The elements whose `outerHTML` is compared at every checkpoint (`tableScreen` diverges by design). */
export const SNAPSHOT_IDS: ReadonlyArray<string> = [
  'homeScreen',
  'curtainOverlay',
  'roundResultOverlay',
  'meldOverlay',
  'endgameScreen',
  'historyOverlay',
  'rulesOverlay',
  'scGameScreen',
  'scEndScreen',
  'scResOverlay',
];

/**
 * Whitespace runs, the rules slots' ids, the `#handoffBtn` and `#curtainHandoffBtn` buttons (the
 * pass-and-play game offered online, which the legacy page never had) and the Score Counter's
 * player inputs (two fixed ones sharing pass-and-play's names, where the legacy grew a list) are
 * the only differences allowed.
 */
export const normalise = (html: string): string =>
  html
    .replace(/ id="rules(Overlay)?List"/g, '')
    .replace(/<button[^>]*\bid="(curtainH|h)andoffBtn"[^>]*>[^<]*<\/button>/g, '')
    // The Score Counter's players: the legacy grew rows and an "+ Add player" button, the page has
    // two fixed inputs sharing pass-and-play's names; everything up to the Start button is blanked.
    .replace(
      /(<div class="setup-players" id="scPlayers">)[\s\S]*?(<button[^>]*\bid="scStartBtn")/g,
      '$1</div></div>$2',
    )
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();

export type Snapshot = Readonly<Record<string, string>>;
export type Mismatch = Readonly<{ checkpoint: string; id: string; legacy: string; next: string }>;
export type Report = Readonly<{
  checkpoints: ReadonlyArray<string>;
  mismatches: ReadonlyArray<Mismatch>;
}>;

/** The normalised markup of every snapshot element plus the toast's text. */
export const snapshot = async (page: Page): Promise<Snapshot> => {
  // A string expression: this file is node-side and has no DOM types.
  const raw = await page.evaluate<Record<string, string>>(
    `Object.fromEntries([
      ...${JSON.stringify(SNAPSHOT_IDS)}.map((id) => [id, document.getElementById(id)?.outerHTML ?? '<missing #' + id + '>']),
      ['toast', document.getElementById('toast')?.textContent ?? ''],
    ])`,
  );
  return Object.fromEntries(Object.entries(raw).map(([id, html]) => [id, normalise(html)]));
};

export type Pair = Readonly<{
  legacy: Page;
  next: Page;
  /** Uncaught exceptions on either page, prefixed with the page. */
  errors: () => ReadonlyArray<string>;
  close: () => Promise<void>;
}>;

/** A context with the seed, the clock, the offline routes and a dialog queue the driver feeds. */
const openContext = async (
  browser: Browser,
  url: string,
  label: string,
  errors: string[],
  answers: () => string | undefined,
): Promise<Readonly<{ context: BrowserContext; page: Page }>> => {
  const context = await browser.newContext();
  context.setDefaultTimeout(15_000);
  await context.addInitScript({ content: `${seedScript(SEED)}\n${clockScript(EPOCH)}` });
  await routeOffline(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    errors.push(`${label}: ${e.message}`);
  });
  page.on('dialog', (dialog) => {
    // confirm() is accepted; prompt() gets the next queued answer (null cancels).
    const answer = dialog.type() === 'prompt' ? answers() : undefined;
    void (answer === 'CANCEL' ? dialog.dismiss() : dialog.accept(answer));
  });
  const response = await page.goto(url);
  // A 404 here would otherwise surface much later as "0 checkpoints" (the driver waits on hooks
  // that never appear): name the page and the status instead.
  if (!response?.ok()) {
    const status = response ? `HTTP ${String(response.status())}` : 'no response';
    throw new Error(`${label} page not served (${status}): ${url}`);
  }
  return { context, page };
};

/** Both pages, open on their origins, with one shared prompt queue. */
export const openPair = async (
  browser: Browser,
  legacyUrl: string,
  nextUrl: string,
  prompts: ReadonlyArray<string> = [],
): Promise<Pair> => {
  const errors: string[] = [];
  const queues = { legacy: [...prompts], next: [...prompts] };
  const legacy = await openContext(browser, legacyUrl, 'legacy', errors, () =>
    queues.legacy.shift(),
  );
  const next = await openContext(browser, nextUrl, 'next', errors, () => queues.next.shift());
  return {
    legacy: legacy.page,
    next: next.page,
    errors: () => errors,
    close: async () => {
      await Promise.all([legacy.context.close(), next.context.close()]);
    },
  };
};

// ---- the driver ---------------------------------------------------------------------------------------

type Step = (page: Page) => Promise<void>;

/** The legacy page's view through its documented hook, for the choices the driver makes. */
export type HookView = Readonly<{
  phase: string;
  isMyTurn: boolean;
  me: Readonly<{ hand: ReadonlyArray<Readonly<{ id: string }>> }>;
  discardOptions: Readonly<
    Record<string, Readonly<{ locked?: boolean; deadwood?: number; canKnock?: boolean }>>
  > | null;
  drawnFromDiscard: string | null;
  meldOptions: ReadonlyArray<unknown>;
  forceStock: boolean;
}>;

export const readView = (page: Page): Promise<HookView | null> =>
  page.evaluate<HookView | null>('window.__gin.app.view');

/**
 * Accept the drawn card when the page shows it in the ghost slot (docs/design/gin-draw-ghost-slot.md
 * §4: a tap on it puts it into the hand), so a driver that took the upcard or drew from the stock
 * goes on from the accepted eleven-card state. The legacy page never has one: a no-op there.
 */
export const acceptIfShown = async (page: Page): Promise<void> => {
  const ghost = page.locator('#hand .slot.ghost .card');
  if ((await ghost.count()) === 0) return;
  await ghost.click();
  await page.locator('#hand .slot.ghost').waitFor({ state: 'detached' });
};

const click =
  (selector: string): Step =>
  async (page) => {
    await page.locator(selector).click();
  };
const fill =
  (selector: string, value: string): Step =>
  async (page) => {
    await page.locator(selector).fill(value);
  };

/** The prompt answers the scorer's edit dialogs get, in order, on both pages. */
export const PROMPTS: ReadonlyArray<string> = ['Bob', 'gin', '12'];

/** The screens without `hidden` on a page, for the report when a step fails. */
const visibleScreens = (page: Page): Promise<string> =>
  page.evaluate<string>(
    `Array.from(document.querySelectorAll('#app > div, .overlay')).filter((e) => !e.classList.contains('hidden')).map((e) => '#' + e.id).join(' ')`,
  );

export const runParity = async (pair: Pair): Promise<Report> => {
  const checkpoints: string[] = [];
  const mismatches: Mismatch[] = [];
  try {
    await drive(pair, checkpoints, mismatches);
  } catch (e: unknown) {
    // A step that could not be applied to one page is itself a difference: report where each is.
    const [legacy, next] = await Promise.all([
      visibleScreens(pair.legacy),
      visibleScreens(pair.next),
    ]);
    mismatches.push({
      checkpoint: `step after "${checkpoints.at(-1) ?? 'start'}" failed: ${e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e)}`,
      id: 'visible screens',
      legacy,
      next,
    });
  }
  return { checkpoints, mismatches };
};

const drive = async (pair: Pair, checkpoints: string[], mismatches: Mismatch[]): Promise<void> => {
  const both = async (step: Step): Promise<void> => {
    await Promise.all([step(pair.legacy), step(pair.next)]);
  };
  const check = async (name: string): Promise<void> => {
    const [a, b] = await Promise.all([snapshot(pair.legacy), snapshot(pair.next)]);
    checkpoints.push(name);
    Object.keys(a).forEach((id) => {
      if (a[id] !== b[id])
        mismatches.push({ checkpoint: name, id, legacy: a[id] ?? '', next: b[id] ?? '' });
    });
  };
  const waitVisible =
    (selector: string): Step =>
    async (page) => {
      await page.locator(selector).waitFor({ state: 'visible' });
    };

  // ---- home ----
  await both(async (page) => {
    await page.waitForFunction('typeof window.__gin === "object"');
    await page.locator('#homeScreen').waitFor();
  });
  await check('home: fresh');
  await both(click('#tabRulesBtn'));
  await check('home: rules tab');
  await both(click('#tabScoreBtn'));
  await check('home: score tab, default players');
  await both(click('#tabPlayBtn'));
  await check('home: play tab');
  await both(click('#playModeSwitch .mode-btn[data-mode="local"]'));
  await check('home: pass & play mode');

  // ---- pass and play to a knock, a one-point target so the first scored hand ends the game ----
  await both(fill('#p1NameInput', 'Ann'));
  await both(fill('#p2NameInput', 'Bob'));
  await both(fill('#localTargetInput', '1'));
  await both(click('#localBtn'));
  await both(waitVisible('#curtainOverlay'));
  await check('local: dealt, curtain up');
  await both(click('#curtainBtn'));
  await check('local: first seat revealed (upcard decision)');
  await both(click('#actions [data-act="passUpcard"]'));
  await check('local: non-dealer passed, curtain');
  await both(click('#curtainBtn'));
  await check('local: dealer revealed');
  await both(click('#actions [data-act="takeUpcard"]'));
  await acceptIfShown(pair.next);
  await check('local: dealer took the upcard');
  const taken = await readView(pair.legacy);
  const lockedId = taken?.drawnFromDiscard ?? null;
  const firstFree = taken?.me.hand.find((c) => c.id !== lockedId)?.id ?? null;
  if (lockedId === null || firstFree === null) throw new Error('no upcard was taken');
  await both(click(`#hand .card[data-card="${lockedId}"]`));
  await check('local: tapping the locked card toasts');
  await both(click(`#hand .card[data-card="${firstFree}"]`));
  await check('local: a card selected');
  await both(click(`#hand .card[data-card="${firstFree}"]`));
  await check('local: the card deselected');
  await both(click(`#hand .card[data-card="${firstFree}"]`));
  await both(click('#actions [data-act="discard"]'));
  await check('local: discarded, curtain for the non-dealer');

  // Turns until a knock: draw from the stock, choose the card that leaves the least deadwood.
  const playTurn = async (turn: number): Promise<'knocked' | 'played' | 'void'> => {
    await both(click('#curtainBtn'));
    await check(`turn ${String(turn)}: revealed`);
    const before = await readView(pair.legacy);
    if (before === null) throw new Error('no view');
    if (before.phase === 'roundOver') return 'void';
    if (before.phase === 'draw') {
      await both(click('#stockPile'));
      await acceptIfShown(pair.next);
      await check(`turn ${String(turn)}: drew from the stock`);
    }
    const view = await readView(pair.legacy);
    const discardOptions = view?.discardOptions ?? null;
    if (discardOptions === null) throw new Error('no discard options');
    const options = Object.entries(discardOptions)
      .filter(([, o]) => o.locked !== true)
      .map(([id, o]) => ({ id, deadwood: o.deadwood ?? Infinity, canKnock: o.canKnock === true }));
    const knock = options.find((o) => o.canKnock);
    const best = [...options].sort((a, b) => a.deadwood - b.deadwood)[0];
    if ((view?.meldOptions.length ?? 0) > 1) {
      await both(click('#deadwoodInfo'));
      await check(`turn ${String(turn)}: meld chooser open`);
      await both(click('#meldOptionList [data-meld-opt]'));
      await check(`turn ${String(turn)}: arrangement chosen`);
    }
    if (knock !== undefined) {
      await both(click(`#hand .card[data-card="${knock.id}"]`));
      await check(`turn ${String(turn)}: knock available`);
      await both(click('#actions [data-act="knock"]'));
      await check(`turn ${String(turn)}: knocked, result sheet`);
      return 'knocked';
    }
    if (best === undefined) throw new Error('no discard');
    await both(click(`#hand .card[data-card="${best.id}"]`));
    await check(`turn ${String(turn)}: best discard selected`);
    await both(click('#actions [data-act="discard"]'));
    await check(`turn ${String(turn)}: discarded`);
    return 'played';
  };
  const untilKnock = async (turn: number): Promise<void> => {
    if (turn > 60) throw new Error('no knock within 60 turns; pick another SEED');
    const outcome = await playTurn(turn);
    if (outcome === 'knocked') return;
    if (outcome === 'void') {
      await both(click('#rrContinueBtn'));
      await check(`turn ${String(turn)}: void hand, redealt`);
    }
    await untilKnock(turn + 1);
  };
  await untilKnock(1);

  // ---- the hand over: the sheet, the table behind it, the overlays, the endgame ----
  await both(click('#rrHideBtn'));
  await check('round over: sheet hidden, "Show results"');
  await both(click('#actions [data-act="showResult"]'));
  await check('round over: sheet shown again');
  await both(click('#rrHideBtn'));
  await both(click('#historyBtn'));
  await check('round over: game history');
  await both(click('#closeHistoryBtn'));
  await both(click('#rulesBtnGame'));
  await check('round over: rules overlay');
  await both(click('#closeRulesBtn'));
  await both(click('#actions [data-act="showResult"]'));
  await both(click('#rrContinueBtn'));
  await check('game over: endgame under the result sheet');
  await both(click('#rrHideBtn'));
  await check('game over: endgame screen');
  await both(click('#historyBtnEnd'));
  await check('game over: history from the endgame');
  await both(click('#closeHistoryBtn'));
  await both(click('#rematchBtn'));
  await both(waitVisible('#curtainOverlay'));
  await check('rematch: a fresh deal, curtain');

  // ---- reload mid-game: the resume box, then the game back ----
  await both(async (page) => {
    await page.reload();
    await page.waitForFunction('typeof window.__gin === "object"');
    await page.locator('#homeScreen').waitFor();
  });
  await check('reload: home with the resume box');
  await both(click('#resumeBtn'));
  await both(waitVisible('#curtainOverlay'));
  await check('reload: resumed, curtain');
  await both(click('#curtainBtn'));
  await check('reload: resumed table');
  await both(click('#leaveBtn'));
  await both(waitVisible('#homeScreen'));
  await check('left: home');

  // ---- the Score Counter ----
  // Two players only on this page (the legacy list grew and shrank; its rows are blanked by
  // `normalise`), so the add and remove steps are gone with the button.
  await both(click('#tabScoreBtn'));
  await check('scorer: setup');
  await both(async (page) => {
    const names = page.locator('#scPlayers input');
    await names.nth(0).fill('Ann');
    await names.nth(1).fill('Bob');
    await page.locator('#scTargetInput').fill('30');
  });
  await both(click('#scStartBtn'));
  await both(waitVisible('#scGameScreen'));
  await check('scorer: board');
  await both(click('#scBoard .player-card >> nth=0 >> .chip[data-k="knock"]'));
  await check('scorer: Ann knocked');
  await both(fill('#scBoard .player-card >> nth=0 >> input.dw', '5'));
  await both(fill('#scBoard .player-card >> nth=1 >> input.dw', '20'));
  await both(click('#scBoard .player-card >> nth=1 >> .inc'));
  await check('scorer: entries typed and stepped');
  await both(click('#scBoard .player-card >> nth=1 >> .chip[data-k="gin"]'));
  await check('scorer: Bob gin locks his deadwood');
  await both(click('#scBoard .player-card >> nth=1 >> .chip[data-k="gin"]'));
  await both(click('#scBoard .player-card >> nth=0 >> .chip[data-k="knock"]'));
  await check('scorer: back to Ann knocked');
  // Bob's Gin chip, toggled off, left his deadwood at 0 (as the legacy did): Ann's knock with 5 is
  // undercut for 5 + 25 = 30, the target, so the first hand ends the session.
  await both(click('#scSubmitBtn'));
  await check('scorer: hand result (undercut)');
  await both(click('#scResContinue'));
  await check('scorer: target reached, end screen');
  await both(click('#scEndHistoryBtn'));
  await check('scorer: history from the end screen');
  // Edit the hand through the prompt() dialogs (PROMPTS): Bob went gin, Ann had 12.
  await both(click('#historyList [data-edit="0"]'));
  await check('scorer: hand edited through the prompts');
  await both(click('#historyList [data-del="0"]'));
  await check('scorer: hand deleted');
  await both(click('#closeHistoryBtn'));
  await both(click('#scEndKeepBtn'));
  await check('scorer: keep playing, no hands');
  await both(click('#scExportBtn'));
  await check('scorer: export with no hands toasts');
  await both(click('#scHistoryBtn'));
  await check('scorer: empty history');
  await both(click('#closeHistoryBtn'));
  await both(click('#scBoard .player-card >> nth=1 >> .chip[data-k="gin"]'));
  await both(fill('#scBoard .player-card >> nth=0 >> input.dw', '40'));
  await check('scorer: gin entered');
  await both(click('#scSubmitBtn'));
  await check('scorer: gin result');
  await both(click('#scResContinue'));
  await check('scorer: game over again');
  await both(click('#scEndExportBtn'));
  await check('scorer: exported toast');
  await both(click('#scEndNewBtn'));
  await check('scorer: new game, fresh setup');
  await both(click('#tabPlayBtn'));
  await check('home: play tab after scoring');
};

// ---- CLI ---------------------------------------------------------------------------------------------

const HOST = '127.0.0.1';

const printReport = (report: Report, errors: ReadonlyArray<string>): boolean => {
  report.checkpoints.forEach((name) => {
    const bad = report.mismatches.filter((m) => m.checkpoint === name);
    console.log(`${bad.length === 0 ? 'ok  ' : 'DIFF'} ${name}`);
  });
  report.mismatches.forEach((m) => {
    console.log(`\n--- ${m.checkpoint} #${m.id}\nlegacy: ${m.legacy}\nnext:   ${m.next}`);
  });
  errors.forEach((e) => {
    console.log(`page error: ${e}`);
  });
  console.log(
    `\n${String(report.checkpoints.length)} checkpoints, ${String(report.mismatches.length)} mismatches, ${String(errors.length)} page errors`,
  );
  return report.mismatches.length === 0 && errors.length === 0;
};

if (isMain(import.meta.url)) {
  const dist = resolve(REPO_ROOT, 'dist');
  if (!existsSync(resolve(dist, 'games', 'gin-rummy', 'index.html'))) {
    console.error('dist/ has no gin page: run `npm run build` first');
    process.exit(1);
  }
  const legacyServer = await startServer({
    root: resolve(REPO_ROOT, 'legacy'),
    base: PAGES_BASE_PATH,
    host: HOST,
    port: 0,
    aliases: {
      'games/gin-rummy/index.html': resolve(REPO_ROOT, 'legacy/gin-rummy/index.html'),
      'shared/ice.js': resolve(REPO_ROOT, 'legacy/shared/ice.js'),
    },
  });
  const nextServer = await startServer({
    root: dist,
    base: PAGES_BASE_PATH,
    host: HOST,
    port: 0,
    aliases: {},
  });
  const browser = await chromium.launch();
  try {
    const pair = await openPair(
      browser,
      `${legacyServer.url}${PAGES_BASE_PATH}games/gin-rummy/index.html`,
      `${nextServer.url}${PAGES_BASE_PATH}games/gin-rummy/`,
      PROMPTS,
    );
    const report = await runParity(pair);
    const ok = printReport(report, pair.errors());
    await pair.close();
    process.exitCode = ok ? 0 : 1;
  } finally {
    await browser.close();
    await Promise.all([legacyServer.close(), nextServer.close()]);
  }
}
