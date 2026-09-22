import { describe, expect, test } from 'vitest';

import { formatError } from '../../../../shared/lib/json.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { ACTION_TYPES, decodeAction, decodeCard, decodeState, decodeView, pair } from './decode.ts';
import { applyAction, createGame } from './game.ts';
import type { Action, State } from './types.ts';
import { viewFor } from './view.ts';

const now = (): number => 1_700_000_000_000;
const PLAYERS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
] as const;

/** A state a few moves in: both passed the upcard, the non-dealer drew from the stock. */
const midHand = (): State => {
  const g0 = createGame({ players: PLAYERS, target: 100, dealer: 1 }, mulberry32(3), now);
  const steps: ReadonlyArray<readonly [0 | 1, Action]> = [
    [0, { type: 'passUpcard' }],
    [1, { type: 'passUpcard' }],
    [0, { type: 'drawStock' }],
  ];
  return steps.reduce((g, [seat, a]) => {
    const r = applyAction(g, seat, a, mulberry32(0), now);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }, g0);
};

/** Through JSON, as the wire and localStorage carry it. */
const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const failureOf = (r: { ok: boolean; error?: unknown }): string =>
  r.ok ? 'ok' : formatError(r.error as Parameters<typeof formatError>[0]);

describe('decodeState / decodeView round-trip the engine text', () => {
  test('a fresh game and a mid-hand state, with and without lastDrawn', () => {
    const fresh = createGame({ players: PLAYERS, target: 100, dealer: 0 }, mulberry32(1), now);
    [fresh, midHand()].forEach((state) => {
      const r = decodeState(viaJson(state));
      expect(r.ok).toBe(true);
      expect(r.ok && JSON.stringify(r.value)).toBe(JSON.stringify(state));
      ([0, 1] as const).forEach((seat) => {
        const view = viewFor(state, seat);
        const d = decodeView(viaJson(view));
        expect(d.ok && JSON.stringify(d.value)).toBe(JSON.stringify(view));
      });
    });
    expect('lastDrawn' in fresh).toBe(false);
    expect(midHand().lastDrawn).toEqual({ p: 0, id: expect.any(String) as string });
  });

  test('a state with lastDrawn: null (after undoDraw) keeps the null', () => {
    // Only a draw from the discard pile undoes (docs/design/gin-arrangement-and-discards.md §4).
    const g0 = createGame({ players: PLAYERS, target: 100, dealer: 1 }, mulberry32(3), now);
    const took = applyAction(g0, 0, { type: 'takeUpcard' }, mulberry32(0), now);
    if (!took.ok) throw new Error(took.error);
    const undone = applyAction(took.value, 0, { type: 'undoDraw' }, mulberry32(0), now);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.value.lastDrawn).toBeNull();
    const r = decodeState(viaJson(undone.value));
    expect(r.ok && JSON.stringify(r.value)).toBe(JSON.stringify(undone.value));
  });
});

describe('decodeCard', () => {
  test('accepts the 52 legacy ids and rejects a mismatched id, rank or suit', () => {
    expect(decodeCard({ id: '10H', r: 10, s: 'H' })).toEqual({
      ok: true,
      value: { id: '10H', r: 10, s: 'H' },
    });
    expect(failureOf(decodeCard({ id: 'TH', r: 10, s: 'H' }))).toBe(
      '$: expected a card whose id is its rank label and suit',
    );
    expect(failureOf(decodeCard({ id: '14H', r: 14, s: 'H' }))).toMatch(
      /^\$\.r: expected one of 1/,
    );
    expect(failureOf(decodeCard({ id: 'AX', r: 1, s: 'X' }))).toBe(
      '$.s: expected one of "S" | "H" | "D" | "C"',
    );
    expect(failureOf(decodeCard('AS'))).toBe('$: expected object');
  });
});

describe('pair', () => {
  test('exactly two items become a tuple; anything else is refused', () => {
    const d = pair(decodeCard);
    const as = { id: 'AS', r: 1, s: 'S' };
    expect(d([as, as])).toEqual({ ok: true, value: [as, as] });
    expect(failureOf(d([as]))).toBe('$: expected array of 2');
    expect(failureOf(d([as, as, as]))).toBe('$: expected array of 2');
    expect(failureOf(d([as, 1]))).toBe('$[1]: expected object');
    expect(failureOf(d(null))).toBe('$: expected array');
  });
});

