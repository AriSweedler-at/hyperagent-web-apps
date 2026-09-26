// The wire codecs and their goldens (docs/design/fidice-shell-adoption.md §3 "Protocol and
// sessions", §4 M3): no corpus exists for this game's shell wire, so this test is the recorder, as
// briscola's protocol.test.ts is. Every frame below is built from a seeded table with the clock
// pinned; one JSON file per shape and seat count under test/fixtures/fidice-wire/ (2p-*, the
// two-seat literals; 6p-*, the six-seat shapes with the table and the receiver's seat) holds what
// the builders emitted, and the test asserts the files still equal the builders' output (values
// and key order, whitespace aside), that every recorded frame decodes back to itself and
// re-encodes byte for byte, and the pins the skeleton inherits (the seven tags, NAME_MAX 20,
// TOAST_MAX 500, 'Jeff'; plan §7 D1). The web project has no node types, so the files are read
// through the repo's `?raw` imports (web/raw-imports.d.ts) and written by vitest's file snapshots.
// To re-record after a deliberate wire change (a new stem first needs an empty `[]` file, since a
// `?raw` import must resolve):
// `FIDICE_WIRE_RECORD=1 node node_modules/vitest/vitest.mjs run web/games/fidice/src/protocol.test.ts -u`
// then `node node_modules/prettier/bin/prettier.cjs --write test/fixtures/fidice-wire`, and say
// why in the PR.
import { describe, expect, test } from 'vitest';

import action2Json from '../../../../test/fixtures/fidice-wire/2p-action.json?raw';
import lobby2Json from '../../../../test/fixtures/fidice-wire/2p-lobby.json?raw';
import state2Json from '../../../../test/fixtures/fidice-wire/2p-state.json?raw';
import welcome2Json from '../../../../test/fixtures/fidice-wire/2p-welcome.json?raw';
import action6Json from '../../../../test/fixtures/fidice-wire/6p-action.json?raw';
import lobby6Json from '../../../../test/fixtures/fidice-wire/6p-lobby.json?raw';
import state6Json from '../../../../test/fixtures/fidice-wire/6p-state.json?raw';
import welcome6Json from '../../../../test/fixtures/fidice-wire/6p-welcome.json?raw';

import { mulberry32 } from '../../../shared/lib/rng.ts';
import { decide, emptyMemories } from './bots/brain.ts';
import { HOST, apply, bySeat, stampLog } from './domain/game.ts';
import { redactFor } from './domain/publicState.ts';
import type { State } from './domain/types.ts';
import {
  DEFAULT_GUEST_NAME,
  NAME_MAX,
  SEAT_COUNTS,
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
  joinName,
  lobby,
  seatingFault,
  seatingOf,
  state,
  toast,
  welcome,
  type Frame,
  type Room,
  type TableSeat,
} from './protocol.ts';
import { seatTable, viewerFor } from './shellConfig.ts';

type Stem =
  | '2p-welcome'
  | '2p-lobby'
  | '2p-state'
  | '2p-action'
  | '6p-welcome'
  | '6p-lobby'
  | '6p-state'
  | '6p-action';
const STEMS: ReadonlyArray<Stem> = [
  '2p-welcome',
  '2p-lobby',
  '2p-state',
  '2p-action',
  '6p-welcome',
  '6p-lobby',
  '6p-state',
  '6p-action',
];
const TEXT: Readonly<Record<Stem, string>> = {
  '2p-welcome': welcome2Json,
  '2p-lobby': lobby2Json,
  '2p-state': state2Json,
  '2p-action': action2Json,
  '6p-welcome': welcome6Json,
  '6p-lobby': lobby6Json,
  '6p-state': state6Json,
  '6p-action': action6Json,
};
/** Relative to this file, as `toMatchFileSnapshot` takes it. */
const goldenPath = (stem: Stem): string => `../../../../test/fixtures/fidice-wire/${stem}.json`;
/** `FIDICE_WIRE_RECORD=1`: read off the global, since the web project has no `process` type. */
const RECORD =
  (
    globalThis as Readonly<{
      process?: Readonly<{ env: Readonly<Record<string, string | undefined>> }>;
    }>
  ).process?.env['FIDICE_WIRE_RECORD'] === '1';

