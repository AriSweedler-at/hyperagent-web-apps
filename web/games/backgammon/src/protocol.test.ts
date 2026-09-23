// The wire codecs and their goldens (design.md §5.1): no legacy corpus exists for this game, so
// this test is the recorder. Every frame below is built from a seeded engine with the clock
// pinned; one JSON file per tag under test/fixtures/backgammon-wire/ holds what the builders
// emitted, and the test asserts the files still equal the builders' output (values and key
// order, whitespace aside), that every recorded frame decodes back to itself and re-encodes byte
// for byte (R32), and that a `state` frame stays under the size cap even at the end of a match
// (design.md §7 risk 2). The web project has no node types (tsconfig.web.json `types: []`), so
// the files are read through the repo's `?raw` imports (web/raw-imports.d.ts) and written by
// vitest's file snapshots. To re-record after a deliberate wire change (a new tag first needs an
// empty `[]` file, since a `?raw` import must resolve):
// `BG_WIRE_RECORD=1 node node_modules/vitest/vitest.mjs run web/games/backgammon/src/protocol.test.ts -u`
// (`-u` after the path: before it, vitest takes the path as its value and runs every file),
// then `node node_modules/prettier/bin/prettier.cjs --write test/fixtures/backgammon-wire`, and
// say why in the PR. The comparison reads values and key order, so prettier's layout is fine.
import { describe, expect, test } from 'vitest';

import actionJson from '../../../../test/fixtures/backgammon-wire/action.json?raw';
import fullJson from '../../../../test/fixtures/backgammon-wire/full.json?raw';
import joinJson from '../../../../test/fixtures/backgammon-wire/join.json?raw';
import lobbyJson from '../../../../test/fixtures/backgammon-wire/lobby.json?raw';
import stateJson from '../../../../test/fixtures/backgammon-wire/state.json?raw';
import toastJson from '../../../../test/fixtures/backgammon-wire/toast.json?raw';
import welcomeJson from '../../../../test/fixtures/backgammon-wire/welcome.json?raw';

