// The wire codecs and their goldens (docs/design/briscola.md §5.8 `frames`, §6 PR-4): no legacy
// corpus exists for this game, so this test is the recorder. Every frame below is built from a
// seeded engine with the clock pinned; one JSON file per tag under test/fixtures/briscola-wire/
// holds what the builders emitted, and the test asserts the files still equal the builders'
// output (values and key order, whitespace aside), that every recorded frame decodes back to
// itself and re-encodes byte for byte (E20), and that a `state` frame stays under the size cap even
// at the end of a match with the event stream at its longest. The web project has no node types,
// so the files are read through the repo's `?raw` imports (web/raw-imports.d.ts) and written by
// vitest's file snapshots. To re-record after a deliberate wire change (a new tag first needs an
// empty `[]` file, since a `?raw` import must resolve):
// `BRISCOLA_WIRE_RECORD=1 node node_modules/vitest/vitest.mjs run web/games/briscola/src/protocol.test.ts -u`
// then `node node_modules/prettier/bin/prettier.cjs --write test/fixtures/briscola-wire`, and say
// why in the PR. The comparison reads values and key order, so prettier's layout is fine.
import { describe, expect, test } from 'vitest';

import actionJson from '../../../../test/fixtures/briscola-wire/action.json?raw';
import fullJson from '../../../../test/fixtures/briscola-wire/full.json?raw';
import joinJson from '../../../../test/fixtures/briscola-wire/join.json?raw';
import lobbyJson from '../../../../test/fixtures/briscola-wire/lobby.json?raw';
import stateJson from '../../../../test/fixtures/briscola-wire/state.json?raw';
import toastJson from '../../../../test/fixtures/briscola-wire/toast.json?raw';
import welcomeJson from '../../../../test/fixtures/briscola-wire/welcome.json?raw';

import { mulberry32 } from '../../../shared/lib/rng.ts';
import {
  actorOf,
  applyAction,
  createGame,
  legalActions,
  viewFor,
  type Action,
  type CreateGameOptions,
  type State,
  type View,
} from './engine/index.ts';
import {
  DEFAULT_GUEST_NAME,
  NAME_MAX,
  TOAST_MAX,
  WIRE_TAGS,
  action,
  decodeFrame,
  decodeGuestFrame,
  decodeHostFrame,
  full,
  guestNameFor,
  isGuestFrame,
  join,
  lobby,
  state,
  toast,
  welcome,
  type Frame,
  type Room,
  type WireTag,
} from './protocol.ts';

/** The committed goldens, one file per tag. */
const GOLDEN_TEXT: Readonly<Record<WireTag, string>> = {
  join: joinJson,
  action: actionJson,
  welcome: welcomeJson,
  lobby: lobbyJson,
  full: fullJson,
  toast: toastJson,
  state: stateJson,
};
/** Relative to this file, as `toMatchFileSnapshot` takes it. */
const goldenPath = (tag: WireTag): string => `../../../../test/fixtures/briscola-wire/${tag}.json`;
/** `BRISCOLA_WIRE_RECORD=1`: read off the global, since the web project has no `process` type. */
const RECORD =
  (
    globalThis as Readonly<{
      process?: Readonly<{ env: Readonly<Record<string, string | undefined>> }>;
    }>
  ).process?.env['BRISCOLA_WIRE_RECORD'] === '1';
/** A `state` frame at the end of a match (the event stream at its longest) stays under this. */
const STATE_FRAME_LIMIT = 100 * 1024;
/** More than any match of one game needs; a fixed range stands in for a loop (raw loops are banned). */
const STEP_CAP = 400;

const PLAYERS = [
  { id: 'host', name: 'Ann' },
  { id: 'guest', name: 'Jeff' },
] as const;
const NOW = (): number => 1_700_000_000_000;

const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// ---- the seeded positions the state goldens are cut from ----------------------------------------

const newGame = (seed: number, opts: CreateGameOptions): State =>
  createGame(PLAYERS, opts, mulberry32(seed), NOW);

/** The first legal action of whoever may act: a card, or the next game. */
const firstAction = (s: State): Action | null =>
  legalActions(viewFor(s, actorOf(s) ?? 0))[0] ?? null;

const apply = (s: State, a: Action): State => {
  const r = applyAction(s, actorOf(s) ?? 0, a, mulberry32(9), NOW);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.value;
};

/** Play first-legal-action until `stop` holds or the match is over. */
const playUntil = (start: State, stop: (s: State) => boolean): State =>
  Array.from({ length: STEP_CAP }).reduce<State>((s, _, i) => {
    if (stop(s) || i > STEP_CAP) return s;
    const a = firstAction(s);
    return a === null ? s : apply(s, a);
  }, start);

