import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { applyAction, createGame, viewFor } from '../engine/index.ts';
import type { Action, Seat, State, View } from '../engine/index.ts';
import {
  INITIAL_CUES,
  deadwoodText,
  fmtDuration,
  nextCue,
  selectionIn,
  statusFor,
  statusWith,
} from './cues.ts';

const now = (): number => 1_700_000_000_000;
const PLAYERS = [
  { id: 'host', name: 'Ann' },
  { id: 'guest', name: 'Jeff' },
] as const;

const play = (state: State, moves: ReadonlyArray<readonly [Seat, Action]>): State =>
  moves.reduce((g, [seat, a]) => {
    const r = applyAction(g, seat, a, mulberry32(0), now);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }, state);

/** Dealer 1, so seat 0 (Ann) is the non-dealer and moves first. */
const dealt = createGame({ players: PLAYERS, target: 100, dealer: 1 }, mulberry32(3), now);
const drawn = play(dealt, [
  [0, { type: 'passUpcard' }],
  [1, { type: 'passUpcard' }],
  [0, { type: 'drawStock' }],
]);

describe('statusFor', () => {
  test('the upcard, draw and discard prompts for the mover, and the waiting texts for the other', () => {
    expect(statusFor(viewFor(dealt, 0), null)).toEqual({
      main: 'Your turn',
      sub: 'Take the upcard or pass',
    });
    expect(statusFor(viewFor(dealt, 1), null)).toEqual({
      main: "Ann's turn",
      sub: 'Deciding on the upcard…',
    });
    const bothPassed = play(dealt, [
      [0, { type: 'passUpcard' }],
      [1, { type: 'passUpcard' }],
    ]);
    expect(statusFor(viewFor(bothPassed, 0), null).sub).toBe('Both passed — tap the stock to draw');
    expect(statusFor(viewFor(bothPassed, 1), null).sub).toBe('Drawing a card…');
    const tookUpcard = play(dealt, [[0, { type: 'takeUpcard' }]]);
    const discarded = play(tookUpcard, [
      [0, { type: 'discard', cardId: tookUpcard.hands[0][0]?.id ?? '' }],
    ]);
    expect(statusFor(viewFor(discarded, 1), null).sub).toBe('Tap the stock or the discard pile');
    expect(statusFor(viewFor(drawn, 0), null).sub).toBe('Tap a card to select it');
    expect(statusFor(viewFor(drawn, 0), 'AS').sub).toBe('Discard it, or knock if you can');
    expect(statusFor(viewFor(drawn, 1), null)).toEqual({
      main: "Ann's turn",
      sub: 'Choosing a discard…',
    });
  });

  test('a finished hand and a finished game', () => {
    const roundOver: View = { ...viewFor(drawn, 0), phase: 'roundOver', result: null };
    expect(statusFor(roundOver, null)).toEqual({ main: 'Hand over', sub: 'See results' });
    const voided: View = {
      ...roundOver,
      result: { void: true, ts: 0, totals: [0, 0] },
    };
    expect(statusFor(voided, null).main).toBe('Hand void');
    const over: View = { ...viewFor(drawn, 0), phase: 'gameOver' };
    expect(statusFor(over, null)).toEqual({ main: '', sub: '' });
  });
});

describe('statusWith', () => {
  test('the two ghost-slot moments in front of statusFor; without a stage it is statusFor', () => {
    const v = viewFor(drawn, 0);
    expect(statusWith(v, null, { kind: 'waiting' })).toEqual({
      main: 'Your turn',
      sub: 'Drawing…',
    });
    expect(statusWith(v, null, { kind: 'shown' })).toEqual({
      main: 'Your turn',
      sub: 'Tap the new card to keep it, or pick a discard',
    });
    // A selection never shows while the ghost card is: the stage wins.
    expect(statusWith(v, 'AS', { kind: 'shown' }).sub).toBe(
      'Tap the new card to keep it, or pick a discard',
    );
    expect(statusWith(v, null, null)).toEqual(statusFor(v, null));
    expect(statusWith(v, 'AS', null)).toEqual(statusFor(v, 'AS'));
    expect(statusWith(viewFor(dealt, 1), null, null)).toEqual(statusFor(viewFor(dealt, 1), null));
  });
});

describe('deadwoodText / selectionIn', () => {
  test('outside a discard the hand deadwood; during one the selected or the best discard', () => {
    const v0 = viewFor(dealt, 0);
    expect(deadwoodText(v0, null)).toBe(`Deadwood: ${String(v0.me.deadwoodValue)}`);
    const v = viewFor(drawn, 0);
    const options = v.discardOptions ?? {};
    const free = Object.entries(options).find(([, o]) => !('locked' in o));
    expect(free).toBeDefined();
    if (free === undefined) return;
    const [id, option] = free;
    expect(deadwoodText(v, id)).toBe(
      `Deadwood after discard: ${String('locked' in option ? '' : option.deadwood)}`,
    );
    const best = Math.min(
      ...Object.values(options).flatMap((o) => ('locked' in o ? [] : [o.deadwood])),
    );
    expect(deadwoodText(v, null)).toBe(`Best possible deadwood: ${String(best)}`);
    // A locked selection (the card just taken from the discard pile) reads as no selection.
    const locked: View = { ...v, discardOptions: { ...options, [id]: { locked: true } } };
    expect(deadwoodText(locked, id)).toBe(`Best possible deadwood: ${String(best)}`);
  });

  test('selectionIn keeps a card of the hand and drops anything else', () => {
    const v = viewFor(drawn, 0);
    const first = v.me.hand[0]?.id ?? '';
    expect(selectionIn(v, first)).toBe(first);
    expect(selectionIn(v, 'ZZ')).toBeNull();
    expect(selectionIn(v, null)).toBeNull();
  });
});