import { mulberry32 } from '../../../shared/lib/rng.ts';
import {
  actorOf,
  applyAction,
  createGame,
  legalActions,
  viewFor,
  type Action,
  type ShippedVariant,
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
const goldenPath = (tag: WireTag): string =>
  `../../../../test/fixtures/backgammon-wire/${tag}.json`;
/** `BG_WIRE_RECORD=1`: read off the global, since the web project has no `process` type. */
const RECORD =
  (
    globalThis as Readonly<{
      process?: Readonly<{ env: Readonly<Record<string, string | undefined>> }>;
    }>
  ).process?.env['BG_WIRE_RECORD'] === '1';
/** A `state` frame at the end of a match (the log at its longest) stays under this. */
const STATE_FRAME_LIMIT = 100 * 1024;
/** More than any match of 1 point needs; a fixed range stands in for a loop (raw loops are banned). */
const STEP_CAP = 3000;

const PLAYERS = [
  { id: 'host', name: 'Ann' },
  { id: 'guest', name: 'Jeff' },
] as const;
const NOW = (): number => 1_700_000_000_000;

const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// ---- the seeded positions the state goldens are cut from ----------------------------------------

const newGame = (seed: number, variant: ShippedVariant, matchLength: number): State =>
  createGame(PLAYERS, { matchLength, rotation: [variant] }, mulberry32(seed), NOW);

/** The first legal action of whoever may act: rolls, plays the first move, takes, moves on. */
const firstAction = (s: State): Action | null =>
  legalActions(viewFor(s, actorOf(s) ?? 0))[0] ?? null;

const apply = (s: State, a: Action, rng: () => number): State => {
  const r = applyAction(s, actorOf(s) ?? 0, a, rng, NOW);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.value;
};

/** Play first-legal-action until `stop` holds or the match is over. */
const playUntil = (start: State, rng: () => number, stop: (s: State) => boolean): State =>
  Array.from({ length: STEP_CAP }).reduce<State>((s) => {
    if (stop(s)) return s;
    const a = firstAction(s);
    return a === null ? s : apply(s, a, rng);
  }, start);

/** The first seed whose portes opening goes to Dark, so the guest's view carries legal moves. */
const darkFirstSeed =
  Array.from({ length: 50 }, (_, i) => i + 1).find(
    (seed) => newGame(seed, 'portes', 5).turn === 1,
  ) ?? 1;
const portesStart = newGame(darkFirstSeed, 'portes', 5);
const portesRolled = apply(portesStart, { type: 'roll' }, mulberry32(darkFirstSeed * 31));
const westernStart = newGame(11, 'backgammon', 3);
/** The opening pair played out, then the next mover (cube centred, not Crawford) doubles. */
const westernDoubled = apply(
  playUntil(westernStart, mulberry32(12), (s) => s.phase === 'toRoll'),
  { type: 'double' },
  mulberry32(13),
);
const portesOver = playUntil(newGame(7, 'portes', 1), mulberry32(70), (s) => s.phase === 'over');

/** The guest's view (`viewFor(game, 1)`), as the host sends it. */
const guestView = (s: State): View => viewFor(s, 1);

// ---- the goldens: one file per tag, what the builders emit -----------------------------------

const GOLDENS: Readonly<Record<WireTag, ReadonlyArray<Frame>>> = {
  join: [join('Jeff'), join('')],
  action: [
    action({ type: 'roll' }),
    action({ type: 'move', from: 7, to: 4, die: 3 }),
    action({ type: 'move', from: 'bar', to: 20, die: 4 }),
    action({ type: 'move', from: 5, to: 'off', die: 6 }),
    action({ type: 'undo' }),
    action({ type: 'double' }),
    action({ type: 'take' }),
    action({ type: 'pass' }),
    action({ type: 'next' }),
  ],
  welcome: [welcome('Ann', 5, 'portes'), welcome('Ann', 3, 'backgammon')],
  lobby: [lobby('Ann', 5, 'portes'), lobby('Ann', 1, 'backgammon')],
  full: [full()],
  toast: [toast("It's not your turn."), toast("That move isn't legal.")],
  // Portes before the first roll; Dark (the guest) rolled and moving, `legal` and `plays` filled;
  // a Western opening (the winner plays the opening pair); the cube offered; a match over.
  state: [
    state(guestView(portesStart)),
    state(guestView(portesRolled)),
    state(guestView(westernStart)),
    state(guestView(westernDoubled)),
    state(guestView(portesOver)),
  ],
};

describe.runIf(RECORD)('recording the goldens (BG_WIRE_RECORD=1, with -u)', () => {
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
  test('cover the phases a guest sees, with the guest moving in the rolled one', () => {
    expect(portesStart.phase).toBe('toRoll');
    expect(portesStart.turn).toBe(1);
    expect(portesRolled.phase).toBe('moving');
    expect(guestView(portesRolled).isMyTurn).toBe(true);
    expect(guestView(portesRolled).legal.length).toBeGreaterThan(0);
    expect(guestView(portesRolled).plays.length).toBeGreaterThan(0);
    expect(westernStart.phase).toBe('moving');
    expect(westernStart.variant).toBe('backgammon');
    expect(westernDoubled.phase).toBe('cubeOffered');
    expect(portesOver.phase).toBe('over');
    expect(guestView(portesOver).matchOver).toBe(true);
  });
});

describe('builders produce the golden literals, key for key', () => {
  test.each<[string, unknown, string]>([
    ['join', join('Jeff'), '{"t":"join","name":"Jeff"}'],
    [
      'action',
      action({ type: 'move', from: 7, to: 4, die: 3 }),
      '{"t":"action","action":{"type":"move","from":7,"to":4,"die":3}}',
    ],
    ['roll', action({ type: 'roll' }), '{"t":"action","action":{"type":"roll"}}'],
    [
      'welcome',
      welcome('Ann', 5, 'portes'),
      '{"t":"welcome","hostName":"Ann","matchLength":5,"variant":"portes"}',
    ],
    [
      'lobby',
      lobby('Ann', 3, 'backgammon'),
      '{"t":"lobby","hostName":"Ann","matchLength":3,"variant":"backgammon"}',
    ],
    ['full', full(), '{"t":"full"}'],
    ['toast', toast("It's not your turn."), '{"t":"toast","msg":"It\'s not your turn."}'],
  ])('%s', (_tag, frame, json) => {
    expect(JSON.stringify(frame)).toBe(json);
  });

  test('state carries the view as is', () => {
    const view = guestView(portesStart);
    expect(JSON.stringify(state(view))).toBe(JSON.stringify({ t: 'state', view }));
  });
});

describe('the wire goldens under test/fixtures/backgammon-wire', () => {
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
      // The side decoders agree with the tag.
      const side = r.ok && isGuestFrame(r.value) ? decodeGuestFrame(raw) : decodeHostFrame(raw);
      expect(side).toEqual({ ok: true, value: raw });
    });
  });

  test('a state frame at the end of a match stays under the size cap (design.md §7 risk 2)', () => {
    const sizes = GOLDENS.state.map((f) => JSON.stringify(f).length);
    sizes.forEach((n) => {
      expect(n).toBeLessThan(STATE_FRAME_LIMIT);
    });
    // `plays` is capped, so the moving frame is the widest and still small.
    expect(Math.max(...sizes)).toBeLessThan(STATE_FRAME_LIMIT);
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
    expect(decodeFrame('join')).toEqual({ ok: false, error: '$: expected object' });
    expect(decodeFrame([{ t: 'full' }])).toEqual({ ok: false, error: '$: expected object' });
  });

  test.each<[string, unknown, string]>([
    ['join without a name', { t: 'join' }, '$.name: expected string'],
    ['join with a numeric name', { t: 'join', name: 7 }, '$.name: expected string'],
    [
      'join with an oversized name',
      { t: 'join', name: 'x'.repeat(NAME_MAX + 1) },
      `$.name: expected a name of at most ${String(NAME_MAX)} characters`,
    ],
    [
      'welcome without a match length',
      { t: 'welcome', hostName: 'Ann', variant: 'portes' },
      '$.matchLength: expected integer in [1, 9007199254740991]',
    ],
    [
      'welcome with match length 0',
      { t: 'welcome', hostName: 'Ann', matchLength: 0, variant: 'portes' },
      '$.matchLength: expected integer in [1, 9007199254740991]',
    ],
    [
      "welcome with gin's target in place of the match",
      { t: 'welcome', hostName: 'Ann', target: 100 },
      '$.matchLength: expected integer in [1, 9007199254740991]',
    ],
    [
      'welcome without a variant',
      { t: 'welcome', hostName: 'Ann', matchLength: 5 },
      '$.variant: expected one of "portes" | "backgammon"',
    ],
    [
      'welcome with an unshipped variant',
      { t: 'welcome', hostName: 'Ann', matchLength: 5, variant: 'plakoto' },
      '$.variant: expected one of "portes" | "backgammon"',
    ],
    [
      'lobby with a fractional match length',
      { t: 'lobby', hostName: 'Ann', matchLength: 1.5, variant: 'portes' },
      '$.matchLength: expected integer in [1, 9007199254740991]',
    ],
    [
      'lobby with an oversized host name',
      { t: 'lobby', hostName: 'y'.repeat(21), matchLength: 1, variant: 'portes' },
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
      { t: 'state', view: { ...(viaJson(guestView(portesStart)) as object), phase: 'x' } },
      '$.view.phase: expected one of "opening" | "toRoll" | "cubeOffered" | "moving" | "over"',
    ],
    [
      'state whose view names an unshipped variant',
      { t: 'state', view: { ...(viaJson(guestView(portesStart)) as object), variant: 'fevga' } },
      '$.view.variant: expected one of "portes" | "backgammon"',
    ],
    ['action without an action', { t: 'action' }, '$.action: expected object'],
    [
      'action of an unknown type',
      { t: 'action', action: { type: 'cheat' } },
      '$.action.type: expected one of "roll" | "move" | "undo" | "double" | "take" | "pass" | "next"',
    ],
    [
      'move without a die',
      { t: 'action', action: { type: 'move', from: 7, to: 4 } },
      '$.action.die: expected one of 1 | 2 | 3 | 4 | 5 | 6',
    ],
    [
      'move with a die of 7',
      { t: 'action', action: { type: 'move', from: 7, to: 4, die: 7 } },
      '$.action.die: expected one of 1 | 2 | 3 | 4 | 5 | 6',
    ],
  ])('%s', (_label, input, error) => {
    expect(decodeFrame(input)).toEqual({ ok: false, error });
  });

  test('extra and prototype keys are dropped; a name at the cap passes; full ignores extras', () => {
    const hostile = JSON.parse(
      '{"t":"join","name":"Jeff","__proto__":{"polluted":true},"constructor":1,"extra":2}',
    ) as unknown;
    expect(decodeFrame(hostile)).toEqual({ ok: true, value: { t: 'join', name: 'Jeff' } });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(decodeFrame({ t: 'join', name: 'x'.repeat(NAME_MAX) }).ok).toBe(true);
    expect(decodeFrame({ t: 'full', view: 1 })).toEqual({ ok: true, value: { t: 'full' } });
    // A plain action carries no other keys, whatever the sender added.
    expect(decodeFrame({ t: 'action', action: { type: 'roll', die: 6 } })).toEqual({
      ok: true,
      value: { t: 'action', action: { type: 'roll' } },
    });
  });
});

