import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../shared/lib/rng.ts';
import { createGame, viewFor } from './engine/index.ts';
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
  join,
  lobby,
  state,
  toast,
  welcome,
} from './protocol.ts';

const view = viewFor(
  createGame(
    {
      players: [
        { id: 'host', name: 'Ann' },
        { id: 'guest', name: 'Jeff' },
      ],
      target: 100,
      dealer: 0,
    },
    mulberry32(5),
    () => 1_700_000_000_000,
  ),
  1,
);

const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('frozen constants', () => {
  test('the seven tags, the name cap and the default guest name are the legacy literals', () => {
    expect([...WIRE_TAGS].sort()).toEqual(
      ['join', 'welcome', 'lobby', 'full', 'toast', 'state', 'action'].sort(),
    );
    expect(NAME_MAX).toBe(20);
    expect(DEFAULT_GUEST_NAME).toBe('Jeff');
    expect(TOAST_MAX).toBe(500);
  });
});

describe('builders produce the legacy literals, key for key', () => {
  test.each<[string, unknown, string]>([
    ['join', join('Jeff'), '{"t":"join","name":"Jeff"}'],
    [
      'action',
      action({ type: 'discard', cardId: 'AS' }),
      '{"t":"action","action":{"type":"discard","cardId":"AS"}}',
    ],
    ['welcome', welcome('Ann', 100), '{"t":"welcome","hostName":"Ann","target":100}'],
    ['lobby', lobby('Ann', 50), '{"t":"lobby","hostName":"Ann","target":50}'],
    ['full', full(), '{"t":"full"}'],
    ['toast', toast("It's not your turn."), '{"t":"toast","msg":"It\'s not your turn."}'],
  ])('%s', (_tag, frame, json) => {
    expect(JSON.stringify(frame)).toBe(json);
  });

  test('state carries the view as is', () => {
    expect(JSON.stringify(state(view))).toBe(JSON.stringify({ t: 'state', view }));
  });
});

describe('decodeFrame', () => {
  test('every builder output decodes back to an equal frame with the same JSON text', () => {
    const frames = [
      join('Jeff'),
      action({ type: 'setMelds', melds: [['AS', 'AH', 'AD']] }),
      welcome('Ann', 100),
      lobby('Ann', 100),
      full(),
      toast('x'),
      state(view),
    ];
    frames.forEach((frame) => {
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
      'welcome without a target',
      { t: 'welcome', hostName: 'Ann' },
      '$.target: expected integer in [1, 9007199254740991]',
    ],
    [
      'welcome with target 0',
      { t: 'welcome', hostName: 'Ann', target: 0 },
      '$.target: expected integer in [1, 9007199254740991]',
    ],
    [
      'lobby with a fractional target',
      { t: 'lobby', hostName: 'Ann', target: 1.5 },
      '$.target: expected integer in [1, 9007199254740991]',
    ],
    [
      'lobby with an oversized host name',
      { t: 'lobby', hostName: 'y'.repeat(21), target: 1 },
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
      { t: 'state', view: { ...(viaJson(view) as object), phase: 'x' } },
      '$.view.phase: expected one of "upcard" | "draw" | "discard" | "roundOver" | "gameOver"',
    ],
    ['action without an action', { t: 'action' }, '$.action: expected object'],
    [
      'action of an unknown type',
      { t: 'action', action: { type: 'cheat' } },
      '$.action.type: expected one of "ready" | "takeUpcard" | "passUpcard" | "drawStock" | "drawDiscard" | "undoDraw" | "discard" | "knock" | "setMelds"',
    ],
    [
      'knock without a card',
      { t: 'action', action: { type: 'knock' } },
      '$.action.cardId: expected string',
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
    expect(decodeFrame({ t: 'join', name: '' })).toEqual({
      ok: true,
      value: { t: 'join', name: '' },
    });
  });
});

describe('decodeGuestFrame / decodeHostFrame keep each side to its own frames', () => {
  test('the host accepts join and action, and refuses the five host frames', () => {
    expect(decodeGuestFrame({ t: 'join', name: 'Jeff' })).toEqual({
      ok: true,
      value: { t: 'join', name: 'Jeff' },
    });
    expect(decodeGuestFrame({ t: 'action', action: { type: 'ready' } })).toEqual({
      ok: true,
      value: { t: 'action', action: { type: 'ready' } },
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
    [welcome('Ann', 100), lobby('Ann', 100), full(), toast('t'), state(view)].forEach((frame) => {
      expect(decodeHostFrame(viaJson(frame))).toEqual({ ok: true, value: frame });
    });
    expect(decodeHostFrame({ t: 'join', name: 'Jeff' })).toEqual({
      ok: false,
      error:
        '$.t: expected a host frame (one of "welcome" | "lobby" | "full" | "toast" | "state"), got "join"',
    });
    expect(decodeHostFrame({ t: 'action', action: { type: 'ready' } }).ok).toBe(false);
    expect(decodeHostFrame({ t: 'state' })).toEqual({
      ok: false,
      error: '$.view: expected object',
    });
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
