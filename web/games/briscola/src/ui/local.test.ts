// The curtain's copy (docs/design/briscola.md D17, §5.4) and its DOM half over the page fake.
import { describe, expect, test } from 'vitest';

import { NOW, runIntents } from '../../../../../test/shared/engine-helpers.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import {
  createGame,
  dealText,
  nameOf,
  viewFor,
  type TrickRecord,
  type View,
} from '../engine/index.ts';
import {
  REVEAL_LABEL,
  bindLocal,
  curtainText,
  lastLineText,
  listNames,
  lookAwayText,
  paintCurtain,
} from './local.ts';
import { briscolaPage } from './page.fake.ts';
import {
  DEFAULT_OPTS,
  initialApp,
  reduce,
  type App,
  type HomeSnapshot,
  type Intent,
} from './state.ts';

import MARKUP from '../../index.html?raw';

const ctx = { rng: mulberry32(5), now: () => NOW };
const run = runIntents(reduce, ctx);
const home: HomeSnapshot = {
  name: null,
  p2Name: null,
  homeTab: 'play',
  playMode: 'local',
  soundFont: 'default',
  save: null,
  recentGames: [],
  opts: DEFAULT_OPTS,
  cardPack: 'linea',
  lang: 'it',
  p3Name: null,
  p4Name: null,
};
const three = createGame(
  [
    { id: 'p1', name: 'Ann' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Cara' },
  ],
  {},
  ctx.rng,
  ctx.now,
);
/** Cara's view, the copy being a function of the view and the incoming seat alone. */
const cara: View = viewFor(three, 2);
const trick: TrickRecord = {
  no: 1,
  leader: 0,
  cards: [],
  winner: 0,
  points: 14,
  drew: [0, 1, 2],
  trumpTaken: false,
};
const view = (app: App): View => {
  const v = app.shell.view;
  if (v === null) throw new Error('no view');
  return v;
};

describe('the copy', () => {
  test('listNames: one, two, three names', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['Ann'])).toBe('Ann');
    expect(listNames(['Ann', 'Bob'])).toBe('Ann and Bob');
    expect(listNames(['Ann', 'Bob', 'Cara'])).toBe('Ann, Bob and Cara');
  });

  test('lookAwayText names everyone but the incoming player; lastLineText the deal, then the trick as they read it', () => {
    expect(lookAwayText(cara, 2)).toBe('Ann and Bob, look away');
    expect(lookAwayText(cara, 0)).toBe('Bob and Cara, look away');
    expect(lastLineText(cara, 2)).toBe(dealText(nameOf(cara.players, cara.dealer), cara.trumpCard));
    expect(lastLineText({ ...cara, lastTrick: trick }, 2)).toBe('Ann took the trick · 14 points');
    expect(lastLineText({ ...cara, lastTrick: trick }, 0)).toBe('You took the trick · 14 points');
  });

  test('curtainText: the title, the look-away line, the last line and the reveal label', () => {
    expect(curtainText({ ...cara, lastTrick: trick }, 1)).toEqual({
      title: 'Pass the phone to Bob',
      sub: 'Ann and Cara, look away',
      last: 'Ann took the trick · 14 points',
      button: REVEAL_LABEL,
    });
  });
});

describe('paintCurtain and bindLocal over the page', () => {
  test('a two-seat start: the curtain up for the leader with the handoff offered; revealed, it hides and leaves its texts', () => {
    const p = briscolaPage(MARKUP);
    const start = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'local/click', p1: 'Ann', p2: 'Bob' },
    ).app;
    paintCurtain(p.doc, start);
    const v = view(start);
    const incoming = start.table.curtain;
    expect(incoming).toBe(v.me.idx);
    expect(p.get('curtainOverlay').hidden()).toBe(false);
    expect(p.get('curtainTitle').text()).toBe(`Pass the phone to ${v.me.name}`);
    expect(p.get('curtainSub').text()).toBe(`${v.others[0]?.name ?? ''}, look away`);
    expect(p.get('curtainLast').text()).toBe(dealText(nameOf(v.players, v.dealer), v.trumpCard));
    expect(p.get('curtainBtn').text()).toBe(REVEAL_LABEL);
    expect(p.get('curtainHandoffBtn').hidden()).toBe(false);
    const revealed = run(start, { type: 'curtain/reveal' }).app;
    paintCurtain(p.doc, revealed);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    expect(p.get('curtainTitle').text()).toBe(`Pass the phone to ${v.me.name}`);
  });

  test('four seats: everyone else is told to look away and the handoff is not offered (D17)', () => {
    const p = briscolaPage(MARKUP);
    const start = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'local/click', p1: 'Ann', p2: 'Bob', localPlayers: '4', p3: 'Cara', p4: 'Dan' },
    ).app;
    paintCurtain(p.doc, start);
    const v = view(start);
    const others = ['Ann', 'Bob', 'Cara', 'Dan'].filter((n) => n !== v.me.name);
    expect(p.get('curtainSub').text()).toBe(`${listNames(others)}, look away`);
    expect(p.get('curtainHandoffBtn').hidden()).toBe(true);
    // No view: the curtain is down and the handoff button put away.
    paintCurtain(p.doc, initialApp);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    expect(p.get('curtainHandoffBtn').hidden()).toBe(true);
  });

  test('bindLocal: the reveal and the handoff', () => {
    const p = briscolaPage(MARKUP);
    const intents: Intent[] = [];
    bindLocal(p.doc, (i) => intents.push(i));
    p.get('curtainBtn').fire('click');
    p.get('curtainHandoffBtn').fire('click');
    expect(intents).toEqual([{ type: 'curtain/reveal' }, { type: 'handoff/click' }]);
  });
});
