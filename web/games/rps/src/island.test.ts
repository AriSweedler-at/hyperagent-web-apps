// The pairing as the state machine runs it (docs/design/rps-island.md §11): the gate by device,
// the probe's three answers, the poll's states on a scripted clock (the `at` of each event), the
// mood post's body, the in-flight rule and the 404, and the row each state paints.
import { describe, expect, test } from 'vitest';

import { fakeEl, fakePage, fakeTarget } from '../../../shared/edge/page.fake.ts';
import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { SMART_APP_BANNER_META, rpsClipUrl } from '../../../shared/lib/appClip.ts';
import { DEVICES, deviceById, type Device } from '../../../shared/lib/devices.ts';
import { INITIAL_PROGRESS, type Progress } from './engine/engine.ts';
import {
  FLUSH_MS,
  ISLAND_COPY,
  MOOD_URL,
  OFF,
  POLL_MAX_MS,
  POLL_MS,
  SESSION_KEY,
  bindIsland,
  hasIsland,
  moodBody,
  newSession,
  pairUrl,
  paintIsland,
  pollAnswer,
  reduceIsland,
  rememberSession,
  sessionOf,
  startIsland,
  type IslandEffect,
  type IslandEvent,
  type IslandState,
} from './island.ts';

const SESSION = 'abc12345';

const must = (id: string): Device => {
  const device = deviceById(id);
  if (device === null) throw new Error(`no catalogue row ${id}`);
  return device;
};

const play = (state: IslandState, events: ReadonlyArray<IslandEvent>): IslandState =>
  events.reduce((s, e) => reduceIsland(s, e).state, state);

const effectsOf = (state: IslandState, event: IslandEvent): ReadonlyArray<IslandEffect> =>
  reduceIsland(state, event).effects;

const idle: IslandState = { kind: 'idle', session: SESSION };
const paired: IslandState = { kind: 'paired', session: SESSION, inflight: false, pending: null };
const happy: Progress = { ...INITIAL_PROGRESS, counter: 3, prestige: 1 };

describe('the gate', () => {
  test('an iPhone with a Dynamic Island passes; a notch, a home button, an iPad, an Android hole and no device do not', () => {
    expect(hasIsland(must('iphone-393x852'))).toBe(true);
    expect(hasIsland(must('iphone-430x932'))).toBe(true);
    expect(hasIsland(must('iphone-390x844'))).toBe(false);
    expect(hasIsland(must('iphone-375x667-se'))).toBe(false);
    expect(hasIsland(must('ipad-768x1024'))).toBe(false);
    expect(hasIsland(must('android-412x915-pixel'))).toBe(false);
    expect(hasIsland(null)).toBe(false);
    // Every row the gate passes is an iPhone whose cut is an island: the catalogue is the source.
    DEVICES.forEach((d) => {
      expect(hasIsland(d)).toBe(d.kind === 'iphone' && d.cut?.island === true);
    });
  });
});

