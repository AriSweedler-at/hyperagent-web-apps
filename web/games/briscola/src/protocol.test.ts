// The wire codecs and their goldens (docs/design/briscola.md §5.8 `frames`, §6 PR-4): no legacy
// corpus exists for this game, so this test is the recorder. Every frame below is built from a
// seeded engine with the clock pinned; one JSON file per tag under test/fixtures/briscola-wire/
// holds what the builders emitted, and the test asserts the files still equal the builders'
// output (values and key order, whitespace aside), that every recorded frame decodes back to
// itself and re-encodes byte for byte (E20), and that a `state` frame stays under the size cap even
// at the end of a match with the event stream at its longest. The two-seat corpus is PR-4's, byte
// for byte (its three-seat lobby predates the table on the wire and is held as a literal); the
// 3p-*/4p-* files are the N-seat shapes (docs/design/n-seat-sessions.md §7): the welcome and lobby
// with the table and the receiver's seat, one state per guest seat, and the first trick's action
// frames, one per seat in turn order. The web project has no node types,
// so the files are read through the repo's `?raw` imports (web/raw-imports.d.ts) and written by
// vitest's file snapshots. To re-record after a deliberate wire change (a new tag first needs an
// empty `[]` file, since a `?raw` import must resolve):
// `BRISCOLA_WIRE_RECORD=1 node node_modules/vitest/vitest.mjs run web/games/briscola/src/protocol.test.ts -u`
// then `node node_modules/prettier/bin/prettier.cjs --write test/fixtures/briscola-wire`, and say
// why in the PR. The comparison reads values and key order, so prettier's layout is fine.
import { describe, expect, test } from 'vitest';

import action3Json from '../../../../test/fixtures/briscola-wire/3p-action.json?raw';
import lobby3Json from '../../../../test/fixtures/briscola-wire/3p-lobby.json?raw';
import state3Json from '../../../../test/fixtures/briscola-wire/3p-state.json?raw';
import welcome3Json from '../../../../test/fixtures/briscola-wire/3p-welcome.json?raw';
import action4Json from '../../../../test/fixtures/briscola-wire/4p-action.json?raw';
import lobby4Json from '../../../../test/fixtures/briscola-wire/4p-lobby.json?raw';
import state4Json from '../../../../test/fixtures/briscola-wire/4p-state.json?raw';
import welcome4Json from '../../../../test/fixtures/briscola-wire/4p-welcome.json?raw';
import actionJson from '../../../../test/fixtures/briscola-wire/action.json?raw';
import fullJson from '../../../../test/fixtures/briscola-wire/full.json?raw';
import intentJson from '../../../../test/fixtures/briscola-wire/intent.json?raw';
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
  type Players,
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
  intent,
  isEphemeral,
  isGuestFrame,
  join,
  joinName,
  lobby,
  seatingOf,
  state,
  toast,
  welcome,
  type ActionFrame,
  type Frame,
  type IntentFrame,
  type LobbyFrame,
  type Room,
  type TableSeat,
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
/** The N-seat goldens, one file per shape and seat count. */
type TableStem =
  | '3p-welcome'
  | '3p-lobby'
  | '3p-state'
  | '3p-action'
  | '4p-welcome'
  | '4p-lobby'
  | '4p-state'
  | '4p-action';
const TABLE_STEMS: ReadonlyArray<TableStem> = [
  '3p-welcome',
  '3p-lobby',
  '3p-state',
  '3p-action',
  '4p-welcome',
  '4p-lobby',
  '4p-state',
  '4p-action',
];
const TABLE_TEXT: Readonly<Record<TableStem, string>> = {
  '3p-welcome': welcome3Json,
  '3p-lobby': lobby3Json,
  '3p-state': state3Json,
  '3p-action': action3Json,
  '4p-welcome': welcome4Json,
  '4p-lobby': lobby4Json,
  '4p-state': state4Json,
  '4p-action': action4Json,
};
/** Relative to this file, as `toMatchFileSnapshot` takes it. */
const goldenPath = (stem: WireTag | TableStem): string =>
  `../../../../test/fixtures/briscola-wire/${stem}.json`;
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
/** A guest seat nobody has taken, and one a named guest holds (its channel up unless said otherwise). */
const EMPTY: TableSeat = { name: null, connected: false };
const seat = (name: string, connected = true): TableSeat => ({ name, connected });
/**
 * lobby.json's second frame: a three-seat lobby as PR-4 recorded it, before the table was on the
 * wire. The builders now put the table on a three-seat frame, so this one is held as the literal
 * the corpus carries, which the decoder still takes (the corpus is not rewritten).
 */
