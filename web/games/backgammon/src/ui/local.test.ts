import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { createGame, viewFor, type LogEntry, type View } from '../engine/index.ts';
import { bindLocal, curtainText, lastTurnText, paintCurtain } from './local.ts';
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
  test('the last move or forfeited roll, with its hit lines; nothing before a turn is played', () => {
    expect(lastTurnText({ ...bob, log: [] })).toBe('');
    expect(lastTurnText({ ...bob, log: [entry('roll', 0, 'Ann rolled 3-1')] })).toBe('');
    const log = [
      entry('roll', 0, 'Ann rolled 3-1'),
      entry('move', 0, 'Ann moved 8/5* 6/5'),
      entry('hit', 0, 'Ann hit Bob on the 5-point'),
      entry('roll', 1, 'Bob rolled 6-6'),
    ];
    expect(lastTurnText({ ...bob, log })).toBe('Ann moved 8/5* 6/5 · Ann hit Bob on the 5-point');
    expect(
      lastTurnText({ ...bob, log: [...log, entry('noMove', 1, 'Bob rolled 6-6 and cannot move')] }),
    ).toBe('Bob rolled 6-6 and cannot move');
  });
});

describe('curtainText', () => {
  const base: View = { ...bob, log: [entry('move', 0, 'Ann moved 8/5 6/5')] };
  test('to roll: one tap rolls unless a double is on offer', () => {
    expect(curtainText({ ...base, phase: 'toRoll', canDouble: false }, 1)).toEqual({
      title: 'Pass the phone to Bob',
      sub: 'Your turn.',
      last: 'Ann moved 8/5 6/5',
      button: 'Bob — roll',
      rolls: true,
    });
    expect(curtainText({ ...base, phase: 'toRoll', canDouble: true }, 1)).toMatchObject({
      button: 'Bob — your turn',
      rolls: false,
    });
  });
  test('the Western opening plays the dice already rolled; a cube offer is answered', () => {
    expect(curtainText({ ...base, phase: 'moving', dice: [6, 3] }, 1)).toMatchObject({
      button: 'Bob — play 6-3',
      rolls: false,
    });
    expect(
      curtainText({ ...base, phase: 'cubeOffered', cube: { value: 1, owner: null } }, 1),
    ).toMatchObject({ sub: 'Ann doubles to 2', button: 'Bob — answer', rolls: false });
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
    expect(p.get('curtainTitle').text()).toBe(`Pass the phone to ${name}`);
    expect(p.get('curtainSub').text()).toBe('Your turn.');
    expect(p.get('curtainLast').text()).toBe('');
    expect(p.get('curtainBtn').text()).toBe(`${name} — roll`);
    expect(p.get('curtainBtn').attr('data-rolls')).toBe('1');
    // Online play (and with it the handoff) is hidden in this PR.
    expect(p.get('curtainHandoffBtn').hidden()).toBe(true);
    const revealed = reduce(started, { type: 'curtain/reveal' }, ctx).app;
    paintCurtain(p.doc, revealed);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    expect(p.get('curtainTitle').text()).toBe(`Pass the phone to ${name}`);
    // A curtain without a view (unreachable) is not shown.
    paintCurtain(p.doc, { ...initialApp, table: { ...initialApp.table, curtain: 0 } });
    expect(p.get('curtainOverlay').hidden()).toBe(true);
  });
});

describe('bindLocal', () => {
  test('the curtain button reveals, and rolls when it promised to; the handoff button hands off', () => {
    const p = backgammonPage(MARKUP);
    const intents: Intent[] = [];
    bindLocal(p.doc, (i) => {
      intents.push(i);
    });
    p.get('curtainBtn').fire('click');
    expect(intents).toEqual([{ type: 'curtain/reveal' }]);
    p.get('curtainBtn').el.setAttribute('data-rolls', '1');
    p.get('curtainBtn').fire('click');
    expect(intents.slice(1)).toEqual([{ type: 'curtain/reveal' }, { type: 'roll/click' }]);
    p.get('curtainHandoffBtn').fire('click');
    expect(intents.at(-1)).toEqual({ type: 'handoff/click' });
  });
});