describe('the session', () => {
  const memory = (): StorageLike => {
    const rows = new Map<string, string>();
    return {
      getItem: (k) => rows.get(k) ?? null,
      setItem: (k, v) => {
        rows.set(k, v);
      },
      removeItem: (k) => {
        rows.delete(k);
      },
    };
  };

  test('newSession: eight lowercase letters or digits, from the bytes it is given, or the platform', () => {
    expect(newSession(() => [0, 1, 2, 3, 4, 5, 6, 7])).toBe('abcdefgh');
    expect(newSession()).toMatch(/^[a-z0-9]{8}$/);
    expect(newSession()).not.toBe(newSession());
  });

  test('sessionOf reads a remembered id, refuses anything else; rememberSession writes and forgets', () => {
    const storage = memory();
    const store = createStore(storage);
    expect(sessionOf(store)).toBeNull();
    rememberSession(store, SESSION);
    expect(storage.getItem(SESSION_KEY)).toBe(SESSION);
    expect(sessionOf(store)).toBe(SESSION);
    storage.setItem(SESSION_KEY, 'not a session');
    expect(sessionOf(store)).toBeNull();
    rememberSession(store, null);
    expect(storage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('the probe', () => {
  test('the boot polls the session once', () => {
    expect(startIsland(SESSION)).toEqual({
      state: { kind: 'probing', session: SESSION },
      effects: [{ kind: 'poll', session: SESSION }],
    });
  });

  test('unpaired: the button; paired (a remembered pairing): the island, synced; absent (no Worker): off', () => {
    const probing = startIsland(SESSION).state;
    expect(reduceIsland(probing, { type: 'poll/result', answer: 'unpaired', at: 0 })).toEqual({
      state: idle,
      effects: [],
    });
    expect(reduceIsland(probing, { type: 'poll/result', answer: 'paired', at: 0 })).toEqual({
      state: paired,
      effects: [{ kind: 'sync' }],
    });
    expect(reduceIsland(probing, { type: 'poll/result', answer: 'absent', at: 0 })).toEqual({
      state: OFF,
      effects: [],
    });
    // Nothing else moves the probe; nothing at all moves `off`.
    expect(reduceIsland(probing, { type: 'send', at: 0 }).state).toEqual(probing);
    expect(reduceIsland(OFF, { type: 'poll/result', answer: 'paired', at: 0 })).toEqual({
      state: OFF,
      effects: [],
    });
    expect(reduceIsland(OFF, { type: 'home', session: 'zzzzzzzz' }).state).toEqual(OFF);
  });

  test('pollAnswer: a 200 {paired} is the Worker; a 404, a 503 or another body is no Worker', () => {
    expect(pollAnswer(200, { paired: true })).toBe('paired');
    expect(pollAnswer(200, { paired: false })).toBe('unpaired');
    expect(pollAnswer(200, { paired: 'yes' })).toBe('absent');
    expect(pollAnswer(200, null)).toBe('absent');
    expect(pollAnswer(200, 'ok')).toBe('absent');
    expect(pollAnswer(404, { paired: false })).toBe('absent');
    expect(pollAnswer(503, { error: 'island pushes not configured' })).toBe('absent');
    expect(pairUrl(SESSION)).toBe(`/api/rps/pair/${SESSION}`);
    expect(MOOD_URL).toBe('/api/rps/mood');
  });
});

describe('the poll', () => {
  test('the tap starts waiting with a poll; each unpaired answer arms the next poll 3 s later; the tick polls', () => {
    const sent = reduceIsland(idle, { type: 'send', at: 1_000 });
    expect(sent).toEqual({
      state: { kind: 'waiting', session: SESSION, since: 1_000 },
      effects: [{ kind: 'poll', session: SESSION }],
    });
    const unpaired = reduceIsland(sent.state, {
      type: 'poll/result',
      answer: 'unpaired',
      at: 1_100,
    });
    expect(unpaired.state).toEqual(sent.state);
    expect(unpaired.effects).toEqual([{ kind: 'timer', id: 'island/poll', ms: POLL_MS }]);
    expect(reduceIsland(unpaired.state, { type: 'poll/tick' }).effects).toEqual([
      { kind: 'poll', session: SESSION },
    ]);
    // A network blip reads as unpaired here: the poll goes on.
    expect(effectsOf(sent.state, { type: 'poll/result', answer: 'absent', at: 4_200 })).toEqual([
      { kind: 'timer', id: 'island/poll', ms: POLL_MS },
    ]);
    // Idle ignores everything but the tap.
    expect(reduceIsland(idle, { type: 'poll/tick' }).state).toEqual(idle);
    expect(reduceIsland(idle, { type: 'round', progress: happy, at: 0 }).effects).toEqual([]);
  });

  test('paired: the island, synced with the current score', () => {
    const waiting = reduceIsland(idle, { type: 'send', at: 1_000 }).state;
    expect(reduceIsland(waiting, { type: 'poll/result', answer: 'paired', at: 7_300 })).toEqual({
      state: paired,
      effects: [{ kind: 'sync' }],
    });
  });

  test('two minutes unpaired: still waiting, with a retry that polls again from a fresh start', () => {
    const waiting = reduceIsland(idle, { type: 'send', at: 1_000 }).state;
    const late = reduceIsland(waiting, {
      type: 'poll/result',
      answer: 'unpaired',
      at: 1_000 + POLL_MAX_MS - 1,
    });
    expect(late.state).toEqual(waiting);
    const stalled = reduceIsland(waiting, {
      type: 'poll/result',
      answer: 'unpaired',
      at: 1_000 + POLL_MAX_MS,
    });
    expect(stalled).toEqual({ state: { kind: 'stalled', session: SESSION }, effects: [] });
    expect(reduceIsland(stalled.state, { type: 'poll/tick' }).state).toEqual(stalled.state);
    expect(reduceIsland(stalled.state, { type: 'retry', at: 200_000 })).toEqual({
      state: { kind: 'waiting', session: SESSION, since: 200_000 },
      effects: [{ kind: 'poll', session: SESSION }],
    });
  });

  test('send buddy home from any shown state: idle with the fresh session, timers cancelled, the id remembered', () => {
    const waiting = reduceIsland(idle, { type: 'send', at: 1_000 }).state;
    const home: IslandEvent = { type: 'home', session: 'zzzzzzzz' };
    const expected = {
      state: { kind: 'idle', session: 'zzzzzzzz' },
      effects: [
        { kind: 'cancel', id: 'island/poll' },
        { kind: 'cancel', id: 'island/flush' },
        { kind: 'remember', session: 'zzzzzzzz' },
      ],
    };
    expect(reduceIsland(waiting, home)).toEqual(expected);
    expect(reduceIsland(paired, home)).toEqual(expected);
    expect(reduceIsland({ kind: 'stalled', session: SESSION }, home)).toEqual(expected);
    expect(reduceIsland(idle, home)).toEqual(expected);
  });
});

describe('the post', () => {
  test('a save posts the counter, the prestige, the band and the instant in seconds', () => {
    expect(moodBody(SESSION, happy, 1_759_180_000_999)).toEqual({
      session: SESSION,
      counter: 3,
      prestige: 1,
      band: 'happy',
      at: 1_759_180_000,
    });
    const posted = reduceIsland(paired, { type: 'round', progress: happy, at: 5_000 });
    expect(posted).toEqual({
      state: { ...paired, inflight: true },
      effects: [{ kind: 'post', body: moodBody(SESSION, happy, 5_000) }],
    });
  });

  test('one in flight: the next round waits and the latest wins; the reply arms a 2 s flush, which posts it', () => {
    const inflight = reduceIsland(paired, { type: 'round', progress: happy, at: 5_000 }).state;
    const sad: Progress = { ...INITIAL_PROGRESS, counter: -3 };
    const verySad: Progress = { ...INITIAL_PROGRESS, counter: -5 };
    const queued = play(inflight, [
      { type: 'round', progress: sad, at: 6_000 },
      { type: 'round', progress: verySad, at: 7_000 },
    ]);
    expect(queued).toEqual({
      ...paired,
      inflight: true,
      pending: moodBody(SESSION, verySad, 7_000),
    });
    expect(effectsOf(inflight, { type: 'round', progress: sad, at: 6_000 })).toEqual([]);
    const done = reduceIsland(queued, { type: 'post/done', status: 202, at: 7_100 });
    expect(done.state).toEqual({ ...queued, inflight: false });
    expect(done.effects).toEqual([{ kind: 'timer', id: 'island/flush', ms: FLUSH_MS }]);
    expect(reduceIsland(done.state, { type: 'flush' })).toEqual({
      state: { ...paired, inflight: true },
      effects: [{ kind: 'post', body: moodBody(SESSION, verySad, 7_000) }],
    });
    // A flush with nothing pending, or while a post is in flight, does nothing.
    expect(reduceIsland(paired, { type: 'flush' })).toEqual({ state: paired, effects: [] });
    expect(
      reduceIsland(
        { ...paired, inflight: true, pending: moodBody(SESSION, verySad, 7_000) },
        { type: 'flush' },
      ).effects,
    ).toEqual([]);
  });

  test('a reply with nothing pending frees the line; a 429 is let go like any other reply', () => {
    const inflight = reduceIsland(paired, { type: 'round', progress: happy, at: 5_000 }).state;
    expect(reduceIsland(inflight, { type: 'post/done', status: 202, at: 5_100 })).toEqual({
      state: paired,
      effects: [],
    });
    expect(reduceIsland(inflight, { type: 'post/done', status: 429, at: 5_100 })).toEqual({
      state: paired,
      effects: [],
    });
    expect(reduceIsland(inflight, { type: 'post/done', status: 0, at: 5_100 }).state).toEqual(
      paired,
    );
  });

  test('a 404 after pairing: the Worker forgot the pair, back to waiting from now', () => {
    const inflight = reduceIsland(paired, { type: 'round', progress: happy, at: 5_000 }).state;
    expect(reduceIsland(inflight, { type: 'post/done', status: 404, at: 5_100 })).toEqual({
      state: { kind: 'waiting', session: SESSION, since: 5_100 },
      effects: [{ kind: 'poll', session: SESSION }],
    });
  });

  test('the other events leave a pairing alone', () => {
    const events: ReadonlyArray<IslandEvent> = [
      { type: 'send', at: 0 },
      { type: 'poll/result', answer: 'unpaired', at: 0 },
      { type: 'poll/tick' },
      { type: 'retry', at: 0 },
    ];
    events.forEach((event) => {
      expect(reduceIsland(paired, event)).toEqual({ state: paired, effects: [] });
    });
  });
});

describe('the row', () => {
  const page = () => {
    const slot = fakeEl('islandSlot');
    const metaHolder = { meta: null as ReturnType<typeof fakeEl> | null };
    const head = fakeEl('head', {
      queries: {
        [`meta[name="${SMART_APP_BANNER_META}"]`]: () =>
          metaHolder.meta === null || metaHolder.meta.removed() ? [] : [metaHolder.meta],
      },
    });
    return { slot, head, metaHolder, doc: fakePage([slot, head]).doc };
  };

  test('off and probing paint nothing; the button, the waiting, the stalled and the paired rows carry their words', () => {
    const { slot, head, doc } = page();
    paintIsland(doc, head.el, OFF);
    expect(slot.text()).toBe('');
    paintIsland(doc, head.el, { kind: 'probing', session: SESSION });
    expect(slot.text()).toBe('');
    paintIsland(doc, head.el, idle);
    expect(slot.text()).toContain(ISLAND_COPY.send);
    expect(slot.text()).toContain(`href="${rpsClipUrl(SESSION)}"`);
    expect(slot.text()).toContain('target="_blank"');
    expect(slot.text()).toContain('data-island="send"');
    paintIsland(doc, head.el, { kind: 'waiting', session: SESSION, since: 0 });
    expect(slot.text()).toContain(ISLAND_COPY.waiting);
    expect(slot.text()).toContain(ISLAND_COPY.home);
    expect(slot.text()).toContain(ISLAND_COPY.open);
    paintIsland(doc, head.el, { kind: 'stalled', session: SESSION });
    expect(slot.text()).toContain(ISLAND_COPY.stalled);
    expect(slot.text()).toContain('data-island="retry"');
    paintIsland(doc, head.el, paired);
    expect(slot.text()).toContain(ISLAND_COPY.paired);
    expect(slot.text()).toContain('data-island="home"');
    expect(slot.text()).not.toContain(ISLAND_COPY.send);
  });

  test('the banner: written once while the row is on, taken back when it is off', () => {
    const { head, doc, metaHolder } = page();
    paintIsland(doc, head.el, { kind: 'probing', session: SESSION });
    expect(head.text()).toContain(`<meta name="${SMART_APP_BANNER_META}"`);
    expect(head.text()).toContain(`app-argument=${rpsClipUrl(SESSION)}`);
    // The tag is there now: another paint writes no second one.
    metaHolder.meta = fakeEl('meta');
    const before = head.text();
    paintIsland(doc, head.el, idle);
    expect(head.text()).toBe(before);
    paintIsland(doc, head.el, OFF);
    expect(metaHolder.meta.removed()).toBe(true);
    // Off with no tag: nothing to remove.
    paintIsland(doc, head.el, OFF);
  });

  test("one delegated listener: the tapped element's data-island names the action; other taps are nothing", () => {
    const { slot, doc } = page();
    const actions: string[] = [];
    bindIsland(doc, (a) => {
      actions.push(a);
    });
    expect(slot.listenerTypes()).toEqual(['click']);
    const send = fakeEl('a', { attrs: { 'data-island': 'send' } });
    const retry = fakeEl('b', { attrs: { 'data-island': 'retry' } });
    const home = fakeEl('c', { attrs: { 'data-island': 'home' } });
    const other = fakeEl('d', { attrs: { 'data-island': 'dance' } });
    slot.fire('click', { target: fakeTarget({ closest: { '[data-island]': send } }) });
    slot.fire('click', { target: fakeTarget({ closest: { '[data-island]': retry } }) });
    slot.fire('click', { target: fakeTarget({ closest: { '[data-island]': home } }) });
    slot.fire('click', { target: fakeTarget({ closest: { '[data-island]': other } }) });
    slot.fire('click', { target: fakeTarget({}) });
    expect(actions).toEqual(['send', 'retry', 'home']);
  });
});
