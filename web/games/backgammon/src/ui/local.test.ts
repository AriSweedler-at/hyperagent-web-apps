import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { createGame, viewFor, type LogEntry, type View } from '../engine/index.ts';
import {
  bindLocal,
  curtainText,
  lastTurnText,
  openingCurtain,
  openingRollText,
  paintCurtain,
} from './local.ts';
import { backgammonPage } from './page.fake.ts';
import { initialApp, reduce, type App, type HomeSnapshot, type Intent } from './state.ts';

import MARKUP from '../../index.html?raw';

const NOW = 1_700_000_000_000;
const ctx = { rng: mulberry32(5), now: () => NOW };
const game = createGame(
  [
    { id: 'p1', name: 'Ann' },
    { id: 'p2', name: 'Bob' },
  ],
  { matchLength: 5, rotation: ['portes'] },
  ctx.rng,
  ctx.now,
);
/** Seat 1's view, the phases hand-written (the copy is a function of the view alone). */
const bob: View = viewFor(game, 1);
const entry = (kind: LogEntry['kind'], seat: 0 | 1, text: string): LogEntry => ({
  kind,
  seat,
  text,
  at: NOW,
});

describe('lastTurnText', () => {
  const log = [
    entry('roll', 0, 'Ann rolled 3-1'),
    entry('move', 0, 'Ann moved 8/5* 6/5'),
    entry('hit', 0, 'Ann hit Bob on the 5-point'),
    entry('roll', 1, 'Bob rolled 6-6'),
  ];
  /** Ann's 8/5* 6/5 in the storage frame: abs 7 -> 4 (Bob's own 20) hitting, then abs 5 -> 4. */
  const lastPlay = [
    { from: 7, to: 4, die: 3, hit: true },
    { from: 5, to: 4, die: 1, hit: false },
  ] as const;
  test('the last move with its hits in the incoming player`s numbering; a forfeited roll as logged', () => {
    // Bob takes the phone: the point he was hit on is his 20, as the board under the curtain draws it.
    expect(lastTurnText({ ...bob, log, lastPlay }, 1)).toBe(
      'Ann moved 8/5* 6/5 · Ann hit you on your 20-point',
    );
    // Ann takes it back (a double offered after her turn): her own hits keep the log's line.
    expect(lastTurnText({ ...bob, log, lastPlay }, 0)).toBe(
      'Ann moved 8/5* 6/5 · Ann hit Bob on the 5-point',
    );
    expect(
      lastTurnText(
        {
          ...bob,
          log: [...log, entry('noMove', 1, 'Bob rolled 6-6 and cannot move')],
          lastPlay: [],
        },
        0,
      ),
    ).toBe('Bob rolled 6-6 and cannot move');
  });
  test('before any turn: the opening roll that decided who starts, ties left out', () => {
    expect(lastTurnText({ ...bob, log: [] }, 1)).toBe('');
    expect(lastTurnText({ ...bob, log: [entry('roll', 0, 'Ann rolled 3-1')] }, 1)).toBe('');
    const opening = [
      { seat: null, kind: 'opening' as const, text: 'Both rolled 4 — again', at: NOW },
      entry('opening', 0, 'Ann rolled 4, Bob rolled 2 — Ann starts'),
    ];
    expect(lastTurnText({ ...bob, log: opening }, 0)).toBe(
      'Ann rolled 4, Bob rolled 2 — Ann starts',
    );
    // The real game's first curtain reads the engine's own line.
    expect(lastTurnText(bob, game.turn)).toBe(game.log.at(-1)?.text);
    expect(lastTurnText(bob, game.turn)).toMatch(/^Ann rolled \d, Bob rolled \d — \w+ starts$/);
  });
});