/** The first seed whose deal has the guest (seat 1) lead, so the guest's view carries legal cards. */
const guestLeadsSeed =
  Array.from({ length: 50 }, (_, i) => i + 1).find(
    (seed) => newGame(seed, { gamesToWin: 2 }).turn === 1,
  ) ?? 1;
const dealt = newGame(guestLeadsSeed, { gamesToWin: 2 });
/** The guest led; the host is to answer. */
const oneLaid = apply(dealt, firstAction(dealt) ?? { type: 'next' });
/** One trick resolved: `lastTrick` and the trick event are on the wire. */
const oneTrick = playUntil(dealt, (s) => s.trickNo === 1);
/** The stock out: the last three tricks. */
const stockOut = playUntil(dealt, (s) => s.stock.length === 0);
/** Game one over, the match on (best of three). */
const gameOver = playUntil(dealt, (s) => s.phase === 'over');
/** A match of one game over: the end screen's frame. */
const matchOver = playUntil(
  newGame(3, { gamesToWin: 1, exchange: true }),
  (s) => s.phase === 'over',
);

/** The guest's view (`viewFor(game, 1)`), as the host sends it. */
const guestView = (s: State): View => viewFor(s, 1);

const ROOM: Room = {
  seatCount: 2,
  gamesToWin: 2,
  removedTwo: 'C',
  exchange: false,
  scoperta: false,
  partnerPeek: false,
};
const HOUSE: Room = { ...ROOM, gamesToWin: 3, exchange: true, scoperta: true };

// ---- the goldens: one file per tag, what the builders emit -----------------------------------

const GOLDENS: Readonly<Record<WireTag, ReadonlyArray<Frame>>> = {
  join: [join('Jeff'), join('')],
  action: [
    action({ type: 'play', cardId: 'AC' }),
    action({ type: 'play', cardId: 'RB' }),
    action({ type: 'exchange' }),
    action({ type: 'next' }),
  ],
  welcome: [welcome('Ann', ROOM), welcome('Ann', HOUSE)],
  lobby: [lobby('Ann', ROOM), lobby('Ann', { ...ROOM, seatCount: 3, removedTwo: 'D' })],
  full: [full()],
  toast: [toast('It is not your turn'), toast('That card is not in your hand')],
  // The deal with the guest to lead; one card laid; a trick resolved; the stock out; a game over
  // with the match on; the match over.
  state: [
    state(guestView(dealt)),
    state(guestView(oneLaid)),
    state(guestView(oneTrick)),
    state(guestView(stockOut)),
    state(guestView(gameOver)),
    state(guestView(matchOver)),
  ],
};

describe.runIf(RECORD)('recording the goldens (BRISCOLA_WIRE_RECORD=1, with -u)', () => {
  test.each(WIRE_TAGS)('%s.json', async (tag) => {
    await expect(`${JSON.stringify(GOLDENS[tag], null, 2)}\n`).toMatchFileSnapshot(goldenPath(tag));
  });
});

describe('frozen constants', () => {
  test("the seven tags, the name cap and the default guest name are gin's literals", () => {
    expect(WIRE_TAGS).toEqual(['join', 'action', 'welcome', 'lobby', 'full', 'toast', 'state']);
    expect(NAME_MAX).toBe(20);
    expect(DEFAULT_GUEST_NAME).toBe('Jeff');
    expect(TOAST_MAX).toBe(500);
  });
});

describe('the positions the state goldens are cut from', () => {
  test('cover what a guest sees: its lead, a laid card, a settled trick, the last tricks, a game and a match over', () => {
    expect(dealt.turn).toBe(1);
    expect(guestView(dealt).isMyTurn).toBe(true);
    expect(guestView(dealt).legal).toHaveLength(3);
    expect(guestView(dealt).stockCount).toBe(34);
    expect(oneLaid.trick).toHaveLength(1);
    expect(guestView(oneLaid).isMyTurn).toBe(false);
    expect(oneTrick.lastTrick?.no).toBe(1);
    expect(oneTrick.events.map((e) => e.kind)).toEqual(['deal', 'trick']);
    expect(stockOut.stock).toHaveLength(0);
    expect(guestView(stockOut).trumpOnTable).toBe(false);
    expect(gameOver.phase).toBe('over');
    expect(guestView(gameOver).matchOver).toBe(false);
    expect(guestView(gameOver).result).not.toBeNull();
    expect(matchOver.phase).toBe('over');
    expect(guestView(matchOver).matchOver).toBe(true);
    expect(matchOver.options.exchange).toBe(true);
  });
});