const NOW = 1_700_000_000_000;
const CODE = 'ABCDE';
const TWO: Room = { lives: 0, seatCount: 2, bots: 0, botChoice: 'profiler', watch: false };
const SIX: Room = { lives: 3, seatCount: 6, bots: 2, botChoice: 'gambler', watch: false };
const EMPTY: TableSeat = { name: null, connected: false };
const seat = (name: string, connected = true): TableSeat => ({ name, connected });

// ---- the seeded tables the state goldens are cut from ------------------------------------------

const unwrap = (r: ReturnType<typeof apply>): State => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
/** The two-seat table: Ann hosts, Jeff joined; the cup is shaken. */
const two = stampLog(
  unwrap(
    apply(
      seatTable(
        CODE,
        [
          { id: 'host', name: 'Ann' },
          { id: 'guest', name: 'Jeff' },
        ],
        TWO,
        mulberry32(1),
      ),
      HOST,
      { type: 'start' },
      mulberry32(1),
    ),
  ),
  NOW,
);
/** The six-seat table: Ann, three guests and two computers; started, then the first computer moves once it holds the cup. */
const six = ((): State => {
  const rng = mulberry32(6);
  const dealt = unwrap(
    apply(
      seatTable(
        CODE,
        [
          { id: 'host', name: 'Ann' },
          { id: 'guest', name: 'Bo' },
          { id: 'guest3', name: 'Dee' },
          { id: 'guest5', name: 'Fay' },
        ],
        SIX,
        rng,
      ),
      HOST,
      { type: 'start' },
      rng,
    ),
  );
  // Ann peeks and bids; Bo calls: a reveal shows, with a record behind it.
  const bidded = unwrap(
    apply(
      unwrap(apply(dealt, bySeat(0), { type: 'peek' }, rng)),
      bySeat(0),
      { type: 'bid', rank: 30 },
      rng,
    ),
  );
  return stampLog(unwrap(apply(bidded, bySeat(1), { type: 'call' }, rng)), NOW);
})();
/** The first computer's move at a table it holds: what an `action` frame from a computer's seat never carries (computers act on the host), spelled for the golden by the bots' own decision. */
const botMove = ((): Frame => {
  const rng = mulberry32(9);
  const table = unwrap(
    apply(seatTable(CODE, [], { ...SIX, watch: true, bots: 3 }, rng), HOST, { type: 'start' }, rng),
  );
  const d = decide(table, emptyMemories, rng);
  if (d === null) throw new Error('no move');
  return action(d.step.action);
})();

const guestView = (s: State, shellSeat: number): ReturnType<typeof redactFor> =>
  redactFor(s, viewerFor(s, shellSeat));

const GOLDENS: Readonly<Record<Stem, ReadonlyArray<Frame>>> = {
  // At two seats the table and `you` are left off the wire, whatever is passed.
  '2p-welcome': [
    welcome('Ann', TWO, [EMPTY], 1),
    welcome('Ann', { ...TWO, lives: 3, botChoice: 'random' }, [EMPTY], 1),
  ],
  '2p-lobby': [
    lobby('Ann', TWO, [seat('Jeff')], 1),
    lobby('Ann', { ...TWO, watch: true, bots: 1 }, [seat('Jeff')], 1),
  ],
  '2p-state': [state(guestView(two, 1)), state(guestView(two, 0))],
  '2p-action': [
    action({ type: 'peek' }),
    action({ type: 'bid', rank: 40 }),
    action({ type: 'call' }),
    action({ type: 'next' }),
  ],
  '6p-welcome': [
    welcome('Ann', SIX, [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY], 1),
    welcome('Ann', SIX, [seat('Bo'), EMPTY, seat('Dee'), EMPTY, EMPTY], 5),
  ],
  '6p-lobby': [
    lobby('Ann', SIX, [seat('Bo'), EMPTY, seat('Dee'), EMPTY, seat('Fay')], 1),
    lobby(
      'Ann',
      { ...SIX, watch: true },
      [seat('Bo'), seat('Cal', false), seat('Dee'), EMPTY, seat('Fay')],
      3,
    ),
  ],
  // One state per guest seat: seats 1, 3 and 5 hold chairs, seat 2 was empty at the deal (a spectator's redaction).
  '6p-state': [
    state(guestView(six, 1)),
    state(guestView(six, 2)),
    state(guestView(six, 3)),
    state(guestView(six, 5)),
  ],
  '6p-action': [
    action({ type: 'pull', die: 2 }),
    action({ type: 'roll', cup: true, table: [0, 4], intoCup: [] }),
    action({ type: 'roll', cup: false, table: [], intoCup: [1] }),
    action({ type: 'finish' }),
    botMove,
  ],
};