describe('curtainText', () => {
  const moved = entry('move', 0, 'Ann moved 8/5 6/5');
  /** A turn has been played: every curtain from here hands the phone over. */
  const base: View = { ...bob, log: [moved], lastAction: moved };
  test('the first curtain of a game names the starter, not "Pass the phone": the holder may be them; the sub is the roll that decided it, once, and the last line is empty', () => {
    const starter = game.turn;
    const name = game.players[starter].name;
    const v = viewFor(game, starter);
    expect(openingCurtain(v)).toBe(true);
    // The roll sentence from the view's decisive dice, without the engine line's "— X starts".
    const roll = `${game.players[0].name} rolled ${String(game.opening[0])}, ${game.players[1].name} rolled ${String(game.opening[1])}.`;
    expect(openingRollText(v)).toBe(roll);
    expect(game.log.at(-1)?.text).toBe(`${roll.slice(0, -1)} — ${name} starts`);
    expect(curtainText(v, starter)).toEqual({
      title: `${name} starts`,
      sub: roll,
      last: '',
      button: `${name} — your turn`,
    });
    // A later game of the match opens the same way (setup.ts: its log announces it, then the roll).
    const later = entry('opening', 1, 'Bob rolled 5, Ann rolled 2 — Bob starts');
    const game2: View = {
      ...bob,
      log: [entry('game', 0, 'Game 2 begins'), later],
      lastAction: later,
    };
    expect(curtainText(game2, 1)).toMatchObject({
      title: 'Bob starts',
      sub: openingRollText(game2),
      last: '',
    });
    // The Western opening: the starter plays the pair; still theirs to start.
    const western: View = { ...bob, phase: 'moving', dice: [4, 2], lastAction: later };
    expect(curtainText(western, 1)).toMatchObject({
      title: 'Bob starts',
      sub: openingRollText(western),
      last: '',
      button: 'Bob — play 4-2',
    });
    // Once anything has happened (a move, a double), the phone changes hands.
    expect(openingCurtain(base)).toBe(false);
    expect(curtainText(base, 1).title).toBe('Pass the phone to Bob');
    const doubled = entry('double', 0, 'Ann doubles to 2');
    const offered: View = { ...bob, phase: 'cubeOffered', log: [doubled], lastAction: doubled };
    expect(curtainText(offered, 1).title).toBe('Pass the phone to Bob');
  });
  test('to roll: the button reveals and the sub says the roll waits behind it, or the cube', () => {
    expect(curtainText({ ...base, phase: 'toRoll', canDouble: false }, 1)).toEqual({
      title: 'Pass the phone to Bob',
      sub: 'Your turn. Roll when you have the phone.',
      last: 'Ann moved 8/5 6/5',
      button: 'Bob — your turn',
    });
    expect(curtainText({ ...base, phase: 'toRoll', canDouble: true }, 1)).toMatchObject({
      sub: 'Your turn. Double, or roll.',
      button: 'Bob — your turn',
    });
  });
  test('the Western opening plays the dice already rolled; a cube offer is answered', () => {
    expect(curtainText({ ...base, phase: 'moving', dice: [6, 3] }, 1)).toMatchObject({
      sub: 'Your turn.',
      button: 'Bob — play 6-3',
    });
    expect(
      curtainText({ ...base, phase: 'cubeOffered', cube: { value: 1, owner: null } }, 1),
    ).toMatchObject({ sub: 'Ann doubles to 2', button: 'Bob — answer' });
    expect(curtainText({ ...base, phase: 'over' }, 0)).toMatchObject({
      title: 'Pass the phone to Ann',
      button: 'Ann — look',
    });
  });
});

describe('paintCurtain', () => {
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
    recentGames: [],
  };
  const started: App = [
    { type: 'home/init', home } as const,
    { type: 'local/click', p1: 'Ann', p2: 'Bob' } as const,
  ].reduce<App>((app, intent) => reduce(app, intent, ctx).app, initialApp);

  test('shows the curtain with its texts for the waiting seat; hides it, texts untouched, otherwise', () => {
    const p = backgammonPage(MARKUP);
    paintCurtain(p.doc, started);
    const seat = started.table.curtain;
    if (seat === null) throw new Error('the curtain should be up for the starter');
    const name = game.players[seat].name;
    expect(p.get('curtainOverlay').hidden()).toBe(false);
    // The first curtain: the starter is named, the roll that decided it is the sub, once; the
    // last line is empty.
    const v = started.shell.view;
    if (v === null) throw new Error('a view');
    expect(p.get('curtainTitle').text()).toBe(`${name} starts`);
    expect(p.get('curtainSub').text()).toBe(openingRollText(v));
    expect(p.get('curtainSub').text()).toMatch(/^\w+ rolled [1-6], \w+ rolled [1-6]\.$/);
    expect(p.get('curtainLast').text()).toBe('');
    // The button reveals; the roll is the modal's (design §4.7), so no promise is painted.
    expect(p.get('curtainBtn').text()).toBe(`${name} — your turn`);
    expect(p.get('curtainBtn').attr('data-rolls')).toBeNull();
    // "Continue online" (ui/state.ts `handoff/click`) waits for a later curtain: hidden on the
    // first, back once the phone changes hands.
    expect(p.get('curtainHandoffBtn').hidden()).toBe(true);
    const moved = entry('move', 0, 'Ann moved 8/5 6/5');
    const laterView: View = { ...v, log: [...v.log, moved], lastAction: moved };
    const later: App = { ...started, shell: { ...started.shell, view: laterView } };
    paintCurtain(p.doc, later);
    expect(p.get('curtainTitle').text()).toBe(`Pass the phone to ${name}`);
    expect(p.get('curtainLast').text()).toBe('Ann moved 8/5 6/5');
    expect(p.get('curtainHandoffBtn').hidden()).toBe(false);
    paintCurtain(p.doc, started);
    expect(p.get('curtainHandoffBtn').hidden()).toBe(true);
    const revealed = reduce(started, { type: 'curtain/reveal' }, ctx).app;
    paintCurtain(p.doc, revealed);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    expect(p.get('curtainTitle').text()).toBe(`${name} starts`);
    // A curtain without a view (unreachable) is not shown.
    paintCurtain(p.doc, { ...initialApp, table: { ...initialApp.table, curtain: 0 } });
    expect(p.get('curtainOverlay').hidden()).toBe(true);
  });
});

describe('bindLocal', () => {
  test('the curtain button reveals, and only reveals; the handoff button hands off', () => {
    const p = backgammonPage(MARKUP);
    const intents: Intent[] = [];
    bindLocal(p.doc, (i) => {
      intents.push(i);
    });
    p.get('curtainBtn').fire('click');
    expect(intents).toEqual([{ type: 'curtain/reveal' }]);
    // A stale promise on the button (nothing paints one now) changes nothing.
    p.get('curtainBtn').el.setAttribute('data-rolls', '1');
    p.get('curtainBtn').fire('click');
    expect(intents.slice(1)).toEqual([{ type: 'curtain/reveal' }]);
    p.get('curtainHandoffBtn').fire('click');
    expect(intents.at(-1)).toEqual({ type: 'handoff/click' });
  });
});
