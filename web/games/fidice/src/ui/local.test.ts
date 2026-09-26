// The curtain's copy (docs/design/fidice-shell-adoption.md §7 D8) and its DOM half over the page fake.
import { describe, expect, test } from 'vitest';

import { NOW, must, runIntents } from '../../../../../test/shared/engine-helpers.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { HOST, apply, newGame } from '../domain/game.ts';
import { makeBot, makeHuman, seatPlayer } from '../domain/lobby.ts';
import { redactFor } from '../domain/publicState.ts';
import type { PublicState } from '../domain/types.ts';
import {
  FRESH_ROLL_MSG,
  REVEAL_LABEL,
  bindLocal,
  curtainText,
  lastLineText,
  listNames,
  lookAwayText,
  paintCurtain,
} from './local.ts';
import { fidicePage } from './page.fake.ts';
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
  extraNames: { 2: null, 3: null, 4: null, 5: null },
};

/** Ann, Bob and a computer at a table of three, in the lobby (no log) and started. */
const table = (): PublicState => {
  const lobby = must(
    seatPlayer(
      must(seatPlayer(newGame('ABCDE', 0), makeHuman('host', 'Ann', 0))),
      makeHuman('guest', 'Bob', 0),
    ),
  );
  const withBot = must(
    seatPlayer(lobby, makeBot(lobby, 'bot0', { strategy: 'gambler', random: false })),
  );
  return redactFor(withBot, { kind: 'spectator' });
};

describe('the curtain copy', () => {
  test('listNames: one, two, three', () => {
    expect(listNames(['Ann'])).toBe('Ann');
    expect(listNames(['Ann', 'Bob'])).toBe('Ann and Bob');
    expect(listNames(['Ann', 'Bob', 'Cara'])).toBe('Ann, Bob and Cara');
    expect(listNames([])).toBe('');
  });

  test('the incoming player is named; the other humans look away, the computers need no telling; the last line is the table talk`s or the fresh roll', () => {
    const v = table();
    expect(curtainText(v, 1)).toEqual({
      title: 'Pass the phone to Bob',
      sub: 'Ann, look away',
      last: v.log[v.log.length - 1]?.text,
      button: REVEAL_LABEL,
    });
    expect(lastLineText({ ...v, log: [] })).toBe(FRESH_ROLL_MSG);
    expect(lookAwayText(v, 0)).toBe('Bob, look away');
    const started = redactFor(
      must(
        apply(
          must(
            seatPlayer(
              must(seatPlayer(newGame('ABCDE', 0), makeHuman('host', 'Ann', 0))),
              makeHuman('guest', 'Bob', 0),
            ),
          ),
          HOST,
          { type: 'start' },
          mulberry32(1),
        ),
      ),
      { kind: 'spectator' },
    );
    expect(started.log.length).toBeGreaterThan(0);
    expect(lastLineText(started)).toBe(started.log[started.log.length - 1]?.text);
    const alone = redactFor(must(seatPlayer(newGame('ABCDE', 0), makeHuman('host', 'Ann', 0))), {
      kind: 'spectator',
    });
    expect(lookAwayText(alone, 0)).toBe('Everyone else, look away');
  });
});

describe('the curtain over the page', () => {
  test('hidden with no seat waiting; up for the cup holder at a pass-the-phone start, naming them; down after one tap', () => {
    const p = fidicePage(MARKUP);
    paintCurtain(p.doc, initialApp);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    const started: App = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'mode/set', mode: 'local' },
      { type: 'local/click', p1: 'Ann', p2: 'Bob' },
    ).app;
    expect(started.table.curtain).not.toBeNull();
    paintCurtain(p.doc, started);
    expect(p.get('curtainOverlay').hidden()).toBe(false);
    expect(p.get('curtainTitle').text()).toMatch(/^Pass the phone to (Ann|Bob)$/);
    expect(p.get('curtainSub').text()).toMatch(/^(Ann|Bob), look away$/);
    expect(p.get('curtainBtn').text()).toBe(REVEAL_LABEL);
    const lifted = run(started, { type: 'curtain/reveal' }).app;
    expect(lifted.table.curtain).toBeNull();
    paintCurtain(p.doc, lifted);
    expect(p.get('curtainOverlay').hidden()).toBe(true);
    // The texts are left as they were (gin's rule).
    expect(p.get('curtainTitle').text()).toMatch(/^Pass the phone to (Ann|Bob)$/);
  });

  test('bindLocal: one tap on #curtainBtn is curtain/reveal', () => {
    const p = fidicePage(MARKUP);
    const intents: Intent[] = [];
    bindLocal(p.doc, (i) => intents.push(i));
    p.get('curtainBtn').fire('click');
    expect(intents).toEqual([{ type: 'curtain/reveal' }]);
  });
});
