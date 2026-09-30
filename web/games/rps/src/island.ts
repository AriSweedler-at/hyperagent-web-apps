// From the game to the island (docs/design/rps-island.md §8, §11): the pairing row in
// `#islandSlot`. The owner: "the floating island will be what makes this super cool [...] This
// game should be playable from an android phone, they just wont see the buddy in the bar." So the
// row exists only on an iPhone whose catalogue row has a Dynamic Island (`hasIsland`), and only on
// an origin whose Worker answers `/api/rps/` (the probe: GitHub Pages has no Worker, and a Worker
// without its bindings answers 503, both of which leave the row empty). The pairing is a pure
// state machine: `reduceIsland` takes an event and returns the next state with the effects the
// edge runs (main.ts: the fetch, the named timers, sessionStorage), the way the round's reducer
// (ui/state.ts) does, so every rule below is a table test in island.test.ts and main.ts stays
// wiring. The states: `off` (nothing shown), `probing` (the boot's first GET), `idle` (the
// button), `waiting` (the clip was opened; a GET every POLL_MS until the Worker says paired, for
// POLL_MAX_MS), `stalled` ("still waiting" with a retry), `paired` (each save posts the mood; one
// post in flight, the latest round kept for after it; a 404 means the Worker forgot the pair, back
// to waiting; a 429 is the Worker's own 2 s spacing and is let go, the next round carries the
// score anyway). "Send buddy home" ends the session on this side alone: a fresh id, so the old
// pairing can never be reached again from here; the island's activity ends by itself (§8 step 8).
import {
  closestFrom,
  dataOf,
  listen,
  queryIn,
  removeElement,
  requireId,
  safeHtml,
  setHtml,
  appendHtml,
  type DocumentLike,
  type Element,
} from '../../../shared/edge/dom.ts';
import type { Store } from '../../../shared/edge/storage.ts';
import {
  SESSION_LENGTH,
  SMART_APP_BANNER_META,
  isSession,
  rpsClipUrl,
  sessionFrom,
  smartAppBanner,
} from '../../../shared/lib/appClip.ts';
import type { Device } from '../../../shared/lib/devices.ts';
import { moodOf, type Mood, type Progress } from './engine/engine.ts';

/** The Worker's routes on this origin (infra/games-proxy/rps-push.ts): same-origin, never proxied. */
export const PAIR_URL = '/api/rps/pair/';
export const MOOD_URL = '/api/rps/mood';
/** The poll's spacing and its patience: every 3 s, two minutes, then "still waiting". */
export const POLL_MS = 3_000;
export const POLL_MAX_MS = 120_000;
/** A round kept for after the post in flight waits this long: the Worker spaces pushes 2 s apart. */
export const FLUSH_MS = 2_000;
/** The sessionStorage key: the tab's pairing survives a reload, not a new tab. */
export const SESSION_KEY = 'rps_session';

// ---- The gate ------------------------------------------------------------------------------------

/** An iPhone with a Dynamic Island (the catalogue's `cut.island`; an Android hole is an island too, and Android never sees the row). */
export const hasIsland = (device: Device | null): boolean =>
  device !== null && device.kind === 'iphone' && device.cut?.island === true;

// ---- The session ---------------------------------------------------------------------------------

/** Eight random bytes; the default is the platform's `crypto.getRandomValues`. */
export type RandomBytes = (count: number) => ReadonlyArray<number>;
export const webRandomBytes: RandomBytes = (count) => [
  ...crypto.getRandomValues(new Uint8Array(count)),
];

/** A fresh session id: eight lowercase letters or digits (appClip.ts SESSION_ALPHABET). */
export const newSession = (random: RandomBytes = webRandomBytes): string =>
  sessionFrom(random(SESSION_LENGTH));

/** The remembered session, or null where there is none or it is not one. */
export const sessionOf = (store: Store): string | null => {
  const read = store.readText(SESSION_KEY);
  return read.ok && isSession(read.value) ? read.value : null;
};

/** Remember `session`, or forget it with null; a refusing store is not the player's problem. */
export const rememberSession = (store: Store, session: string | null): void => {
  if (session === null) store.remove(SESSION_KEY);
  else store.writeText(SESSION_KEY, session);
};

// ---- The state machine ---------------------------------------------------------------------------

/** The Worker's mood body (rps-push.ts `parseMood`): `at` is unix seconds. */
export type MoodBody = Readonly<{
  session: string;
  counter: number;
  prestige: number;
  band: Mood;
  at: number;
}>;

