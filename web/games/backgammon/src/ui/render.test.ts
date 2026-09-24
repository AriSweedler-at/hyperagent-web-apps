// No jsdom here (docs/ARCHITECTURE.md "Testing pyramid"): the paint runs against the page fake
// built from the page's own markup (ui/page.fake.ts over web/games/backgammon/index.html), so
// every id, initial class, value and data attribute is the real one. The Apps come from the
// reducer driven the way the page drives it (a seeded pass-and-play match, positions seated
// through `sandbox/load`), so what the painter sees is what main.ts hands it.
import { describe, expect, test } from 'vitest';

import { fakeEl, fakeTarget } from '../../../../shared/edge/page.fake.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { VARIANTS, parsePosition, viewFor, withPosition } from '../engine/index.ts';
import type { Board, Dice, Seat, State, View } from '../engine/index.ts';
import { backgammonPage, type BackgammonPage } from './page.fake.ts';
import {
  HIT_TOAST_PREFIX,
  RULES_SLOT_IDS,
  barKey,
  bindAll,
  boardIntentOf,
  connDotClass,
  cubeOfferText,
  gameBadgeText,
  hideToast,
  historyHtml,
  matchSubText,
  matchTitle,
  nextLabel,
  paint,
  paintScreen,
  paintSeat,
  paintSound,
  paintWaiting,
  recordKind,
  renderRules,
  rollLabel,
  scoreHtml,
  showToast,
  viewKey,
  waitNoteText,
} from './render.ts';
import { rulesItemsHtml } from './rules.ts';
import {
  SCREENS,
  initialApp,
  reduce,
  type App,
  type HomeSnapshot,
  type Intent,
  type Step,
} from './state.ts';

import MARKUP from '../../index.html?raw';

const page = (): BackgammonPage => backgammonPage(MARKUP);
const NOW = 1_700_000_000_000;
const ctx = { rng: mulberry32(7), now: () => NOW };
const R = VARIANTS.portes;

const run = (app: App, ...intents: ReadonlyArray<Intent>): Step =>
  intents.reduce<Step>(
    (s, intent) => {
      const next = reduce(s.app, intent, ctx);
      return { app: next.app, effects: [...s.effects, ...next.effects] };
    },
    { app, effects: [] },
  );