describe('decodeGuestFrame / decodeHostFrame keep each side to its own frames', () => {
  test('the host accepts join and action, and refuses the five host frames', () => {
    expect(decodeGuestFrame({ t: 'join', name: 'Jeff' })).toEqual({
      ok: true,
      value: { t: 'join', name: 'Jeff' },
    });
    expect(decodeGuestFrame({ t: 'action', action: { type: 'roll' } })).toEqual({
      ok: true,
      value: { t: 'action', action: { type: 'roll' } },
    });
    expect(decodeGuestFrame({ t: 'full' })).toEqual({
      ok: false,
      error: '$.t: expected a guest frame (one of "join" | "action"), got "full"',
    });
    expect(decodeGuestFrame({ t: 'join' })).toEqual({
      ok: false,
      error: '$.name: expected string',
    });
  });

  test('the guest accepts the five host frames and refuses join and action', () => {
    [
      welcome('Ann', 5, 'portes'),
      lobby('Ann', 5, 'portes'),
      full(),
      toast('t'),
      state(guestView(portesRolled)),
    ].forEach((frame) => {
      expect(decodeHostFrame(viaJson(frame))).toEqual({ ok: true, value: frame });
    });
    expect(decodeHostFrame({ t: 'join', name: 'Jeff' })).toEqual({
      ok: false,
      error:
        '$.t: expected a host frame (one of "welcome" | "lobby" | "full" | "toast" | "state"), got "join"',
    });
    expect(decodeHostFrame({ t: 'action', action: { type: 'roll' } }).ok).toBe(false);
    expect(decodeHostFrame({ t: 'state' })).toEqual({
      ok: false,
      error: '$.view: expected object',
    });
  });

  test('isGuestFrame routes a send: join and action to the host, the rest to the guest', () => {
    expect(WIRE_TAGS.map((tag) => GOLDENS[tag].map(isGuestFrame))).toEqual([
      [true, true],
      Array.from({ length: 9 }, () => true),
      [false, false],
      [false, false],
      [false],
      [false, false],
      Array.from({ length: 5 }, () => false),
    ]);
  });
});

describe('guestNameFor', () => {
  test("cuts to 20, trims, defaults to Jeff and suffixes a clash with the host, as gin's host does", () => {
    expect(guestNameFor('Jeff', 'Ann')).toBe('Jeff');
    expect(guestNameFor('  Bo  ', 'Ann')).toBe('Bo');
    expect(guestNameFor('', 'Ann')).toBe('Jeff');
    expect(guestNameFor('   ', 'Ann')).toBe('Jeff');
    expect(guestNameFor('ann', 'Ann')).toBe('ann 2');
    expect(guestNameFor('ANN', 'ann')).toBe('ANN 2');
    expect(guestNameFor('abcdefghijklmnopqrstuvwxyz', 'Ann')).toBe('abcdefghijklmnopqrst');
    // The cut happens before the trim, as in `String(name).slice(0, 20).trim()`.
    expect(guestNameFor('abcdefghijklmnopqrs      x', 'Ann')).toBe('abcdefghijklmnopqrs');
    expect(guestNameFor('', 'Jeff')).toBe('Jeff 2');
  });
});