export type IslandState =
  | Readonly<{ kind: 'off' }>
  | Readonly<{ kind: 'probing'; session: string }>
  | Readonly<{ kind: 'idle'; session: string }>
  | Readonly<{ kind: 'waiting'; session: string; since: number }>
  | Readonly<{ kind: 'stalled'; session: string }>
  | Readonly<{ kind: 'paired'; session: string; inflight: boolean; pending: MoodBody | null }>;

/** What a GET of `/api/rps/pair/<session>` said: paired, not paired, or no Worker to ask (`absent`). */
export type PollAnswer = 'paired' | 'unpaired' | 'absent';

export type IslandEvent =
  /** The player tapped the link (the clip is opening); `at` in ms. */
  | Readonly<{ type: 'send'; at: number }>
  | Readonly<{ type: 'poll/result'; answer: PollAnswer; at: number }>
  | Readonly<{ type: 'poll/tick' }>
  | Readonly<{ type: 'retry'; at: number }>
  /** Send buddy home: a fresh session replaces the paired one. */
  | Readonly<{ type: 'home'; session: string }>
  /** A save (a verdict, Tech up, Reset); `at` in ms. */
  | Readonly<{ type: 'round'; progress: Progress; at: number }>
  | Readonly<{ type: 'post/done'; status: number; at: number }>
  | Readonly<{ type: 'flush' }>;

export type IslandTimerId = 'island/poll' | 'island/flush';

export type IslandEffect =
  | Readonly<{ kind: 'poll'; session: string }>
  | Readonly<{ kind: 'post'; body: MoodBody }>
  | Readonly<{ kind: 'timer'; id: IslandTimerId; ms: number }>
  | Readonly<{ kind: 'cancel'; id: IslandTimerId }>
  | Readonly<{ kind: 'remember'; session: string | null }>
  /** Just paired: post the page's current progress so the island shows the score, not the clip's start. */
  | Readonly<{ kind: 'sync' }>;

export type IslandStep = Readonly<{ state: IslandState; effects: ReadonlyArray<IslandEffect> }>;

export const OFF: IslandState = { kind: 'off' };

const step = (state: IslandState, ...effects: ReadonlyArray<IslandEffect>): IslandStep => ({
  state,
  effects,
});

/** The boot on an island iPhone: probe the origin for the Worker (and a remembered pairing). */
export const startIsland = (session: string): IslandStep =>
  step({ kind: 'probing', session }, { kind: 'poll', session });

const paired = (session: string): IslandState => ({
  kind: 'paired',
  session,
  inflight: false,
  pending: null,
});

const waiting = (session: string, since: number): IslandStep =>
  step({ kind: 'waiting', session, since }, { kind: 'poll', session });

/** The body a save posts: the counter, the prestige, the band, the instant in seconds. */
export const moodBody = (session: string, progress: Progress, atMs: number): MoodBody => ({
  session,
  counter: progress.counter,
  prestige: progress.prestige,
  band: moodOf(progress.counter),
  at: Math.floor(atMs / 1_000),
});

const CANCEL_ALL: ReadonlyArray<IslandEffect> = [
  { kind: 'cancel', id: 'island/poll' },
  { kind: 'cancel', id: 'island/flush' },
];

export const reduceIsland = (state: IslandState, event: IslandEvent): IslandStep => {
  if (event.type === 'home')
    return state.kind === 'off'
      ? step(state)
      : step({ kind: 'idle', session: event.session }, ...CANCEL_ALL, {
          kind: 'remember',
          session: event.session,
        });
  switch (state.kind) {
    case 'off':
      return step(state);
    case 'probing':
      if (event.type !== 'poll/result') return step(state);
      return event.answer === 'paired'
        ? step(paired(state.session), { kind: 'sync' })
        : event.answer === 'unpaired'
          ? step({ kind: 'idle', session: state.session })
          : step(OFF);
    case 'idle':
      return event.type === 'send' ? waiting(state.session, event.at) : step(state);
    case 'waiting':
      if (event.type === 'poll/tick') return step(state, { kind: 'poll', session: state.session });
      if (event.type !== 'poll/result') return step(state);
      if (event.answer === 'paired') return step(paired(state.session), { kind: 'sync' });
      return event.at - state.since >= POLL_MAX_MS
        ? step({ kind: 'stalled', session: state.session })
        : step(state, { kind: 'timer', id: 'island/poll', ms: POLL_MS });
    case 'stalled':
      return event.type === 'retry' ? waiting(state.session, event.at) : step(state);
    case 'paired':
      return reducePaired(state, event);
    default: {
      const never: never = state;
      return never;
    }
  }
};

type Paired = Extract<IslandState, { kind: 'paired' }>;

