// The two-seat protocol over a fake game: a two-field room, so the wire order of `welcome` and
// `lobby` (`t`, `hostName`, then the room in its declared order) and the per-field refusals are
// pinned here once; each game's protocol.test.ts pins its own bytes (gin against the legacy
// corpus, backgammon against its goldens) through the wrappers.
import { describe, expect, test } from 'vitest';

import { arrayOf, integer, literal, object, string, type Decoded } from './json.ts';
import {
  DEFAULT_GUEST_NAME,
  NAME_MAX,
  TOAST_MAX,
  WIRE_TAGS,
  guestNameFor,
  isGuestFrame,
  twoSeatProtocol,
  type Frame,
} from './protocol.ts';

const decodeAction = object({ type: literal('ping', 'pong') });
const decodeView = object({ turn: integer(0, 1), log: arrayOf(string) });
const room = { size: integer(1), mode: literal('a', 'b') };
type Action = Decoded<typeof decodeAction>;
type View = Decoded<typeof decodeView>;
type Room = Decoded<ReturnType<typeof object<typeof room>>>;

const {
  decodeFrame,
  decodeGuestFrame,
  decodeHostFrame,
  join,
  action,
  welcome,
  lobby,
  full,
  toast,
  state,
} = twoSeatProtocol({ decodeAction, decodeView, room });

const view: View = { turn: 1, log: ['ping'] };
const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** One frame of every tag, guest-to-host first. */
const SEVEN: ReadonlyArray<Frame<Action, View, Room>> = [
  join('Jeff'),
  action({ type: 'ping' }),
  welcome('Ann', { size: 3, mode: 'a' }),
  lobby('Ann', { size: 1, mode: 'b' }),
  full(),
  toast("It's not your turn."),
  state(view),
];

describe('frozen constants', () => {
  test("the seven tags in emit order, the name cap, the toast cap and the default guest name are gin's literals", () => {
    expect(WIRE_TAGS).toEqual(['join', 'action', 'welcome', 'lobby', 'full', 'toast', 'state']);
    expect(NAME_MAX).toBe(20);
    expect(TOAST_MAX).toBe(500);
    expect(DEFAULT_GUEST_NAME).toBe('Jeff');
  });
});

describe('builders produce the legacy literals, key for key', () => {
  test.each<[string, unknown, string]>([
    ['join', join('Jeff'), '{"t":"join","name":"Jeff"}'],
    ['action', action({ type: 'pong' }), '{"t":"action","action":{"type":"pong"}}'],
    [
      'welcome',
      welcome('Ann', { size: 3, mode: 'a' }),
      '{"t":"welcome","hostName":"Ann","size":3,"mode":"a"}',
    ],
    [
      'lobby',
      lobby('Ann', { size: 1, mode: 'b' }),
      '{"t":"lobby","hostName":"Ann","size":1,"mode":"b"}',
    ],
    ['full', full(), '{"t":"full"}'],
    ['toast', toast("It's not your turn."), '{"t":"toast","msg":"It\'s not your turn."}'],
    ['state', state(view), '{"t":"state","view":{"turn":1,"log":["ping"]}}'],
  ])('%s', (_tag, frame, json) => {
    expect(JSON.stringify(frame)).toBe(json);
  });

  test("a one-field room is gin's legacy welcome; an empty room is the host's name alone", () => {
    const gin = twoSeatProtocol({ decodeAction, decodeView, room: { target: integer(1) } });
    expect(JSON.stringify(gin.welcome('Ann', { target: 100 }))).toBe(
      '{"t":"welcome","hostName":"Ann","target":100}',
    );
    expect(JSON.stringify(gin.lobby('Ann', { target: 50 }))).toBe(
      '{"t":"lobby","hostName":"Ann","target":50}',
    );
    const bare = twoSeatProtocol({ decodeAction, decodeView, room: {} });
    expect(JSON.stringify(bare.welcome('Ann', {}))).toBe('{"t":"welcome","hostName":"Ann"}');
    expect(bare.decodeFrame({ t: 'lobby', hostName: 'Ann', size: 9 })).toEqual({
      ok: true,
      value: { t: 'lobby', hostName: 'Ann' },
    });
  });
});