const pos = (text: string): Board => {
  const r = parsePosition(text, R);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const game = (app: App): State => {
  const g = app.shell.game;
  if (g === null) throw new Error('no game');
  return g;
};
const view = (app: App): View => {
  const v = app.shell.view;
  if (v === null) throw new Error('no view');
  return v;
};
const home: HomeSnapshot = {
  name: null,
  p2Name: null,
  homeTab: 'play',
  playMode: 'local',
  variant: 'portes',
  matchLength: 5,
  curtainMode: 'always',
  soundFont: 'default',
  save: null,
};
/** A pass-and-play match, curtain up for the starter. */
const local = (matchLength = '5', variant = 'portes'): App =>
  run(
    initialApp,
    { type: 'home/init', home },
    { type: 'local/click', p1: 'Ann', p2: 'Bob', matchLength, variant },
  ).app;
const revealed = (app: App): App => run(app, { type: 'curtain/reveal' }).app;
/** A pass-and-play game at `position` for `turn`, mid-turn with `dice` or waiting to roll when null. */
const at = (text: string, turn: Seat, dice: Dice | null, app: App = local()): App =>
  revealed(
    run(app, { type: 'sandbox/load', state: withPosition(game(app), pos(text), turn, dice) }).app,
  );
/** Seat 0's own point `own` as the page's id (`ownOf(0, abs) === abs + 1`). */
const pt = (own: number): string => `point-${String(own)}`;
const checkers = (p: BackgammonPage, id: string): number =>
  (
    p
      .get(id)
      .text()
      .match(/class="checker/g) ?? []
  ).length;
const shown = (p: BackgammonPage): ReadonlyArray<string> =>
  SCREENS.filter((id) => !p.get(id).hidden());
const withView = (app: App, v: View): App => ({ ...app, shell: { ...app.shell, view: v } });

describe("the shell painters (gin's names)", () => {
  test('renderRules fills both slots for the variant, keyed, and switches with it', () => {
    const p = page();
    renderRules(p.doc, 'portes');
    RULES_SLOT_IDS.forEach((id) => {
      expect(p.get(id).text()).toBe(rulesItemsHtml('portes'));
      expect(p.get(id).attr('data-key')).toBe('portes');
    });
    expect(p.get('rulesList').text()).not.toContain('<strong>The cube:</strong>');
    renderRules(p.doc, 'backgammon');
    expect(p.get('rulesList').text()).toContain('<strong>The cube:</strong>');
    expect(p.get('rulesList').text()).toContain('Crawford');
  });

  test('paintScreen shows one screen and fixes the body at the table', () => {
    const p = page();
    paintScreen(p.doc, initialApp);
    expect(shown(p)).toEqual(['homeScreen']);
    expect(p.body.hasClass('fixed-screen')).toBe(false);
    paintScreen(p.doc, { ...initialApp, shell: { ...initialApp.shell, screen: 'tableScreen' } });
    expect(shown(p)).toEqual(['tableScreen']);
    expect(p.body.hasClass('fixed-screen')).toBe(true);
  });

  test('paintWaiting: the code, both statuses with their pulse, the start button', () => {
    const p = page();
    paintWaiting(p.doc, initialApp);
    expect(p.get('roomCode').text()).toBe('----');
    expect(p.get('hostWaitStatus').hasClass('pulse')).toBe(true);
    expect(p.get('startGameBtn').hidden()).toBe(true);
    paintWaiting(p.doc, {
      ...initialApp,
      shell: {
        ...initialApp.shell,
        code: 'KQZM',
        hostStatus: { text: 'Jeff joined! Ready when you are.', pulse: false },
        guestStatus: { text: 'Connected', pulse: false },
        startGameVisible: true,
      },
    });
    expect(p.get('roomCode').text()).toBe('KQZM');
    expect(p.get('hostWaitStatus').text()).toBe('Jeff joined! Ready when you are.');
    expect(p.get('hostWaitStatus').hasClass('pulse')).toBe(false);
    expect(p.get('guestWaitStatus').text()).toBe('Connected');
    expect(p.get('startGameBtn').hidden()).toBe(false);
  });

  test('showToast/hideToast: the text, `show`, and `hit` for the Kapará toast alone', () => {
    const p = page();
    showToast(p.doc, `${HIT_TOAST_PREFIX} Bob hit you on your 5-point.`);
    expect(p.get('toast').text()).toBe('Kapará. Bob hit you on your 5-point.');
    expect(p.get('toast').hasClass('show')).toBe(true);
    expect(p.get('toast').hasClass('hit')).toBe(true);
    showToast(p.doc, 'Invite copied to clipboard');
    expect(p.get('toast').hasClass('hit')).toBe(false);
    hideToast(p.doc);
    expect(p.get('toast').hasClass('show')).toBe(false);
    expect(p.get('toast').text()).toBe('Invite copied to clipboard');
  });

  test('paintSound: the glyph, the tooltip and the pressed state', () => {
    const p = page();
    paintSound(p.doc, false);
    expect(p.get('soundBtn').text()).toBe('🔇');
    expect(p.get('soundBtn').attr('title')).toBe('Sound & vibration off');
    expect(p.get('soundBtn').attr('aria-pressed')).toBe('false');
    paintSound(p.doc, true);
    expect(p.get('soundBtn').text()).toBe('🔊');
    expect(p.get('soundBtn').attr('aria-pressed')).toBe('true');
  });

  test('connDotClass: on/off, hidden in pass-and-play', () => {
    expect(connDotClass(initialApp)).toBe('conn-dot off');
    expect(connDotClass(local())).toBe('conn-dot on hidden');
  });

  test('paint at home leaves the table untouched and the sheets down', () => {
    const p = page();
    paint(p.doc, run(initialApp, { type: 'home/init', home }).app);
    expect(shown(p)).toEqual(['homeScreen']);
    expect(p.get('point-1').text()).toBe('');
    expect(p.get('point-1').attr('data-key')).toBeNull();
    expect(p.get('resultOverlay').hidden()).toBe(true);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    expect(p.get('handoffBtn').hidden()).toBe(true);
  });
});

describe('the table', () => {
  test('a new pass-and-play match: the starting position keyed, the curtain up, the board inert', () => {
    const p = page();
    const app = local();
    paint(p.doc, app);
    expect(shown(p)).toEqual(['tableScreen']);
    expect(p.body.hasClass('fixed-screen')).toBe(true);
    expect(p.get('curtainOverlay').hidden()).toBe(false);
    expect(p.get('curtainTitle').text()).toMatch(/^Pass the phone to (Ann|Bob)$/);
    expect(p.get('board').hasClass('inert')).toBe(true);
    // Seat 0 (Light) as the reducer shows the starter's view: own 24:2 13:5 8:3 6:5 and the mirror.
    const v = view(app);
    const me = v.me.idx;
    const own = (n: number): string => pt(me === 0 ? n : 25 - n);
    const light = me === 0 ? 'L' : 'D';
    const dark = me === 0 ? 'D' : 'L';
    expect(p.get(own(24)).attr('data-key')).toBe(`${light}2`);
    expect(p.get(own(13)).attr('data-key')).toBe(`${light}5`);
    expect(p.get(own(8)).attr('data-key')).toBe(`${light}3`);
    expect(p.get(own(6)).attr('data-key')).toBe(`${light}5`);
    expect(p.get(own(1)).attr('data-key')).toBe(`${dark}2`);
    expect(p.get(own(12)).attr('data-key')).toBe(`${dark}5`);
    expect(checkers(p, own(13))).toBe(5);
    expect(p.get(own(13)).text()).toContain('class="checker ck-light top" style="--i:4"');
    expect(p.get('barTop').attr('data-key')).toBe('-0');
    expect(p.get('offLight').attr('data-key')).toBe('0');
    expect(p.get('dice').text()).toBe(
      '<span class="die blank" aria-hidden="true"></span><span class="die blank" aria-hidden="true"></span>',
    );
    expect(p.get('gameBadge').text()).toBe('Game 1 · 0–0 · to 5');
    expect(p.get('pipsMe').text()).toBe('167<span class="sr-only"> pips</span>');
    expect(p.get('oppDot').attr('class')).toBe('conn-dot on hidden');
    expect(p.get('rollBtn').hidden()).toBe(true);
    expect(p.get('doneBtn').hidden()).toBe(true);
    expect(p.get('cube').hidden()).toBe(true);
    expect(p.get('board').attr('data-view')).toBe(viewKey(v));
  });

  test('revealed and to roll: the roll button, blank dice, the pinned status; rolled: faces, sources, `rolling` once', () => {
    const p = page();
    const toRoll = revealed(local());
    paint(p.doc, toRoll);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    expect(p.get('rollBtn').hidden()).toBe(false);
    expect(p.get('rollBtn').text()).toBe('Buen mazal! <small>roll</small>');
    expect(p.get('undoBtn').disabled()).toBe(true);
    expect(p.get('statusText').text()).toBe('Your turn. Buen mazal!');
    expect(p.get('statusDice').text()).toBe('');
    expect(p.get('dice').attr('aria-label')).toBe('Roll');
    expect(p.get('board').hasClass('inert')).toBe(true);
    const rolled = run(toRoll, { type: 'roll/click' }).app;
    paint(p.doc, rolled);
    const v = view(rolled);
    expect(v.phase).toBe('moving');
    expect(p.get('rollBtn').hidden()).toBe(true);
    expect(p.get('diceMini').hidden()).toBe(false);
    expect(p.get('diceMini').text()).toBe(p.get('dice').text());
    expect(p.get('dice').text()).toMatch(
      /^<span class="die die-[1-6]" data-die="[1-6]" aria-label="die [1-6]"><\/span>/,
    );
    expect(p.get('dice').hasClass('rolling')).toBe(true);
    expect(p.get('statusDice').text()).toMatch(
      /^(one|two|three|four|five|six) and (one|two|three|four|five|six)$/,
    );
    expect(p.get('board').hasClass('inert')).toBe(false);
    const sources = v.legal.map((m) => m.from);
    expect(sources.length).toBeGreaterThan(0);
    sources.forEach((from) => {
      if (from !== 'bar')
        expect(p.get(`point-${String(from + 1)}`).hasClass('can-move')).toBe(true);
    });
    const [first] = sources;
    if (first === undefined || first === 'bar') throw new Error('expected a point source');
    expect(p.get(`point-${String(first + 1)}`).attr('aria-label')).toMatch(/, can move$/);
    // The same App again: the tumble class is off, the faces untouched.
    paint(p.doc, rolled);
    expect(p.get('dice').hasClass('rolling')).toBe(false);
  });

  test('a tapped source lights its targets outside the key: the checkers are not rebuilt', () => {
    const p = page();
    // Light to move 3-1 from the start: 8 and 6 can move; 8/5, 8/7, 6/5, 6/3, and 8/4 by both dice.
    const rolled = at('L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0', 0, [3, 1]);
    paint(p.doc, rolled);
    const before = p.get(pt(8)).text();
    expect(p.get(pt(8)).hasClass('can-move')).toBe(true);
    expect(p.get(pt(8)).hasClass('selected')).toBe(false);
    const selected = run(rolled, { type: 'point/tap', point: 7 }).app;
    paint(p.doc, selected);
    expect(p.get(pt(8)).hasClass('selected')).toBe(true);
    expect(p.get(pt(8)).hasClass('auto')).toBe(false);
    expect(p.get(pt(8)).attr('aria-pressed')).toBe('true');
    expect(p.get(pt(8)).attr('aria-label')).toBe('Your 8-point, 3 checkers, selected');
    expect(p.get(pt(8)).text()).toBe(before);
    expect(p.get(pt(8)).attr('data-key')).toBe('L3');
    expect(p.get(pt(5)).hasClass('target')).toBe(true);
    expect(p.get(pt(5)).attr('data-die')).toBe('3');
    expect(p.get(pt(5)).attr('aria-label')).toBe('Point 5, empty, target with the 3');
    expect(p.get(pt(7)).hasClass('target')).toBe(true);
    expect(p.get(pt(7)).attr('data-die')).toBe('1');
    expect(p.get(pt(4)).hasClass('target-2')).toBe(true);
    expect(p.get(pt(4)).attr('data-die')).toBe('3+1');
    expect(p.get(pt(6)).hasClass('target')).toBe(false);
    expect(p.get(pt(6)).attr('data-die')).toBeNull();
    // The move: two keys change, the flight's `hit` mark stays off (no blot), the die dims.
    const moved = run(selected, { type: 'point/tap', point: 4 }).app;
    paint(p.doc, moved);
    expect(p.get(pt(8)).attr('data-key')).toBe('L2');
    expect(p.get(pt(5)).attr('data-key')).toBe('L1');
    expect(p.get(pt(5)).hasClass('selected')).toBe(false);
    expect(p.get(pt(5)).hasClass('hit')).toBe(false);
    expect(p.get('dice').text()).toContain('class="die die-3 used"');
    expect(p.get('undoBtn').disabled()).toBe(false);
    expect(p.get('statusText').text()).toBe('Last move: the turn ends when you play it');
    const undone = run(moved, { type: 'undo/click' }).app;
    paint(p.doc, undone);
    expect(p.get(pt(8)).attr('data-key')).toBe('L3');
    expect(p.get('undoBtn').disabled()).toBe(true);
  });

  test('a checker on the bar is the derived sole source (`selected auto`); a hit marks the point', () => {
    const p = page();
    const entering = at('L: 13:14 | D: 1:2 2:2 3:2 7:9 | bar 1/0 | off 0/0', 0, [4, 2]);
    paint(p.doc, entering);
    expect(p.get('barBottom').attr('data-key')).toBe('L1');
    expect(p.get('barBottom').hasClass('can-move')).toBe(true);
    expect(p.get('barBottom').hasClass('selected')).toBe(true);
    expect(p.get('barBottom').hasClass('auto')).toBe(true);
    expect(p.get('barBottom').attr('aria-label')).toBe('Your bar, 1 checker, selected');
    expect(p.get(pt(21)).hasClass('target')).toBe(true);
    expect(p.get(pt(21)).attr('data-die')).toBe('4');
    // Bob holds his 2-point (my 23): the 2 enters nowhere, and the disc says so by its absence.
    expect(p.get(pt(23)).hasClass('target')).toBe(false);
    expect(p.get(pt(23)).attr('data-die')).toBeNull();
    expect(p.get('statusText').text()).toBe('4-2 · enter from the bar');
    // 8/5* with the 3: the blot leaves for Bob's bar and its point flashes `hit`.
    const hitting = at('L: 8:1 6:2 | D: 20:1 12:2 | bar 0/0 | off 12/12', 0, [3, 1]);
    paint(p.doc, hitting);
    const hit = run(hitting, { type: 'point/tap', point: 7 }, { type: 'point/tap', point: 4 }).app;
    paint(p.doc, hit);
    expect(p.get(pt(5)).attr('data-key')).toBe('L1');
    expect(p.get(pt(5)).hasClass('hit')).toBe(true);
    expect(p.get('barTop').attr('data-key')).toBe('D1');
    // The same position painted again flies nothing and the flash mark is gone.
    paint(p.doc, hit);
    expect(p.get(pt(5)).hasClass('hit')).toBe(false);
  });

  test('the die-chip tray: both dice bear off the same checker, the tap opens two chips', () => {
    const p = page();
    const bearing = at('L: 4:1 2:1 | D: 13:2 | bar 0/0 | off 13/13', 0, [6, 5]);
    paint(p.doc, bearing);
    expect(p.get('offLight').hasClass('target')).toBe(true);
    expect(p.get('offLight').attr('data-die')).toBe('6·5');
    expect(p.get('offLight').attr('aria-label')).toBe('Your tray, 13 off, target with the 6·5');
    expect(p.get('offDark').hasClass('target')).toBe(false);
    expect(p.get('controls').hasClass('choosing')).toBe(false);
    const pending = run(bearing, { type: 'off/tap' }).app;
    paint(p.doc, pending);
    expect(pending.table.pending).not.toBeNull();
    expect(p.get('controls').hasClass('choosing')).toBe(true);
    expect(p.get('moveChips').hidden()).toBe(false);
    expect(p.get('chipCancelBtn').hidden()).toBe(false);
    expect(
      p
        .get('moveChips')
        .text()
        .match(/class="chip"/g),
    ).toHaveLength(2);
    expect(p.get('moveChips').text()).toContain('data-index="0" data-dice="6" data-to="off"');
    expect(p.get('statusText').text()).toBe('4 · either die bears off');
    const chosen = run(pending, { type: 'chip/tap', index: 0 }).app;
    paint(p.doc, chosen);
    expect(p.get('controls').hasClass('choosing')).toBe(false);
    expect(p.get('offLight').attr('data-key')).toBe('14');
    expect(
      p
        .get('offLight')
        .text()
        .match(/class="slab"/g),
    ).toHaveLength(14);
  });

  test('game over: the result sheet, then the Result chip; match over: the endgame screen', () => {
    const p = page();
    // One checker left on my 1-point and a double: the tray disc names one die, the tap bears off.
    const last = at('L: 1:1 | D: 13:2 | bar 0/0 | off 14/13', 0, [6, 6]);
    expect(p.get('offLight').attr('data-die')).toBeNull();
    paint(p.doc, last);
    expect(p.get('offLight').attr('data-die')).toBe('6');
    const over = run(last, { type: 'off/tap' }).app;
    paint(p.doc, over);
    const v = view(over);
    expect(v.phase).toBe('over');
    expect(shown(p)).toEqual(['tableScreen']);
    expect(p.get('resultOverlay').hidden()).toBe(false);
    expect(p.get('rsTitle').text()).toBe('Ann wins 1 point');
    expect(p.get('rsSub').text()).toBe(`Bob had 2 checkers left · ${String(v.pips[1])} pips`);
    expect(p.get('rsScore').text()).toBe('Ann 1 – 0 Bob · match to 5');
    expect(p.get('rsNextBtn').text()).toBe('Next game');
    expect(p.get('rsNextBtn').disabled()).toBe(false);
    expect(p.get('statusText').text()).toBe('Ann wins 1 point');
    expect(p.get('resultChipBtn').hidden()).toBe(true);
    expect(p.get('board').hasClass('inert')).toBe(true);
    expect(p.get('rollBtn').hidden()).toBe(true);
    expect(p.get('waitNote').hidden()).toBe(true);
    const peeked = run(over, { type: 'result/peek' }).app;
    paint(p.doc, peeked);
    expect(p.get('resultOverlay').hidden()).toBe(true);
    expect(p.get('resultChipBtn').hidden()).toBe(false);
    // A one-point match: the same game ends it.
    const short = at('L: 1:1 | D: 13:2 | bar 0/0 | off 14/13', 0, [6, 6], local('1'));
    const won = run(short, { type: 'off/tap' }).app;
    paint(p.doc, won);
    expect(view(won).matchOver).toBe(true);
    expect(shown(p)).toEqual(['endgameScreen']);
    expect(p.get('resultOverlay').hidden()).toBe(true);
    expect(p.get('resultTitle').text()).toBe('Ann takes the match 1–0');
    expect(p.get('resultSub').text()).toBe('1 game');
    expect(p.get('matchScore').text()).toBe(
      '<div class="score-row"><span>Game 1</span><span class="who">Ann</span><span>single</span><span>1</span></div>',
    );
    expect(p.get('nextGameBtn').text()).toBe('Rematch');
  });

  test('the sheets: history rows, the menu with the curtain toggle, the rules keyed to the game', () => {
    const p = page();
    const rolled = revealed(run(revealed(local()), { type: 'roll/click' }).app);
    paint(p.doc, run(rolled, { type: 'history/toggle' }, { type: 'menu/toggle' }).app);
    expect(p.get('historyOverlay').hidden()).toBe(false);
    expect(p.get('historyList').text()).toMatch(/^<div class="history-row" data-kind="opening">/);
    expect(p.get('historyList').text()).toMatch(
      /<div class="history-row" data-kind="roll"><span class="who">(Ann|Bob)<\/span> rolled \d-\d<\/div>$/,
    );
    expect(p.get('historyList').text()).toContain('<span class="who">');
    expect(p.get('menuOverlay').hidden()).toBe(false);
    expect(p.get('menuCurtainToggle').checked()).toBe(true);
    expect(p.get('menuCurtainToggle').attr('data-next')).toBe('never');
    expect(p.get('rulesOverlay').hidden()).toBe(true);
    expect(p.get('rulesList').attr('data-key')).toBe('portes');
    const never = run(
      rolled,
      { type: 'curtain/mode', mode: 'never' },
      { type: 'rules/toggle' },
    ).app;
    paint(p.doc, never);
    expect(p.get('menuCurtainToggle').checked()).toBe(false);
    expect(p.get('menuCurtainToggle').attr('data-next')).toBe('always');
    expect(p.get('rulesOverlay').hidden()).toBe(false);
    expect(p.get('historyOverlay').hidden()).toBe(true);
  });

  test('paintSeat rewrites the frame once per seat: seat 1 sees abs 1 as its 24-point, far', () => {
    const p = page();
    const app = local();
    paint(p.doc, withView(app, viewFor(game(app), 1)));
    expect(p.get('board').attr('data-seat')).toBe('1');
    expect(p.get('point-1').attr('data-own')).toBe('24');
    expect(p.get('point-1').hasClass('pt-far')).toBe(true);
    expect(p.get('point-1').hasClass('pt-near')).toBe(false);
    expect(p.get('point-24').attr('data-own')).toBe('1');
    expect(p.get('point-24').hasClass('pt-near')).toBe(true);
    paintSeat(p.doc, viewFor(game(app), 0));
    expect(p.get('point-1').attr('data-own')).toBe('1');
    expect(p.get('point-1').hasClass('pt-near')).toBe(true);
  });

  test('the pure copy: badge, wait note, next button, match title, score rows, cube offer, bar key', () => {
    const app = revealed(local());
    const v = view(app);
    expect(gameBadgeText(v)).toBe('Game 1 · 0–0 · to 5');
    expect(waitNoteText(v)).toBe(`Waiting for ${v.opp.name}…`);
    expect(waitNoteText({ ...v, phase: 'cubeOffered' })).toBe(
      `${v.opp.name} is thinking about the cube`,
    );
    expect(nextLabel(app, v)).toBe('Next game');
    expect(nextLabel(app, { ...v, matchOver: true })).toBe('Rematch');
    const guest: App = { ...app, shell: { ...app.shell, role: 'guest' } };
    expect(nextLabel(guest, v)).toBe(`Waiting for ${v.opp.name}…`);
    expect(matchTitle({ ...v, match: { ...v.match, score: [5, 2] } })).toBe(
      'Ann takes the match 5–2',
    );
    expect(matchTitle({ ...v, match: { ...v.match, score: [1, 5] } })).toBe(
      'Bob takes the match 5–1',
    );
    expect(matchSubText({ ...v, games: [] })).toBe('0 games');
    const record = {
      gameNo: 3,
      variant: 'portes' as const,
      winner: 1 as const,
      multiplier: 2 as const,
      points: 2,
      reason: 'borneOff' as const,
      endedAt: NOW,
    };
    expect(recordKind(record)).toBe('gammon');
    expect(recordKind({ ...record, multiplier: 3 })).toBe('backgammon');
    expect(recordKind({ ...record, multiplier: 1, reason: 'passed' })).toBe('passed');
    expect(scoreHtml({ ...v, games: [record] }).markup).toBe(
      '<div class="score-row"><span>Game 3</span><span class="who">Bob</span><span>gammon</span><span>2</span></div>',
    );
    expect(cubeOfferText({ ...v, cube: { value: 2, owner: 0 } })).toEqual({
      offer: `${v.opp.name} doubles to 4. Take or pass?`,
      pass: `Pass (${v.opp.name} wins 2)`,
    });
    expect(historyHtml(null).markup).toBe(
      '<div class="empty-note">Nothing has happened yet.</div>',
    );
    expect(historyHtml({ ...v, log: [] }).markup).toContain('Nothing has happened yet.');
    const named = historyHtml({
      ...v,
      log: [{ seat: 0, kind: 'roll', text: 'Ann <b>rolled</b> 3-1', at: NOW }],
    }).markup;
    expect(named).toBe(
      '<div class="history-row" data-kind="roll"><span class="who">Ann</span> &lt;b&gt;rolled&lt;/b&gt; 3-1</div>',
    );
    expect(barKey(0, 0)).toBe('-0');
    expect(barKey(1, 2)).toBe('D2');
    expect(rollLabel(app, v).markup).toBe('Buen mazal! <small>roll</small>');
    const never: App = { ...app, table: { ...app.table, curtainMode: 'never' } };
    expect(rollLabel(never, v).markup).toBe(`${v.me.name} — Buen mazal! <small>roll</small>`);
  });
});

describe('bindAll', () => {
  const wired = (): Readonly<{ p: BackgammonPage; intents: Intent[] }> => {
    const p = page();
    const intents: Intent[] = [];
    bindAll(p.doc, (i) => {
      intents.push(i);
    });
    return { p, intents };
  };

  test('boardIntentOf: a die, the dice, a point, a bar, a tray, the board itself', () => {
    const p = page();
    const die = fakeEl('die3', { classes: ['die', 'die-3'], attrs: { 'data-die': '3' } });
    const blank = fakeEl('dieBlank', { classes: ['die', 'blank'] });
    const target = (closest: Readonly<Record<string, typeof die>>, id = ''): Readonly<Event> =>
      ({ target: fakeTarget({ closest, id }) }) as unknown as Readonly<Event>;
    expect(boardIntentOf(target({ '.die': die, '.dice': p.get('dice') }))).toEqual({
      type: 'die/pick',
      die: 3,
    });
    expect(boardIntentOf(target({ '.die': blank, '.dice': p.get('dice') }))).toEqual({
      type: 'roll/click',
    });
    expect(boardIntentOf(target({ '.dice': p.get('dice') }))).toEqual({ type: 'roll/click' });
    expect(boardIntentOf(target({ '.point': p.get('point-5') }))).toEqual({
      type: 'point/tap',
      point: 4,
    });
    expect(boardIntentOf(target({ '.bar': p.get('barBottom') }))).toEqual({ type: 'bar/tap' });
    expect(boardIntentOf(target({ '.off': p.get('offLight') }))).toEqual({ type: 'off/tap' });
    expect(boardIntentOf(target({}, 'board'))).toEqual({ type: 'chip/cancel' });
    expect(boardIntentOf(target({}, 'checker'))).toBeNull();
  });

  test('the board: one delegated click, Enter/Space as the tap, Escape for the tray and the sheets', () => {
    const { p, intents } = wired();
    p.get('board').fire('click', {
      target: fakeTarget({ closest: { '.point': p.get('point-8') } }),
    });
    expect(intents).toEqual([{ type: 'point/tap', point: 7 }]);
    const enter = p.get('board').fire('keydown', {
      key: 'Enter',
      target: fakeTarget({ closest: { '.off': p.get('offLight') } }),
    });
    expect(enter.wasPrevented()).toBe(true);
    const other = p.get('board').fire('keydown', {
      key: 'a',
      target: fakeTarget({ closest: { '.off': p.get('offLight') } }),
    });
    expect(other.wasPrevented()).toBe(false);
    p.get('board').fire('keydown', {
      key: ' ',
      target: fakeTarget({ closest: { '.bar': p.get('barBottom') } }),
    });
    expect(intents.slice(1)).toEqual([{ type: 'off/tap' }, { type: 'bar/tap' }]);
    p.fire('keydown', { key: 'Escape' });
    expect(intents.at(-1)).toEqual({ type: 'chip/cancel' });
    p.get('menuOverlay').el.classList.remove('hidden');
    p.fire('keydown', { key: 'Escape' });
    expect(intents.at(-1)).toEqual({ type: 'menu/toggle' });
    p.fire('keydown', { key: 'x' });
    expect(intents).toHaveLength(5);
  });

  test('the buttons dispatch their intents; a disabled button dispatches nothing', () => {
    const { p, intents } = wired();
    p.get('undoBtn').fire('click');
    expect(intents).toEqual([]);
    p.get('undoBtn').el.removeAttribute('disabled');
    p.get('undoBtn').fire('click');
    p.get('rollBtn').fire('click');
    p.get('doubleBtn').fire('click');
    p.get('doneBtn').fire('click');
    p.get('resultChipBtn').fire('click');
    p.get('rsNextBtn').fire('click');
    p.get('rsPeekBtn').fire('click');
    p.get('nextGameBtn').fire('click');
    p.get('takeBtn').fire('click');
    p.get('passBtn').fire('click');
    p.get('leaveBtn').fire('click');
    p.get('menuBtn').fire('click');
    p.get('soundBtn').fire('click');
    p.get('handoffBtn').fire('click');
    p.get('rulesBtnGame').fire('click');
    p.get('historyBtn').fire('click');
    p.get('chipCancelBtn').fire('click');
    expect(intents.map((i) => i.type)).toEqual([
      'undo/click',
      'roll/click',
      'double/click',
      'done/click',
      'result/open',
      'next/click',
      'result/peek',
      'next/click',
      'take/click',
      'pass/click',
      'leave/request',
      'menu/toggle',
      'sound/toggle',
      'handoff/click',
      'rules/toggle',
      'history/toggle',
      'chip/cancel',
    ]);
  });

  test('the tray, the menu rows, the curtain toggle and the sheet backdrops', () => {
    const { p, intents } = wired();
    const chip = fakeEl('chip1', { classes: ['chip'], attrs: { 'data-index': '1' } });
    p.get('moveChips').fire('click', { target: fakeTarget({ closest: { '.chip': chip } }) });
    p.get('moveChips').fire('click', { target: fakeTarget({}) });
    expect(intents).toEqual([{ type: 'chip/tap', index: 1 }]);
    p.get('menuRulesBtn').fire('click');
    p.get('menuHistoryBtn').fire('click');
    p.get('menuLeaveBtn').fire('click');
    expect(intents.slice(1)).toEqual([
      { type: 'menu/toggle' },
      { type: 'rules/toggle' },
      { type: 'menu/toggle' },
      { type: 'history/toggle' },
      { type: 'menu/toggle' },
      { type: 'leave/request' },
    ]);
    p.get('menuCurtainToggle').el.setAttribute('data-next', 'never');
    p.get('menuCurtainToggle').fire('change');
    expect(intents.at(-1)).toEqual({ type: 'curtain/mode', mode: 'never' });
    p.get('closeRulesBtn').fire('click');
    p.get('closeHistoryBtn').fire('click');
    p.get('closeMenuBtn').fire('click');
    p.get('rulesOverlay').fire('click', { target: fakeTarget({ id: 'rulesOverlay' }) });
    p.get('rulesOverlay').fire('click', { target: fakeTarget({ id: 'closeRulesBtn' }) });
    p.get('resultOverlay').fire('click', { target: fakeTarget({ id: 'resultOverlay' }) });
    expect(intents.slice(8)).toEqual([
      { type: 'rules/toggle' },
      { type: 'history/toggle' },
      { type: 'menu/toggle' },
      { type: 'rules/toggle' },
      { type: 'result/peek' },
    ]);
  });
});