const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe.runIf(RECORD)('recording the goldens (FIDICE_WIRE_RECORD=1, with -u)', () => {
  test.each(STEMS)('%s.json', async (stem) => {
    await expect(`${JSON.stringify(GOLDENS[stem], null, 2)}\n`).toMatchFileSnapshot(
      goldenPath(stem),
    );
  });
});

describe('the goldens: what the builders emit, key for key, and what the decoders take back', () => {
  test.each(STEMS)(
    '%s.json equals the builders and every frame round-trips byte for byte',
    (stem) => {
      const onDisk = JSON.parse(TEXT[stem]) as ReadonlyArray<unknown>;
      expect(onDisk).toEqual(viaJson(GOLDENS[stem]));
      expect(JSON.stringify(onDisk), 'key order').toBe(JSON.stringify(GOLDENS[stem]));
      onDisk.forEach((raw) => {
        const decoded = decodeFrame(raw);
        expect(decoded).toEqual({ ok: true, value: raw });
        if (!decoded.ok) return;
        expect(JSON.stringify(decoded.value)).toBe(JSON.stringify(raw));
        const guestSide = isGuestFrame(decoded.value);
        expect(decodeGuestFrame(raw).ok).toBe(guestSide);
        expect(decodeHostFrame(raw).ok).toBe(!guestSide);
      });
    },
  );

  test('the two-seat room is the skeleton`s literal: `{t, hostName, ...opts}` with the five terms in Opts order and no table', () => {
    expect(JSON.stringify(welcome('Ann', TWO, [seat('Jeff')], 1))).toBe(
      '{"t":"welcome","hostName":"Ann","lives":0,"seatCount":2,"bots":0,"botChoice":"profiler","watch":false}',
    );
    expect(seatingOf(lobby('Ann', TWO, [seat('Jeff')], 1))).toBeNull();
    const six1 = lobby('Ann', SIX, [seat('Bo'), EMPTY, EMPTY, EMPTY, EMPTY], 1);
    expect(seatingOf(six1)).toEqual({ seats: [seat('Bo'), EMPTY, EMPTY, EMPTY, EMPTY], you: 1 });
    expect(Object.keys(six1)).toEqual([
      't',
      'hostName',
      'lives',
      'seatCount',
      'bots',
      'botChoice',
      'watch',
      'seats',
      'you',
    ]);
  });

  test('a six-seat state hides the holder`s cup from every other seat and shows the reveal to all; the empty seat gets a spectator`s redaction', () => {
    const [s1, s2] = GOLDENS['6p-state'];
    if (s1?.t !== 'state' || s2?.t !== 'state') throw new Error('state frames');
    // A reveal shows: every die is public, and the record is on the wire.
    expect(s1.view.reveal).not.toBeNull();
    expect(s1.view.records).toHaveLength(1);
    expect(s1.view.round?.dice.every((d) => d.value !== null)).toBe(true);
    expect(s2.view).toEqual(s1.view);
    // Before the call, seat 1 (Bo, not the holder) saw null under the cup while Ann (seat 0, the holder, peeked) saw values.
    const before = viaJson(state(guestView(two, 1)));
    expect(JSON.stringify(before)).toContain('"value":null');
  });
});