describe('decodeState rejects structural damage with the path named', () => {
  const base = viaJson(midHand()) as Record<string, unknown>;
  const damaged = (patch: Record<string, unknown>): string =>
    failureOf(decodeState({ ...base, ...patch }));

  test.each<[string, Record<string, unknown>, string]>([
    ['phase', { phase: 'shuffling' }, '$.phase: expected one of'],
    ['turn', { turn: 2 }, '$.turn: expected one of 0 | 1'],
    ['target', { target: 0 }, '$.target: expected integer in [1,'],
    ['hands', { hands: [[], [], []] }, '$.hands: expected array of 2'],
    [
      'stock',
      { stock: [{ id: 'AS', r: 1, s: 'S', extra: 1 }, 'KC'] },
      '$.stock[1]: expected object',
    ],
    [
      'pendingDraw.from',
      { pendingDraw: { ...(base['pendingDraw'] as object), from: 'sky' } },
      '$.pendingDraw.from: expected one of "stock" | "discard"',
    ],
    ['lastAction', { lastAction: { text: 'x', by: 3 } }, '$.lastAction.by: expected one of 0 | 1'],
    ['lastAction text', { lastAction: { by: 0 } }, '$.lastAction.text: expected string'],
    ['ready', { ready: [true, 'yes'] }, '$.ready[1]: expected boolean'],
    ['winner', { winner: 'a' }, '$.winner: expected one of 0 | 1'],
    ['lastDrawn', { lastDrawn: { p: 0 } }, '$.lastDrawn.id: expected string'],
    ['meldPref', { meldPref: [[['AS', 1]], null] }, '$.meldPref[0][0][1]: expected string'],
    ['rounds', { rounds: [{ handNumber: 1, ts: 1, void: false }] }, '$.rounds[0]: expected'],
    [
      'players',
      {
        players: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B', total: 0 },
        ],
      },
      '$.players[0].total: expected integer',
    ],
  ])('%s', (_label, patch, expected) => {
    expect(damaged(patch)).toContain(expected);
  });

  test('a missing key is reported as its expected type; a non-object is refused outright', () => {
    const withoutStart = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== 'startedAt'),
    );
    expect(failureOf(decodeState(withoutStart))).toBe(
      '$.startedAt: expected integer in [0, 9007199254740991]',
    );
    expect(failureOf(decodeState([]))).toBe('$: expected object');
    expect(failureOf(decodeState(null))).toBe('$: expected object');
  });
});

describe('decodeView rejects structural damage', () => {
  const state = midHand();
  const base = viaJson(viewFor(state, 0)) as Record<string, unknown>;
  const damaged = (patch: Record<string, unknown>): string =>
    failureOf(decodeView({ ...base, ...patch }));

  test('discardOptions: a prototype key is refused, a malformed option named', () => {
    expect(base['discardOptions']).not.toBeNull();
    expect(damaged({ discardOptions: JSON.parse('{"__proto__": {"locked": true}}') })).toBe(
      '$.discardOptions.__proto__: expected a key that is not a prototype member',
    );
    expect(damaged({ discardOptions: { AS: { locked: false } } })).toBe(
      '$.discardOptions.AS: expected one of true or integer in [0, 9007199254740991]',
    );
    expect(damaged({ discardOptions: { AS: { deadwood: 3, canKnock: true } } })).toContain(
      '$.discardOptions.AS: expected',
    );
  });

  test('meldOptions need a sig; melds need three cards; knockLimit a count', () => {
    expect(damaged({ meldOptions: [{ melds: [], deadwood: [], value: 0 }] })).toBe(
      '$.meldOptions[0].sig: expected string',
    );
    const as = { id: 'AS', r: 1, s: 'S' };
    expect(damaged({ me: { ...(base['me'] as object), melds: [[as, as]] } })).toBe(
      '$.me.melds[0]: expected a meld of three or more cards',
    );
    expect(damaged({ knockLimit: -1 })).toBe(
      '$.knockLimit: expected integer in [0, 9007199254740991]',
    );
  });

  test('extra keys are dropped, so the output has exactly the view keys', () => {
    const r = decodeView({ ...base, extra: 1, __proto__: { polluted: true } });
    expect(r.ok && Object.keys(r.value)).toEqual(Object.keys(base));
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('decodeAction', () => {
  test('every plain type, the two card types and setMelds, in the legacy key order', () => {
    ACTION_TYPES.forEach((type) => {
      const input =
        type === 'discard' || type === 'knock'
          ? { type, cardId: 'AS' }
          : type === 'setMelds'
            ? { type, melds: [['AS', 'AH', 'AD']] }
            : { type };
      const r = decodeAction({ ...input, extra: true });
      expect(r.ok && JSON.stringify(r.value)).toBe(JSON.stringify(input));
    });
  });

  test('refuses an unknown type, a card action without its card, setMelds without melds', () => {
    expect(failureOf(decodeAction({ type: 'cheat' }))).toBe(
      '$.type: expected one of "ready" | "takeUpcard" | "passUpcard" | "drawStock" | "drawDiscard" | "undoDraw" | "discard" | "knock" | "setMelds"',
    );
    expect(failureOf(decodeAction({ type: 'discard' }))).toBe('$.cardId: expected string');
    expect(failureOf(decodeAction({ type: 'knock', cardId: 7 }))).toBe('$.cardId: expected string');
    expect(failureOf(decodeAction({ type: 'setMelds' }))).toBe('$.melds: expected array');
    expect(failureOf(decodeAction({ type: 'setMelds', melds: [['AS', null]] }))).toBe(
      '$.melds[0][1]: expected string',
    );
    expect(failureOf(decodeAction('ready'))).toBe('$: expected object');
    expect(failureOf(decodeAction({}))).toContain('$.type: expected one of');
  });
});