describe('builders produce the golden literals, key for key', () => {
  test.each<[string, unknown, string]>([
    ['join', join('Jeff'), '{"t":"join","name":"Jeff"}'],
    [
      'play',
      action({ type: 'play', cardId: 'AC' }),
      '{"t":"action","action":{"type":"play","cardId":"AC"}}',
    ],
    ['exchange', action({ type: 'exchange' }), '{"t":"action","action":{"type":"exchange"}}'],
    ['next', action({ type: 'next' }), '{"t":"action","action":{"type":"next"}}'],
    [
      'welcome',
      welcome('Ann', ROOM),
      '{"t":"welcome","hostName":"Ann","seatCount":2,"gamesToWin":2,"removedTwo":"C","exchange":false,"scoperta":false,"partnerPeek":false}',
    ],
    [
      'lobby',
      lobby('Ann', HOUSE),
      '{"t":"lobby","hostName":"Ann","seatCount":2,"gamesToWin":3,"removedTwo":"C","exchange":true,"scoperta":true,"partnerPeek":false}',
    ],
    ['full', full(), '{"t":"full"}'],
    ['toast', toast('It is not your turn'), '{"t":"toast","msg":"It is not your turn"}'],
  ])('%s', (_tag, frame, json) => {
    expect(JSON.stringify(frame)).toBe(json);
  });

  test('state carries the view as is', () => {
    const view = guestView(dealt);
    expect(JSON.stringify(state(view))).toBe(JSON.stringify({ t: 'state', view }));
  });
});

describe('the wire goldens under test/fixtures/briscola-wire', () => {
  test.each(WIRE_TAGS)('%s.json is what the builders emit (values and key order)', (tag) => {
    const onDisk = JSON.parse(GOLDEN_TEXT[tag]) as unknown;
    expect(onDisk).toEqual(GOLDENS[tag]);
    expect(JSON.stringify(onDisk), 'key order').toBe(JSON.stringify(GOLDENS[tag]));
  });

  test.each(WIRE_TAGS)('every %s frame decodes to itself and re-encodes byte for byte', (tag) => {
    const frames = JSON.parse(GOLDEN_TEXT[tag]) as ReadonlyArray<unknown>;
    expect(frames.length).toBeGreaterThan(0);
    frames.forEach((raw) => {
      const r = decodeFrame(raw);
      expect(r).toEqual({ ok: true, value: raw });
      expect(r.ok && JSON.stringify(r.value)).toBe(JSON.stringify(raw));
      const side = r.ok && isGuestFrame(r.value) ? decodeGuestFrame(raw) : decodeHostFrame(raw);
      expect(side).toEqual({ ok: true, value: raw });
    });
  });

  test('a state frame at the end of a match, its event stream whole, stays under the size cap', () => {
    const sizes = GOLDENS.state.map((f) => JSON.stringify(f).length);
    sizes.forEach((n) => {
      expect(n).toBeLessThan(STATE_FRAME_LIMIT);
    });
    expect(guestView(matchOver).events.length).toBeGreaterThan(20);
  });
});