const reducePaired = (state: Paired, event: IslandEvent): IslandStep => {
  switch (event.type) {
    case 'round': {
      const body = moodBody(state.session, event.progress, event.at);
      return state.inflight
        ? step({ ...state, pending: body })
        : step({ ...state, inflight: true }, { kind: 'post', body });
    }
    case 'post/done':
      if (event.status === 404) return waiting(state.session, event.at);
      return state.pending === null
        ? step({ ...state, inflight: false })
        : step({ ...state, inflight: false }, { kind: 'timer', id: 'island/flush', ms: FLUSH_MS });
    case 'flush':
      return state.pending === null || state.inflight
        ? step(state)
        : step({ ...state, inflight: true, pending: null }, { kind: 'post', body: state.pending });
    case 'send':
    case 'poll/result':
    case 'poll/tick':
    case 'retry':
    case 'home':
      return step(state);
    default: {
      const never: never = event;
      return never;
    }
  }
};

// ---- The edge's pure halves ----------------------------------------------------------------------

/** What a poll's response means: a 200 `{paired}` is the Worker's answer; anything else, no Worker. */
export const pollAnswer = (status: number, body: unknown): PollAnswer => {
  if (status !== 200 || typeof body !== 'object' || body === null) return 'absent';
  const paired: unknown = (body as Readonly<Record<string, unknown>>)['paired'];
  return paired === true ? 'paired' : paired === false ? 'unpaired' : 'absent';
};

export const pairUrl = (session: string): string => `${PAIR_URL}${session}`;

// ---- The row -------------------------------------------------------------------------------------

export const ISLAND_IDS = { slot: 'islandSlot' } as const;

export const ISLAND_COPY = {
  send: 'Send buddy to your island',
  waiting: 'Buddy is on its way…',
  stalled: 'Still waiting for the buddy.',
  retry: 'Try again',
  paired: 'Buddy is in your island',
  home: 'Send buddy home',
  open: 'Open the clip again',
} as const;

/** The action a tap in the row means, from its `data-island`. */
export type IslandAction = 'send' | 'retry' | 'home';

const homeLink = safeHtml`<button class="link-btn island-home" type="button" data-island="home">${ISLAND_COPY.home}</button>`;

const rowMarkup = (state: IslandState) => {
  switch (state.kind) {
    case 'off':
    case 'probing':
      return safeHtml``;
    case 'idle':
      // A plain link: iOS shows the App Clip card for a registered URL; a new tab keeps the game.
      return safeHtml`<a class="btn btn-go island-send" data-island="send" href="${rpsClipUrl(state.session)}" target="_blank" rel="noopener">${ISLAND_COPY.send}</a>`;
    case 'waiting':
      return safeHtml`<p class="status island-status" role="status">${ISLAND_COPY.waiting}</p><a class="link-btn island-open" href="${rpsClipUrl(state.session)}" target="_blank" rel="noopener">${ISLAND_COPY.open}</a>${homeLink}`;
    case 'stalled':
      return safeHtml`<p class="status island-status" role="status">${ISLAND_COPY.stalled}</p><button class="btn island-retry" type="button" data-island="retry">${ISLAND_COPY.retry}</button>${homeLink}`;
    case 'paired':
      return safeHtml`<p class="status island-status" role="status">${ISLAND_COPY.paired}</p>${homeLink}`;
    default: {
      const never: never = state;
      return never;
    }
  }
};

/**
 * The Smart App Banner: on while the row is (Safari reads the tag at load, so the boot writes it
 * as soon as the device gate passes and the probe takes it back when there is no Worker).
 */
const paintBanner = (head: Element, state: IslandState): void => {
  const meta = queryIn(head, `meta[name="${SMART_APP_BANNER_META}"]`);
  if (state.kind === 'off') {
    if (meta !== null) removeElement(meta);
    return;
  }
  if (meta !== null) return;
  appendHtml(
    head,
    safeHtml`<meta name="${SMART_APP_BANNER_META}" content="${smartAppBanner(rpsClipUrl(state.session))}" />`,
  );
};

/** The row and the banner from the state; `head` is the document's `<head>`. */
export const paintIsland = (doc: DocumentLike, head: Element, state: IslandState): void => {
  setHtml(requireId(doc, ISLAND_IDS.slot), rowMarkup(state));
  paintBanner(head, state);
};

/** One delegated listener on the slot: the row is re-rendered per state, the listener stays. */
export const bindIsland = (doc: DocumentLike, act: (action: IslandAction) => void): void => {
  listen(requireId(doc, ISLAND_IDS.slot), 'click', (e) => {
    const target = closestFrom(e, '[data-island]');
    const action = target === null ? null : dataOf(target, 'island');
    if (action === 'send' || action === 'retry' || action === 'home') act(action);
  });
};