const PRE_TABLE_LOBBY: LobbyFrame = {
  t: 'lobby',
  hostName: 'Ann',
  ...ROOM,
  seatCount: 3,
  removedTwo: 'D',
};

// ---- the goldens: one file per tag, what the builders emit -----------------------------------

const GOLDENS: Readonly<Record<WireTag, ReadonlyArray<Frame>>> = {
  join: [join('Jeff'), join('')],
  action: [
    action({ type: 'play', cardId: 'AC' }),
    action({ type: 'play', cardId: 'RB' }),
    action({ type: 'exchange' }),
    action({ type: 'next' }),
  ],
  // At two seats the table and `you` are left off the wire, whatever is passed (`seated`).
  welcome: [welcome('Ann', ROOM, [EMPTY], 1), welcome('Ann', HOUSE, [EMPTY], 1)],
  lobby: [lobby('Ann', ROOM, [seat('Jeff')], 1), PRE_TABLE_LOBBY],
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

/** The lane's golden (docs/design/briscola-battle.md §4.1): a hover, a lift, a clear, a fourth seat's hover. */
const INTENT_GOLDENS: ReadonlyArray<IntentFrame> = [
  intent(0, 1, 'hover'),
  intent(1, 2, 'raised'),
  intent(1, null, 'hover'),
  intent(3, 0, 'hover'),
];
const INTENT_PATH = '../../../../test/fixtures/briscola-wire/intent.json';

describe.runIf(RECORD)('recording the goldens (BRISCOLA_WIRE_RECORD=1, with -u)', () => {
  test.each(WIRE_TAGS)('%s.json', async (tag) => {
    await expect(`${JSON.stringify(GOLDENS[tag], null, 2)}\n`).toMatchFileSnapshot(goldenPath(tag));
  });
  test('intent.json', async () => {
    await expect(`${JSON.stringify(INTENT_GOLDENS, null, 2)}\n`).toMatchFileSnapshot(INTENT_PATH);
  });
});

describe('the intent frame (docs/design/briscola-battle.md §4.1): the lane`s golden and its refusals', () => {
  test('intent.json is what the builder emits, key for key, and every frame re-encodes byte for byte on both sides', () => {
    const onDisk = JSON.parse(intentJson) as ReadonlyArray<unknown>;
    expect(onDisk).toEqual(INTENT_GOLDENS);
    expect(JSON.stringify(onDisk), 'key order').toBe(JSON.stringify(INTENT_GOLDENS));
    expect(JSON.stringify(intent(0, 1, 'hover'))).toBe(
      '{"t":"intent","seat":0,"slot":1,"mode":"hover"}',
    );
    onDisk.forEach((raw) => {
      expect(decodeFrame(raw)).toEqual({ ok: true, value: raw });
      expect(decodeGuestFrame(raw)).toEqual({ ok: true, value: raw });
      expect(decodeHostFrame(raw)).toEqual({ ok: true, value: raw });
    });
  });

  test('a card id, a fourth slot, a fifth seat or a stranger mode is refused by its path; the seven tags still name the seven and the lane', () => {
    expect(decodeFrame({ t: 'intent', seat: 0, slot: 'AC', mode: 'hover' })).toEqual({
      ok: false,
      error: '$.slot: expected one of 0 | 1 | 2',
    });
    expect(decodeFrame({ t: 'intent', seat: 0, slot: 3, mode: 'hover' })).toEqual({
      ok: false,
      error: '$.slot: expected one of 0 | 1 | 2',
    });
    expect(decodeFrame({ t: 'intent', seat: 4, slot: 0, mode: 'hover' })).toEqual({
      ok: false,
      error: '$.seat: expected one of 0 | 1 | 2 | 3',
    });
    expect(decodeFrame({ t: 'intent', seat: 0, slot: 0, mode: 'pushed' })).toEqual({
      ok: false,
      error: '$.mode: expected one of "hover" | "raised"',
    });
    expect(decodeFrame({ t: 'nope' })).toEqual({
      ok: false,
      error:
        '$.t: expected one of "join" | "action" | "welcome" | "lobby" | "full" | "toast" | "state" | "intent"',
    });
  });

  test('isEphemeral claims the lane`s frame alone and isGuestFrame never does', () => {
    expect(INTENT_GOLDENS.map(isEphemeral)).toEqual([true, true, true, true]);
    expect(INTENT_GOLDENS.map(isGuestFrame)).toEqual([false, false, false, false]);
    expect(WIRE_TAGS.flatMap((tag) => GOLDENS[tag].map(isEphemeral)).some(Boolean)).toBe(false);
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
      welcome('Ann', ROOM, [EMPTY], 1),
      '{"t":"welcome","hostName":"Ann","seatCount":2,"gamesToWin":2,"removedTwo":"C","exchange":false,"scoperta":false,"partnerPeek":false}',
    ],
    [
      'lobby',
      lobby('Ann', HOUSE, [seat('Jeff')], 1),
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
  test.each(WIRE_TAGS)(
    "%s.json is what the builders emit (values and key order; lobby.json keeps PR-4's pre-table three-seat frame)",
    (tag) => {
      const onDisk = JSON.parse(GOLDEN_TEXT[tag]) as unknown;
      expect(onDisk).toEqual(GOLDENS[tag]);
      expect(JSON.stringify(onDisk), 'key order').toBe(JSON.stringify(GOLDENS[tag]));
    },
  );

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
      '$.t: expected one of "join" | "action" | "welcome" | "lobby" | "full" | "toast" | "state" | "intent"';
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
      welcome('Ann', ROOM, [EMPTY], 1),
      lobby('Ann', HOUSE, [seat('Jeff')], 1),
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

// ---- three and four seats: the table on the wire ----------------------------------------------

const THREE: Players = [
  { id: 'host', name: 'Ann' },
  { id: 'g1', name: 'Bo' },
  { id: 'g2', name: 'Cal' },
];
const FOUR: Players = [...THREE, { id: 'g3', name: 'Dee' }];
/** What `createGame` normalises the two tables' options to (asserted below). */
const ROOM3: Room = { ...ROOM, seatCount: 3, gamesToWin: 1, removedTwo: 'D' };
const ROOM4: Room = { ...ROOM, seatCount: 4, gamesToWin: 1, exchange: true };
const dealt3 = createGame(THREE, { gamesToWin: 1, removedTwo: 'D' }, mulberry32(5), NOW);
const dealt4 = createGame(FOUR, { gamesToWin: 1, exchange: true }, mulberry32(7), NOW);
const oneTrick3 = playUntil(dealt3, (s) => s.trickNo === 1);
const oneTrick4 = playUntil(dealt4, (s) => s.trickNo === 1);

/** The first trick's plays in turn order, one action frame per seat: what each seat sends the host. */
const firstTrick = (start: State): ReadonlyArray<ActionFrame> =>
  Array.from({ length: start.options.seatCount }).reduce<
    Readonly<{ s: State; frames: ReadonlyArray<ActionFrame> }>
  >(
    ({ s, frames }) => {
      const a = firstAction(s) ?? { type: 'next' };
      return { s: apply(s, a), frames: [...frames, action(a)] };
    },
    { s: start, frames: [] },
  ).frames;

const TABLE_GOLDENS: Readonly<Record<TableStem, ReadonlyArray<Frame>>> = {
  // The first guest's welcome (the table empty, seat 1); the second's, with Bo seated (seat 2).
  '3p-welcome': [
    welcome('Ann', ROOM3, [EMPTY, EMPTY], 1),
    welcome('Ann', ROOM3, [seat('Bo'), EMPTY], 2),
  ],
  // The full table to each seat with its own `you`; Cal's channel down.
  '3p-lobby': [
    lobby('Ann', ROOM3, [seat('Bo'), seat('Cal')], 1),
    lobby('Ann', ROOM3, [seat('Bo'), seat('Cal')], 2),
    lobby('Ann', ROOM3, [seat('Bo'), seat('Cal', false)], 1),
  ],
  // The deal to each guest seat (`viewFor(game, s)`), and a settled trick to seat 2.
  '3p-state': [state(viewFor(dealt3, 1)), state(viewFor(dealt3, 2)), state(viewFor(oneTrick3, 2))],
  '3p-action': firstTrick(dealt3),
  '4p-welcome': [
    welcome('Ann', ROOM4, [EMPTY, EMPTY, EMPTY], 1),
    welcome('Ann', ROOM4, [seat('Bo'), seat('Cal'), EMPTY], 3),
  ],
  '4p-lobby': [1, 2, 3].map((you) =>
    lobby('Ann', ROOM4, [seat('Bo'), seat('Cal'), seat('Dee')], you),
  ),
  '4p-state': [
    state(viewFor(dealt4, 1)),
    state(viewFor(dealt4, 2)),
    state(viewFor(dealt4, 3)),
    state(viewFor(oneTrick4, 3)),
  ],
  '4p-action': firstTrick(dealt4),
};

describe.runIf(RECORD)('recording the N-seat goldens (BRISCOLA_WIRE_RECORD=1, with -u)', () => {
  test.each(TABLE_STEMS)('%s.json', async (stem) => {
    await expect(`${JSON.stringify(TABLE_GOLDENS[stem], null, 2)}\n`).toMatchFileSnapshot(
      goldenPath(stem),
    );
  });
});

describe('the positions the N-seat goldens are cut from', () => {
  test("the tables are dealt on the options the rooms spell; each state is its seat's view; the first trick is one play per seat", () => {
    expect(dealt3.options).toEqual(ROOM3);
    expect(dealt4.options).toEqual(ROOM4);
    expect(oneTrick3.trickNo).toBe(1);
    expect(oneTrick4.trickNo).toBe(1);
    const seatsOf = (frames: ReadonlyArray<Frame>): ReadonlyArray<number | null> =>
      frames.map((f) => (f.t === 'state' ? f.view.me.idx : null));
    expect(seatsOf(TABLE_GOLDENS['3p-state'])).toEqual([1, 2, 2]);
    expect(seatsOf(TABLE_GOLDENS['4p-state'])).toEqual([1, 2, 3, 3]);
    const cards = (frames: ReadonlyArray<Frame>): ReadonlyArray<string | null> =>
      frames.map((f) => (f.t === 'action' && f.action.type === 'play' ? f.action.cardId : null));
    expect(new Set(cards(TABLE_GOLDENS['3p-action'])).size).toBe(3);
    expect(new Set(cards(TABLE_GOLDENS['4p-action'])).size).toBe(4);
    expect(cards(TABLE_GOLDENS['4p-action'])).not.toContain(null);
  });
});

describe('the N-seat goldens under test/fixtures/briscola-wire', () => {
  test.each(TABLE_STEMS)('%s.json is what the builders emit (values and key order)', (stem) => {
    const onDisk = JSON.parse(TABLE_TEXT[stem]) as unknown;
    expect(onDisk).toEqual(TABLE_GOLDENS[stem]);
    expect(JSON.stringify(onDisk), 'key order').toBe(JSON.stringify(TABLE_GOLDENS[stem]));
  });

  test.each(TABLE_STEMS)(
    'every %s frame decodes to itself and re-encodes byte for byte',
    (stem) => {
      const frames = JSON.parse(TABLE_TEXT[stem]) as ReadonlyArray<unknown>;
      expect(frames.length).toBeGreaterThan(0);
      frames.forEach((raw) => {
        const r = decodeFrame(raw);
        expect(r).toEqual({ ok: true, value: raw });
        expect(r.ok && JSON.stringify(r.value)).toBe(JSON.stringify(raw));
        const side = r.ok && isGuestFrame(r.value) ? decodeGuestFrame(raw) : decodeHostFrame(raw);
        expect(side).toEqual({ ok: true, value: raw });
      });
    },
  );

  test('a three-seat welcome puts the table and the seat after the options, key for key; at two seats both are left off', () => {
    expect(JSON.stringify(welcome('Ann', ROOM3, [seat('Bo'), EMPTY], 2))).toBe(
      '{"t":"welcome","hostName":"Ann","seatCount":3,"gamesToWin":1,"removedTwo":"D","exchange":false,"scoperta":false,"partnerPeek":false,"seats":[{"name":"Bo","connected":true},{"name":null,"connected":false}],"you":2}',
    );
    expect(lobby('Ann', ROOM, [seat('Bo')], 1)).toEqual({ t: 'lobby', hostName: 'Ann', ...ROOM });
    expect(JSON.stringify(welcome('Ann', HOUSE, [seat('Bo')], 1))).not.toContain('seats');
  });

  test("seatingOf reads the table off a frame that carries it, null off a two-seat frame and off PR-4's pre-table lobby", () => {
    expect(seatingOf(welcome('Ann', ROOM4, [seat('Bo'), EMPTY, EMPTY], 3))).toEqual({
      seats: [seat('Bo'), EMPTY, EMPTY],
      you: 3,
    });
    expect(seatingOf(lobby('Ann', ROOM, [seat('Bo')], 1))).toBeNull();
    expect(seatingOf(PRE_TABLE_LOBBY)).toBeNull();
  });

  test('joinName is the name a join carries, null for an action', () => {
    expect(joinName(join(' Cal '))).toBe(' Cal ');
    expect(joinName(join(''))).toBe('');
    expect(joinName(action({ type: 'next' }))).toBeNull();
  });
});

describe('the seating is checked against the seat count', () => {
  const table3 = { ...ROOM3, seats: [seat('Bo'), seat('Cal')], you: 1 };

  test.each<[string, unknown, string]>([
    [
      'a three-seat lobby with one row',
      { t: 'lobby', hostName: 'Ann', ...table3, seats: [seat('Bo')] },
      '$.seats: expected 2 seat rows (seatCount - 1)',
    ],
    [
      'a three-seat welcome naming seat 3',
      { t: 'welcome', hostName: 'Ann', ...table3, you: 3 },
      '$.you: expected integer in [1, 2]',
    ],
    [
      'a four-seat lobby naming the host',
      { t: 'lobby', hostName: 'Ann', ...ROOM4, seats: [EMPTY, EMPTY, EMPTY], you: 0 },
      '$.you: expected integer in [1, 3]',
    ],
    [
      'a two-seat welcome with two rows',
      { t: 'welcome', hostName: 'Ann', ...ROOM, seats: [EMPTY, EMPTY] },
      '$.seats: expected 1 seat rows (seatCount - 1)',
    ],
    [
      'a row without its dot',
      { t: 'lobby', hostName: 'Ann', ...table3, seats: [seat('Bo'), { name: 'Cal' }] },
      '$.seats[1].connected: expected boolean',
    ],
    [
      'a row with a numeric name',
      { t: 'lobby', hostName: 'Ann', ...table3, seats: [{ name: 7, connected: true }, EMPTY] },
      '$.seats[0].name: expected string',
    ],
    [
      'a table that is not a list',
      { t: 'lobby', hostName: 'Ann', ...table3, seats: 'Bo, Cal' },
      '$.seats: expected array',
    ],
  ])('%s is refused', (_label, input, error) => {
    expect(decodeFrame(input)).toEqual({ ok: false, error });
    expect(decodeHostFrame(input)).toEqual({ ok: false, error });
  });

  test('a frame whose table fits is taken whole; a two-seat frame may carry its one row; the host side never sees a seating', () => {
    const lobby3 = { t: 'lobby', hostName: 'Ann', ...table3 };
    expect(decodeHostFrame(lobby3)).toEqual({ ok: true, value: lobby3 });
    const tolerated = { t: 'welcome', hostName: 'Ann', ...ROOM, seats: [seat('Jeff')], you: 1 };
    expect(decodeFrame(tolerated)).toEqual({ ok: true, value: tolerated });
    expect(decodeGuestFrame(lobby3)).toEqual({
      ok: false,
      error: '$.t: expected a guest frame (one of "join" | "action"), got "lobby"',
    });
  });
});