describe('fmtDuration', () => {
  test.each<[number, string]>([
    [0, '0s'],
    [-1, '0s'],
    [999, '0s'],
    [59_000, '59s'],
    [60_000, '1m 0s'],
    [3_599_000, '59m 59s'],
    [3_600_000, '1h 0m'],
    [3_723_000, '1h 2m'],
  ])('%d ms -> %s', (ms, text) => {
    expect(fmtDuration(ms)).toBe(text);
  });
});

describe('nextCue', () => {
  const v0 = viewFor(dealt, 0);
  const v1 = viewFor(dealt, 1);

  test('online: your turn chimes once per turn, not on re-renders, not while discarding', () => {
    const first = nextCue(INITIAL_CUES, v0, 'online');
    expect(first.cue).toBe('yourTurn');
    expect(nextCue(first.state, v0, 'online').cue).toBeNull();
    const theirs = nextCue(first.state, v1, 'online');
    expect(theirs.cue).toBeNull();
    expect(theirs.state.turnKey).toMatch(/:them$/);
    expect(nextCue(theirs.state, viewFor(drawn, 0), 'online').cue).toBeNull();
    // After the opponent's turn, my draw phase chimes again.
    const bothPassed = play(dealt, [
      [0, { type: 'passUpcard' }],
      [1, { type: 'passUpcard' }],
    ]);
    expect(nextCue(theirs.state, viewFor(bothPassed, 0), 'online').cue).toBe('yourTurn');
  });

  test('online: results chime once by ts, for the scorer and the loser; game over by winner', () => {
    const base = viewFor(drawn, 0);
    const scored: View = {
      ...base,
      phase: 'roundOver',
      result: {
        void: false,
        knockerIdx: 0,
        outcome: 'gin',
        knockCard: 'AS',
        knocker: { melds: [], deadwood: [], value: 0 },
        opponent: { melds: [], laidOff: [], deadwood: [], value: 10, extendedMelds: [] },
        scores: [35, 0],
        scorerIdx: 0,
        loserIdx: 1,
        ts: 5,
        totals: [35, 0],
      },
    };
    const mine = nextCue({ key: null, turnKey: '1:discard:0::me' }, scored, 'online');
    expect(mine).toEqual({ state: { key: 'round:5', turnKey: null }, cue: 'gin' });
    expect(nextCue(mine.state, scored, 'online').cue).toBeNull();
    const asLoser: View = { ...scored, me: { ...scored.me, idx: 1 } };
    expect(nextCue(INITIAL_CUES, asLoser, 'online').cue).toBe('bad');
    const knocked: View = {
      ...scored,
      result: { ...scored.result, outcome: 'knock' } as View['result'],
    };
    expect(nextCue(INITIAL_CUES, knocked, 'online').cue).toBe('knockGood');
    const voided: View = { ...scored, result: { void: true, ts: 6, totals: [0, 0] } };
    expect(nextCue(INITIAL_CUES, voided, 'online').cue).toBe('neutral');
    const over: View = { ...base, phase: 'gameOver', winner: 0 };
    expect(nextCue(INITIAL_CUES, over, 'online').cue).toBe('win');
    expect(nextCue(INITIAL_CUES, { ...over, winner: 1 }, 'online').cue).toBe('lose');
    const won = nextCue(INITIAL_CUES, over, 'online');
    expect(nextCue(won.state, over, 'online').cue).toBeNull();
  });

  test('local: no turn chimes; results and game over chime once, positive for both', () => {
    expect(nextCue(INITIAL_CUES, v0, 'local')).toEqual({ state: INITIAL_CUES, cue: null });
    const base = viewFor(drawn, 0);
    const voided: View = {
      ...base,
      phase: 'roundOver',
      result: { void: true, ts: 6, totals: [0, 0] },
    };
    const first = nextCue(INITIAL_CUES, voided, 'local');
    expect(first.cue).toBe('neutral');
    expect(nextCue(first.state, voided, 'local').cue).toBeNull();
    const over: View = { ...base, phase: 'gameOver', winner: 1 };
    expect(nextCue(first.state, over, 'local').cue).toBe('win');
    const noResult: View = { ...base, phase: 'roundOver', result: null };
    expect(nextCue(first.state, noResult, 'local').cue).toBeNull();
  });
});
