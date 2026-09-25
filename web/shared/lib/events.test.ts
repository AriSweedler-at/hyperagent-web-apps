// The event stream helpers (briscola-sound-history.md §3.5): the last id, and the slice of
// events beyond the previous frame, none on a first paint or a re-sent frame.
import { describe, expect, test } from 'vitest';

import {
  lastEventId,
  newEvents,
  type EventCopy,
  type EventSound,
  type GameEvent,
} from './events.ts';
import { spec } from './sound/phrase.ts';

type Ev = GameEvent<'deal' | 'play' | 'trick', Readonly<{ n: number }>>;
const ev = (id: number, kind: Ev['kind'], seat: number | null = null): Ev => ({
  id,
  kind,
  seat,
  at: 1000 + id,
  data: { n: id },
});
const PLAY = ev(1, 'play', 0);
const TRICK = ev(3, 'trick', 1);
const STREAM = [ev(0, 'deal'), PLAY, ev(2, 'play', 1), TRICK];

describe('lastEventId', () => {
  test('the greatest id, or null for an empty stream', () => {
    expect(lastEventId(STREAM)).toBe(3);
    expect(lastEventId([ev(5, 'play')])).toBe(5);
    expect(lastEventId([])).toBeNull();
  });
});

describe('newEvents', () => {
  test('a first paint (prev null) is never replayed', () => {
    expect(newEvents(null, STREAM)).toEqual([]);
  });

  test('the events after the last id of prev, in order; a re-sent frame yields none', () => {
    expect(newEvents(STREAM.slice(0, 2), STREAM)).toEqual([ev(2, 'play', 1), TRICK]);
    expect(newEvents(STREAM.slice(0, 3), STREAM)).toEqual([TRICK]);
    expect(newEvents(STREAM, STREAM)).toEqual([]);
    expect(newEvents(STREAM, STREAM.slice(0, 2))).toEqual([]);
  });

  test('an empty prev (a game just begun) sees every event of next as new', () => {
    expect(newEvents([], STREAM)).toEqual(STREAM);
    expect(newEvents([], [])).toEqual([]);
  });

  test('the binding types: copy gives a line and rows, sound gives a phrase or silence', () => {
    const copy: EventCopy<Ev, Readonly<{ names: ReadonlyArray<string> }>> = {
      summary: (e, ctx) => `${ctx.names[e.seat ?? 0] ?? 'table'}: ${e.kind}`,
      detail: (e) => [
        ['kind', e.kind],
        ['n', String(e.data.n)],
      ],
    };
    const sound: EventSound<Ev, 'host' | 'guest' | 'local'> = (e, me, role) =>
      e.kind === 'trick' ? spec(e.seat === me || role === 'local' ? 'good' : 'bad', 12) : null;
    expect(copy.summary(TRICK, { names: ['Ari', 'Jeff'] })).toBe('Jeff: trick');
    expect(copy.detail(TRICK, { names: [] })).toEqual([
      ['kind', 'trick'],
      ['n', '3'],
    ]);
    expect(sound(TRICK, 1, 'host')).toEqual(spec('good', 12));
    expect(sound(TRICK, 0, 'guest')).toEqual(spec('bad', 12));
    expect(sound(PLAY, 0, 'local')).toBeNull();
  });
});