describe('the refusals and the pins the skeleton inherits (plan §7 D1)', () => {
  test('the seven tags, the caps, the default guest name; a stranger tag names the seven', () => {
    expect(WIRE_TAGS).toEqual(['join', 'action', 'welcome', 'lobby', 'full', 'toast', 'state']);
    expect([NAME_MAX, TOAST_MAX, DEFAULT_GUEST_NAME]).toEqual([20, 500, 'Jeff']);
    expect(SEAT_COUNTS).toEqual([2, 3, 4, 5, 6]);
    expect(guestNameFor('', 'Ann')).toBe('Jeff');
    expect(guestNameFor('  ann ', 'Ann')).toBe('ann 2');
    expect(guestNameFor('x'.repeat(30), 'Ann')).toBe('x'.repeat(20));
    expect(decodeFrame({ t: 'hello', role: 'player' })).toEqual({
      ok: false,
      error:
        '$.t: expected one of "join" | "action" | "welcome" | "lobby" | "full" | "toast" | "state"',
    });
    expect(full()).toEqual({ t: 'full' });
    expect(toast('x')).toEqual({ t: 'toast', msg: 'x' });
    expect(join('Jeff')).toEqual({ t: 'join', name: 'Jeff' });
    expect(joinName(join('Zoë'))).toBe('Zoë');
    expect(joinName(action({ type: 'call' }))).toBeNull();
  });

  test('a bad action is refused with the legacy sentence at the root; a bad room, seating or view by its path', () => {
    expect(decodeFrame({ t: 'action', action: { type: 'bid', rank: 252 } })).toEqual({
      ok: false,
      error: '$.action: expected bid needs a rank 0–251.',
    });
    expect(decodeFrame({ t: 'action', action: { type: 'play', cardId: 'AC' } })).toEqual({
      ok: false,
      error: '$.action: expected Unknown action type: play',
    });
    expect(decodeFrame({ t: 'welcome', hostName: 'Ann', ...TWO, seatCount: 7 })).toEqual({
      ok: false,
      error: '$.seatCount: expected one of 2 | 3 | 4 | 5 | 6',
    });
    expect(decodeFrame({ t: 'welcome', hostName: 'Ann', ...SIX, bots: 6 })).toEqual({
      ok: false,
      error: '$.bots: expected integer in [0, 5]',
    });
    const rows = [seat('Bo'), EMPTY, EMPTY, EMPTY, EMPTY];
    expect(decodeFrame({ ...welcome('Ann', SIX, rows, 1), seats: [seat('Bo')] })).toEqual({
      ok: false,
      error: '$.seats: expected 5 seat rows (seatCount - 1)',
    });
    expect(decodeFrame({ ...welcome('Ann', SIX, rows, 1), you: 6 })).toEqual({
      ok: false,
      error: '$.you: expected integer in [1, 5]',
    });
    expect(seatingFault(welcome('Ann', { ...SIX, seatCount: 3 }, rows, 1))).toBe(
      '$.seats: expected 2 seat rows (seatCount - 1)',
    );
    expect(decodeFrame({ t: 'state', view: { code: 'X' } })).toEqual({
      ok: false,
      error: '$.view.lives: expected integer in [0, 9007199254740991]',
    });
    const bad = viaJson(state(guestView(two, 1))) as Readonly<{
      view: Readonly<Record<string, unknown>>;
    }>;
    expect(decodeFrame({ t: 'state', view: { ...bad.view, winner: 6 } })).toEqual({
      ok: false,
      error: '$.view.winner: expected one of 0 | 1 | 2 | 3 | 4 | 5',
    });
    expect(decodeFrame({ t: 'toast', msg: 'x'.repeat(501) })).toEqual({
      ok: false,
      error: '$.msg: expected a message of at most 500 characters',
    });
    expect(decodeFrame({ t: 'join', name: 'x'.repeat(21) })).toEqual({
      ok: false,
      error: '$.name: expected a name of at most 20 characters',
    });
  });
});