describe('decodeFrame', () => {
  test('every builder output decodes back to an equal frame with the same JSON text', () => {
    SEVEN.forEach((frame) => {
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
      'welcome without a host name',
      { t: 'welcome', size: 3, mode: 'a' },
      '$.hostName: expected string',
    ],
    [
      'welcome with an oversized host name and no room: the name is reported first',
      { t: 'welcome', hostName: 'y'.repeat(21) },
      '$.hostName: expected a name of at most 20 characters',
    ],
    [
      'welcome without the first room field',
      { t: 'welcome', hostName: 'Ann', mode: 'a' },
      '$.size: expected integer in [1, 9007199254740991]',
    ],
    [
      'welcome with size 0',
      { t: 'welcome', hostName: 'Ann', size: 0, mode: 'a' },
      '$.size: expected integer in [1, 9007199254740991]',
    ],
    [
      'welcome without the second room field',
      { t: 'welcome', hostName: 'Ann', size: 3 },
      '$.mode: expected one of "a" | "b"',
    ],
    [
      'lobby with a fractional size',
      { t: 'lobby', hostName: 'Ann', size: 1.5, mode: 'a' },
      '$.size: expected integer in [1, 9007199254740991]',
    ],
    [
      'lobby with a mode the room does not know',
      { t: 'lobby', hostName: 'Ann', size: 1, mode: 'c' },
      '$.mode: expected one of "a" | "b"',
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
      { t: 'state', view: { ...view, turn: 2 } },
      '$.view.turn: expected integer in [0, 1]',
    ],
    ['action without an action', { t: 'action' }, '$.action: expected object'],
    [
      'action of an unknown type',
      { t: 'action', action: { type: 'cheat' } },
      '$.action.type: expected one of "ping" | "pong"',
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
    // A room keeps only its declared fields, whatever the sender added, and in its own order.
    const r = decodeFrame({ t: 'welcome', mode: 'b', extra: true, hostName: 'Ann', size: 2 });
    expect(r).toEqual({ ok: true, value: { t: 'welcome', hostName: 'Ann', size: 2, mode: 'b' } });
    expect(r.ok && JSON.stringify(r.value)).toBe(
      '{"t":"welcome","hostName":"Ann","size":2,"mode":"b"}',
    );
  });
});

describe('decodeGuestFrame / decodeHostFrame keep each side to its own frames', () => {
  test('the host accepts join and action, and refuses the five host frames', () => {
    expect(decodeGuestFrame({ t: 'join', name: 'Jeff' })).toEqual({
      ok: true,
      value: { t: 'join', name: 'Jeff' },
    });
    expect(decodeGuestFrame({ t: 'action', action: { type: 'ping' } })).toEqual({
      ok: true,
      value: { t: 'action', action: { type: 'ping' } },
    });
    SEVEN.slice(2).forEach((frame) => {
      expect(decodeGuestFrame(viaJson(frame))).toEqual({
        ok: false,
        error: `$.t: expected a guest frame (one of "join" | "action"), got "${frame.t}"`,
      });
    });
    expect(decodeGuestFrame({ t: 'join' })).toEqual({
      ok: false,
      error: '$.name: expected string',
    });
  });

  test('the guest accepts the five host frames and refuses join and action', () => {
    SEVEN.slice(2).forEach((frame) => {
      expect(decodeHostFrame(viaJson(frame))).toEqual({ ok: true, value: frame });
    });
    expect(decodeHostFrame({ t: 'join', name: 'Jeff' })).toEqual({
      ok: false,
      error:
        '$.t: expected a host frame (one of "welcome" | "lobby" | "full" | "toast" | "state"), got "join"',
    });
    expect(decodeHostFrame({ t: 'action', action: { type: 'ping' } })).toEqual({
      ok: false,
      error:
        '$.t: expected a host frame (one of "welcome" | "lobby" | "full" | "toast" | "state"), got "action"',
    });
    expect(decodeHostFrame({ t: 'state' })).toEqual({
      ok: false,
      error: '$.view: expected object',
    });
  });

  test('isGuestFrame routes a send: join and action to the host, the rest to the guest', () => {
    expect(SEVEN.map(isGuestFrame)).toEqual([true, true, false, false, false, false, false]);
  });
});

describe('guestNameFor', () => {
  test('cuts to 20, trims, defaults to Jeff and suffixes a clash with the host, as the legacy did', () => {
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