describe('decodeFrame', () => {
  test('every builder output decodes back to an equal frame with the same JSON text', () => {
    WIRE_TAGS.flatMap((tag) => GOLDENS[tag]).forEach((frame) => {
      const r = decodeFrame(viaJson(frame));
      expect(r).toEqual({ ok: true, value: frame });
      expect(r.ok && JSON.stringify(r.value)).toBe(JSON.stringify(frame));
    });
  });

  test('refuses an unknown or missing tag and non-objects, naming the seven tags', () => {
    const expected =
      '$.t: expected one of "join" | "action" | "welcome" | "lobby" | "full" | "toast" | "state"';
    expect(decodeFrame({ t: 'hello' })).toEqual({ ok: false, error: expected });
    expect(decodeFrame({})).toEqual({ ok: false, error: expected });
    expect(decodeFrame(null)).toEqual({ ok: false, error: '$: expected object' });
    expect(decodeFrame([{ t: 'full' }])).toEqual({ ok: false, error: '$: expected object' });
  });

  test.each<[string, unknown, string]>([
    ['join without a name', { t: 'join' }, '$.name: expected string'],
    [
      'join with an oversized name',
      { t: 'join', name: 'x'.repeat(NAME_MAX + 1) },
      `$.name: expected a name of at most ${String(NAME_MAX)} characters`,
    ],
    [
      'welcome without a seat count',
      { t: 'welcome', hostName: 'Ann', ...ROOM, seatCount: undefined },
      '$.seatCount: expected one of 2 | 3 | 4',
    ],
    [
      'welcome with five seats',
      { t: 'welcome', hostName: 'Ann', ...ROOM, seatCount: 5 },
      '$.seatCount: expected one of 2 | 3 | 4',
    ],
    [
      'welcome with a target',
      { t: 'welcome', hostName: 'Ann', ...ROOM, gamesToWin: 4 },
      '$.gamesToWin: expected one of 1 | 2 | 3',
    ],
    [
      'welcome with a suit name',
      { t: 'welcome', hostName: 'Ann', ...ROOM, removedTwo: 'coppe' },
      '$.removedTwo: expected one of "C" | "D" | "S" | "B"',
    ],
    [
      'welcome with a string switch',
      { t: 'welcome', hostName: 'Ann', ...ROOM, exchange: 'on' },
      '$.exchange: expected one of false | true | "leader"',
    ],
    [
      "welcome with backgammon's room",
      { t: 'welcome', hostName: 'Ann', matchLength: 5, variant: 'portes' },
      '$.seatCount: expected one of 2 | 3 | 4',
    ],
    [
      'lobby without the peek',
      { t: 'lobby', hostName: 'Ann', ...ROOM, partnerPeek: undefined },
      '$.partnerPeek: expected boolean',
    ],
    [
      'lobby with an oversized host name',
      { t: 'lobby', hostName: 'y'.repeat(21), ...ROOM },
      '$.hostName: expected a name of at most 20 characters',
    ],
    ['toast without a message', { t: 'toast' }, '$.msg: expected string'],
    [
      'toast with a huge message',
      { t: 'toast', msg: 'z'.repeat(TOAST_MAX + 1) },
      `$.msg: expected a message of at most ${String(TOAST_MAX)} characters`,
    ],
    ['state without a view', { t: 'state' }, '$.view: expected object'],
    [
      'state with a damaged view',
      { t: 'state', view: { ...(viaJson(guestView(dealt)) as object), phase: 'x' } },
      '$.view.phase: expected one of "deal" | "trick" | "draw" | "over"',
    ],
    ['action without an action', { t: 'action' }, '$.action: expected object'],
    [
      'action of an unknown type',
      { t: 'action', action: { type: 'undo' } },
      '$.action.type: expected one of "play" | "exchange" | "next"',
    ],
    [
      'play without a card',
      { t: 'action', action: { type: 'play' } },
      '$.action.cardId: expected string',
    ],
    [
      'play of a card outside the deck',
      { t: 'action', action: { type: 'play', cardId: '1D' } },
      '$.action.cardId: expected a card id (its label and suit, AC..RB)',
    ],
  ])('%s', (_label, input, error) => {
    expect(decodeFrame(input)).toEqual({ ok: false, error });
  });

  test('extra and prototype keys are dropped; a plain action carries no other keys', () => {
    const hostile = JSON.parse(
      '{"t":"join","name":"Jeff","__proto__":{"polluted":true},"constructor":1,"extra":2}',
    ) as unknown;
    expect(decodeFrame(hostile)).toEqual({ ok: true, value: { t: 'join', name: 'Jeff' } });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(decodeFrame({ t: 'full', view: 1 })).toEqual({ ok: true, value: { t: 'full' } });
    expect(decodeFrame({ t: 'action', action: { type: 'next', cardId: 'AC' } })).toEqual({
      ok: true,
      value: { t: 'action', action: { type: 'next' } },
    });
  });
});

describe('decodeGuestFrame / decodeHostFrame keep each side to its own frames', () => {
  test('the host accepts join and action and refuses the five host frames; the guest the reverse', () => {
    expect(decodeGuestFrame({ t: 'action', action: { type: 'play', cardId: 'AC' } }).ok).toBe(true);
    expect(decodeGuestFrame({ t: 'full' })).toEqual({
      ok: false,
      error: '$.t: expected a guest frame (one of "join" | "action"), got "full"',
    });
    [
      welcome('Ann', ROOM),
      lobby('Ann', HOUSE),
      full(),
      toast('t'),
      state(guestView(oneLaid)),
    ].forEach((frame) => {
      expect(decodeHostFrame(viaJson(frame))).toEqual({ ok: true, value: frame });
    });
    expect(decodeHostFrame({ t: 'join', name: 'Jeff' })).toEqual({
      ok: false,
      error:
        '$.t: expected a host frame (one of "welcome" | "lobby" | "full" | "toast" | "state"), got "join"',
    });
  });

  test('isGuestFrame routes a send: join and action to the host, the rest to the guest', () => {
    expect(WIRE_TAGS.map((tag) => GOLDENS[tag].map(isGuestFrame))).toEqual([
      [true, true],
      [true, true, true, true],
      [false, false],
      [false, false],
      [false],
      [false, false],
      Array.from({ length: 6 }, () => false),
    ]);
  });
});

describe('guestNameFor', () => {
  test("cuts to 20, trims, defaults to Jeff and suffixes a clash with the host, as gin's host does", () => {
    expect(guestNameFor('Jeff', 'Ann')).toBe('Jeff');
    expect(guestNameFor('', 'Ann')).toBe('Jeff');
    expect(guestNameFor('ann', 'Ann')).toBe('ann 2');
    expect(guestNameFor('abcdefghijklmnopqrstuvwxyz', 'Ann')).toBe('abcdefghijklmnopqrst');
  });
});
