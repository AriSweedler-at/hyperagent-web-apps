// The boot over fakes. The three helpers: the invite link against a recorded `history`, the share
// chain against the navigators the legacy page met (a sheet, a clipboard, neither, a dismissed
// sheet) with the toast landing on the fake page, and the session adapters against a recording
// dispatch, then through a real host and a real guest session on the fake broker
// (sessions.harness.ts). Then `bootShell` (docs/design/shared-shell.md §5 C3) over the page fake, a
// fake window, navigator, store and clock, and a FAKE game whose reducer records every intent and
// whose effect runner hands each shell effect to the adapter the boot built, so what the two
// main.ts files wired by hand is pinned once: the boot order, the no-repaint rule, every adapter's
// reach into the page, the sessions' construction, the documented hook and the two links.
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  INVITE_COPIED_MSG,
  SHARE_FALLBACK_MS,
  applyInviteLink,
  bootShell,
  fetchArrayBuffer,
  roomCodeMsg,
  sessionEvents,
  shareInvite,
  type BootConfig,
  type BootCtx,
  type BootDocumentLike,
  type BootWindowLike,
  type FxDepsOf,
  type GuestDepsOf,
  type GuestOptionsOf,
  type HostDepsOf,
  type HostOptionsOf,
  type InviteWindowLike,
  type SessionEventDeps,
  type SessionIntent,
} from './boot.ts';
import { fakeClock } from './clock.fake.ts';
import { realClock } from './clock.ts';
import type { CuePlayer } from './cuePlayer.ts';
import type { NavigatorLike } from './fx.ts';
import { RULE_FLASH_CLASS } from './glossary.ts';
import { fakeEl, fakePage, fakeTarget, type FakeEl } from './page.fake.ts';
import type { ShareNavigatorLike, SharePayload } from './share.ts';
import { createStore, type Store } from './storage.ts';
import { err } from '../lib/result.ts';
import { mulberry32 } from '../lib/rng.ts';
import { badSoundFontMsg, type SoundFontName } from '../lib/sound/fonts.ts';
import { GUEST_WATCHDOG_MSG, GuestSession, type GuestCodec } from '../net/guest.ts';
import { HostSession, WAITING_MSG, type HostCodec } from '../net/host.ts';
import { CODE, cell, guestCtx, hostCtxFor, settle, world } from '../net/sessions.harness.ts';
import { WATCHDOG_MS } from './peer.ts';
import type { RecentGame } from '../lib/recentGames.ts';
import type { Ctx, Effect, GuestFrameOf, HomeSnapshot, HostFrameOf, Intent } from '../ui/shell.ts';
import { SHELL_CUES } from '../lib/sound/cues.ts';
import type { Phrase } from '../lib/sound/phrase.ts';
import type { ShellEffectDeps } from '../ui/shellEffects.ts';
import { TOAST_MS, createToaster, type Toast } from '../ui/toast.ts';

// ---- the invite link ------------------------------------------------------------------------

type Replaced = readonly [null, string, string];

/** A page at `/gin-rummy/` with `search` and `hash` in its address bar, its `replaceState` calls kept. */
const pageAt = (
  search: string,
  hash = '',
): Readonly<{
  win: InviteWindowLike;
  replaced: ReadonlyArray<Replaced>;
  joins: ReadonlyArray<string>;
}> => {
  const replaced: Replaced[] = [];
  const joins: string[] = [];
  const win: InviteWindowLike = {
    location: { search, pathname: '/gin-rummy/', hash },
    history: {
      replaceState: (data, unused, url) => {
        replaced.push([data, unused, url]);
      },
    },
  };
  applyInviteLink(win, (code) => {
    joins.push(code);
  });
  return { win, replaced, joins };
};

/** The harness's hook query (e2e/fixtures/player.ts `gameQuery`), which the rewrite must keep. */
const HOOKS =
  'peer=127.0.0.1%3A9000&ice=http%3A%2F%2F127.0.0.1%3A4173%2Fhyperagent-web-apps%2Fe2e-ice.json';

describe('applyInviteLink', () => {
  test('no join: nothing dispatched, the address bar untouched', () => {
    expect(pageAt('')).toMatchObject({ replaced: [], joins: [] });
    expect(pageAt(`?${HOOKS}`, '#rule-knock')).toMatchObject({ replaced: [], joins: [] });
  });

  test('the code goes to the join form and leaves the address bar; the page path alone remains', () => {
    const { replaced, joins } = pageAt('?join=KQZM');
    expect(joins).toEqual(['KQZM']);
    expect(replaced).toEqual([[null, '', '/gin-rummy/']]);
  });

  test('the other hooks and the hash stay, serialised as the platform does', () => {
    const { replaced, joins } = pageAt(
      `?peer=127.0.0.1:9000&join=kqzm&ice=${HOOKS.split('ice=')[1] ?? ''}`,
      '#rule-knock',
    );
    expect(joins).toEqual(['kqzm']);
    expect(replaced).toEqual([[null, '', `/gin-rummy/?${HOOKS}#rule-knock`]]);
  });

  test('an empty join is still a join, as the platform reads it', () => {
    const { replaced, joins } = pageAt('?join=&x=1');
    expect(joins).toEqual(['']);
    expect(replaced).toEqual([[null, '', '/gin-rummy/?x=1']]);
  });
});

// ---- the share chain ------------------------------------------------------------------------

type ToastCall = readonly [string, number | null | undefined];
const PAGE_URL = 'https://games.sweedler.com/gin-rummy/';
const INVITE = `${PAGE_URL}?join=ABCD`;

const toastSpy = (): Readonly<{ calls: ReadonlyArray<ToastCall>; toast: Toast }> => {
  const calls: ToastCall[] = [];
  return {
    calls,
    toast: (m, ms) => {
      calls.push([m, ms]);
    },
  };
};

const share = (nav: ShareNavigatorLike, toast: Toast): Promise<void> =>
  shareInvite(nav, { title: 'Gin Rummy', code: 'ABCD', pageUrl: PAGE_URL, toast });

describe('shareInvite', () => {
  test('the sheet gets the title and the link alone, no text; nothing is toasted', async () => {
    const shared: SharePayload[] = [];
    const t = toastSpy();
    await share(
      {
        share: (p) => {
          shared.push(p);
          return Promise.resolve();
        },
        clipboard: { writeText: () => Promise.reject(new Error('unused')) },
      },
      t.toast,
    );
    expect(shared).toEqual([{ title: 'Gin Rummy', url: INVITE }]);
    expect(t.calls).toEqual([]);
  });

  test('no sheet: the clipboard gets the link and the page says so at the default duration', async () => {
    const copied: string[] = [];
    const t = toastSpy();
    await share(
      {
        clipboard: {
          writeText: (text) => {
            copied.push(text);
            return Promise.resolve();
          },
        },
      },
      t.toast,
    );
    expect(copied).toEqual([INVITE]);
    expect(t.calls).toEqual([[INVITE_COPIED_MSG, null]]);
    expect(INVITE_COPIED_MSG).toBe('Invite copied to clipboard');
  });

  test('neither: the code itself, for the player to read out, for SHARE_FALLBACK_MS', async () => {
    const t = toastSpy();
    await share({}, t.toast);
    expect(t.calls).toEqual([[roomCodeMsg('ABCD'), SHARE_FALLBACK_MS]]);
    expect(roomCodeMsg('ABCD')).toBe('Room code: ABCD');
    expect(SHARE_FALLBACK_MS).toBe(4000);
  });

  test('a dismissed sheet is silent: no clipboard, no toast', async () => {
    const t = toastSpy();
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    await share(
      {
        share: () => Promise.reject(abort),
        clipboard: { writeText: () => Promise.reject(new Error('unused')) },
      },
      t.toast,
    );
    expect(t.calls).toEqual([]);
  });

  test('on the page: the copied toast shows for the default, the fallback for its own length', async () => {
    const clock = fakeClock();
    const p = fakePage([fakeEl('toast')]);
    const toast = createToaster(p.doc, clock);
    await share({ clipboard: { writeText: () => Promise.resolve() } }, toast);
    expect(p.get('toast').text()).toBe('Invite copied to clipboard');
    expect(p.get('toast').hasClass('show')).toBe(true);
    clock.advance(TOAST_MS);
    expect(p.get('toast').hasClass('show')).toBe(false);
    await share({}, toast);
    expect(p.get('toast').text()).toBe('Room code: ABCD');
    clock.advance(TOAST_MS);
    expect(p.get('toast').hasClass('show')).toBe(true);
    clock.advance(SHARE_FALLBACK_MS - TOAST_MS);
    expect(p.get('toast').hasClass('show')).toBe(false);
  });
});

// ---- the sessions' events -------------------------------------------------------------------

type GuestFrame = Readonly<{ t: 'join' }>;
type HostFrame = Readonly<{ t: 'welcome' }>;

/** A recording dispatch, toast and wake lock, as main.ts wires the adapters. */
const recorder = (): Readonly<{
  deps: SessionEventDeps<GuestFrame, HostFrame>;
  intents: ReadonlyArray<SessionIntent<GuestFrame, HostFrame>>;
  toasts: ReadonlyArray<ToastCall>;
  holds: () => number;
}> => {
  const intents: SessionIntent<GuestFrame, HostFrame>[] = [];
  const toasts: ToastCall[] = [];
  const held = { count: 0 };
  return {
    deps: {
      dispatch: (intent) => {
        intents.push(intent);
      },
      toast: (m, ms) => {
        toasts.push([m, ms]);
      },
      wakeLock: {
        hold: () => {
          held.count += 1;
          return Promise.resolve();
        },
      },
    },
    intents,
    toasts,
    holds: () => held.count,
  };
};

describe('sessionEvents', () => {
  test('every host event is its intent; stopPulse defaults to false; an absent ms is the default toast', () => {
    const r = recorder();
    const { host } = sessionEvents(r.deps);
    host.status('Opening room…');
    host.status('Waiting…', true);
    host.toast('Connected directly');
    host.toast('Code busy', 4000);
    host.holdWakeLock();
    host.persist();
    host.restart(null);
    host.restart('ABCD');
    // The session names the seat (1 at capacity 2); the two-seat adapter takes the frame alone.
    host.frame({ t: 'join' }, 1);
    host.guestGone(null, 1);
    host.guestGone('ICE failed', 1);
    expect(r.intents).toEqual([
      { type: 'host/status', text: 'Opening room…', stopPulse: false },
      { type: 'host/status', text: 'Waiting…', stopPulse: true },
      { type: 'persist' },
      { type: 'host/start', code: null },
      { type: 'host/start', code: 'ABCD' },
      { type: 'host/frame', frame: { t: 'join' } },
      { type: 'host/guestGone', iceFailed: null },
      { type: 'host/guestGone', iceFailed: 'ICE failed' },
    ]);
    expect(r.toasts).toEqual([
      ['Connected directly', null],
      ['Code busy', 4000],
    ]);
    expect(r.holds()).toBe(1);
  });

  test('every guest event is its intent', () => {
    const r = recorder();
    const { guest } = sessionEvents(r.deps);
    guest.status('Connecting…');
    guest.status('Found the service', true);
    guest.toast('Via relay');
    guest.toast('Stalled', 12000);
    guest.holdWakeLock();
    guest.persist();
    guest.connected();
    guest.frame({ t: 'welcome' });
    guest.lost();
    expect(r.intents).toEqual([
      { type: 'guest/status', text: 'Connecting…', stopPulse: false },
      { type: 'guest/status', text: 'Found the service', stopPulse: true },
      { type: 'persist' },
      { type: 'guest/connected' },
      { type: 'guest/frame', frame: { t: 'welcome' } },
      { type: 'guest/lost' },
    ]);
    expect(r.toasts).toEqual([
      ['Via relay', null],
      ['Stalled', 12000],
    ]);
    expect(r.holds()).toBe(1);
  });

  test('through a real host session on the fake broker: the wake lock, then the waiting status and a persist', () => {
    type Room = Readonly<{ size: number }>;
    const codec: HostCodec<GuestFrame, HostFrame, Room> = {
      decode: () => err('none'),
      welcome: () => ({ t: 'welcome' }),
      full: () => ({ t: 'welcome' }),
    };
    const w = world();
    const r = recorder();
    const { host } = sessionEvents(r.deps);
    const ctx = cell(hostCtxFor<Room>({ size: 100 })());
    new HostSession({ ...w.deps, read: ctx.read, events: host }, codec, {
      game: 'gin-rummy',
      code: CODE,
      attempt: 1,
      resume: false,
    });
    expect(r.holds()).toBe(1);
    expect(r.intents).toEqual([]);
    w.broker.flush();
    expect(r.intents).toEqual([
      { type: 'host/status', text: WAITING_MSG, stopPulse: false },
      { type: 'persist' },
    ]);
  });

  test('through a real guest session: the wake lock at once, the watchdog status when nobody answers', () => {
    const codec: GuestCodec<GuestFrame, HostFrame> = {
      decode: () => err('none'),
      join: () => ({ t: 'join' }),
    };
    const w = world();
    const r = recorder();
    const { guest } = sessionEvents(r.deps);
    const ctx = cell(guestCtx());
    new GuestSession({ ...w.deps, read: ctx.read, events: guest }, codec, {
      game: 'gin-rummy',
      code: CODE,
      attempt: 1,
    });
    expect(r.holds()).toBe(1);
    expect(r.intents).toEqual([]);
    w.clock.advance(WATCHDOG_MS);
    expect(r.intents).toEqual([
      { type: 'guest/status', text: GUEST_WATCHDOG_MSG, stopPulse: false },
    ]);
  });
});

// ---- the boot ---------------------------------------------------------------------------------

type View = Readonly<{ seat: number }>;
type Action = Readonly<{ move: number }>;
type OwnEffect = Readonly<{ type: 'own'; tag: string }>;
/** `step` runs the effects the test queued (`Boot.run`) and changes the App when told to. */
type OwnIntent = Readonly<{ type: 'step'; change?: boolean }>;
type Fake = Readonly<{
  Opts: Readonly<{ level: number }>;
  Raw: Readonly<{ level?: string }>;
  State: Readonly<{ n: number }>;
  View: View;
  Action: Action;
  Table: Readonly<{ curtain: null }>;
  Tab: 'about';
  Mode: never;
  Screen: 'ownScreen';
  Timer: 'beat';
  Cue: 'ding';
  Cues: null;
  Resume: never;
  Home: Readonly<{ extra: string }>;
  Intent: OwnIntent;
  Effect: OwnEffect;
  Store: Store;
}>;
type FakeIntent = Intent<Fake>;
type FakeEffect = Effect<Fake>;
type HostFrame2 = HostFrameOf<Fake>;
type GuestFrame2 = GuestFrameOf<Fake>;
/** The App the boot reads two fields of; `home` and `steps` show the reducer ran. */
type App = Readonly<{
  shell: Readonly<{
    soundFont: SoundFontName;
    view: View | null;
    recentGames: ReadonlyArray<RecentGame>;
  }>;
  home: HomeSnapshot<Fake> | null;
  steps: number;
}>;
type Extra = Readonly<{ own: (tag: string) => void }>;
type Deps = ShellEffectDeps<Fake> & Extra;

const SOUND_KEY = 'fake_sound';
const FONT_KEY = 'fake_soundFont';
const HOME: HomeSnapshot<Fake> = {
  name: 'Ari',
  p2Name: null,
  homeTab: 'play',
  playMode: 'online',
  soundFont: 'default',
  save: null,
  recentGames: [],
  extra: 'x',
};
const VIEW: View = { seat: 1 };
const FULL: HostFrame2 = { t: 'full' };
const JOIN: GuestFrame2 = { t: 'join', name: 'Jeff' };
const isGuestFrame = (frame: HostFrame2 | GuestFrame2): frame is GuestFrame2 =>
  frame.t === 'join' || frame.t === 'action';

/** A `Store` over a Map, as the page's localStorage would be. */
const mapStore = (initial: Readonly<Record<string, string>> = {}): Store => {
  const m = new Map(Object.entries(initial));
  return createStore({
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  });
};

class FakeHost {
  readonly kind = 'host' as const;
  readonly deps: HostDepsOf<Fake>;
  readonly opts: HostOptionsOf;
  readonly sent: HostFrame2[] = [];
  closed = 0;
  constructor(deps: HostDepsOf<Fake>, opts: HostOptionsOf) {
    this.deps = deps;
    this.opts = opts;
  }
  send(frame: HostFrame2): void {
    this.sent.push(frame);
  }
  close(): void {
    this.closed += 1;
  }
}
class FakeGuest {
  readonly kind = 'guest' as const;
  readonly deps: GuestDepsOf<Fake>;
  readonly opts: GuestOptionsOf;
  readonly sent: GuestFrame2[] = [];
  closed = 0;
  constructor(deps: GuestDepsOf<Fake>, opts: GuestOptionsOf) {
    this.deps = deps;
    this.opts = opts;
  }
  send(frame: GuestFrame2): void {
    this.sent.push(frame);
  }
  close(): void {
    this.closed += 1;
  }
}
/** `window.AudioContext` as the boot constructs it: only `state` is read on `warm`. */
class FakeAudioContext {
  static made = 0;
  readonly state = 'running';
  constructor() {
    FakeAudioContext.made += 1;
  }
}

type Options = Readonly<{
  search?: string;
  hash?: string;
  stored?: Readonly<Record<string, string>>;
  audio?: boolean;
  /** The window answers `matchMedia('(pointer: coarse)')` with this (a phone: true); none, no `matchMedia` at all. */
  coarse?: boolean;
  confirm?: boolean;
  /** No `window.__rng` installed: the boot falls back to `Math.random`. */
  unseeded?: boolean;
  /** The game's own hooks, as gin passes them, over the log so a test can see the order they ran in. */
  hooks?: (log: Log) => NonNullable<BootConfig<Fake, App, Extra>['hooks']>;
}>;

type Log = Readonly<{
  /** Every step of the boot in the order it ran: the hooks, the binders, the sound paint, the hook and each intent. */
  order: string[];
  intents: FakeIntent[];
  ctx: (readonly [number, number])[];
  ran: (readonly [string, number])[];
  paints: App[];
  sounds: boolean[];
  inputs: (readonly [string, string])[];
  confirms: string[];
  scrolls: (readonly [number, number])[];
  replaced: string[];
  copied: string[];
  buzzes: (number | ReadonlyArray<number>)[];
  /** `play(event, font)` as `[event, font]`; `playPhrases(phrases, font)` as `[phrases, font]`. */
  plays: (readonly [string | ReadonlyArray<Phrase>, SoundFontName])[];
  toggles: SoundFontName[];
  own: string[];
  hosts: FakeHost[];
  guests: FakeGuest[];
  warms: { count: number; fonts: (SoundFontName | undefined)[] };
  /** Every document listener the boot bound, with its options. */
  listeners: (readonly [string, unknown])[];
  /** Every `matchMedia` query the boot asked the window. */
  queries: string[];
  /** The `fallback` each `cfg.sound.enabled(store, fallback)` call carried. */
  fallbacks: boolean[];
}>;

/** One booted page: what the boot was given, and everything it touched, recorded. */
const bootPage = (options: Options = {}) => {
  const clock = fakeClock();
  const store = mapStore(options.stored);
  /** The one rule in the rules slot, for the reveal. */
  const ruleEl: FakeEl = fakeEl('rule-knock');
  const p = fakePage([
    fakeEl('toast'),
    fakeEl('soundBtn'),
    fakeEl('rulesList', { queries: { '#rule-knock': [ruleEl] } }),
  ]);
  const visibility = { state: 'visible' };
  const log: Log = {
    order: [],
    intents: [],
    ctx: [],
    ran: [],
    paints: [],
    sounds: [],
    inputs: [],
    confirms: [],
    scrolls: [],
    replaced: [],
    copied: [],
    buzzes: [],
    plays: [],
    toggles: [],
    own: [],
    hosts: [],
    guests: [],
    warms: { count: 0, fonts: [] },
    listeners: [],
    queries: [],
    fallbacks: [],
  };
  const doc: BootDocumentLike = {
    getElementById: p.doc.getElementById,
    body: p.doc.body,
    // Recorded with its options: the audio gestures must be bound without `passive` (§12).
    addEventListener: (type, fn, options) => {
      log.listeners.push([type, options]);
      p.doc.addEventListener(type, fn);
    },
    get visibilityState() {
      return visibility.state;
    },
  };
  const pending = { effects: [] as ReadonlyArray<FakeEffect> };
  const win: BootWindowLike & Record<string, unknown> = {
    location: {
      search: options.search ?? '',
      pathname: '/fake/',
      hash: options.hash ?? '',
      origin: 'https://games.sweedler.com',
    },
    history: {
      replaceState: (_data, _unused, url) => {
        log.replaced.push(url);
      },
    },
    confirm: (message) => {
      log.confirms.push(message);
      return options.confirm ?? true;
    },
    scrollTo: (x, y) => {
      log.scrolls.push([x, y]);
    },
    fetch: (url) =>
      Promise.resolve({
        ok: url !== 'missing.wav',
        status: 404,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(3)),
      }),
    ...(options.unseeded === true ? {} : { __rng: mulberry32(7) }),
    ...(options.audio === true ? { AudioContext: FakeAudioContext } : {}),
    ...(options.coarse === undefined
      ? {}
      : {
          matchMedia: (query: string) => {
            log.queries.push(query);
            return { matches: options.coarse === true };
          },
        }),
  };
  const nav: NavigatorLike & ShareNavigatorLike = {
    vibrate: (pattern) => {
      log.buzzes.push(pattern);
      return true;
    },
    clipboard: {
      writeText: (text) => {
        log.copied.push(text);
        return Promise.resolve();
      },
    },
  };
  const initialApp: App = {
    shell: { soundFont: 'default', view: null, recentGames: [] },
    home: null,
    steps: 0,
  };
  const reduce = (
    app: App,
    intent: FakeIntent,
    ctx: Ctx,
  ): Readonly<{ app: App; effects: ReadonlyArray<FakeEffect> }> => {
    log.intents.push(intent);
    log.order.push(`intent:${intent.type}`);
    log.ctx.push([ctx.rng(), ctx.now()]);
    if (intent.type === 'home/init') return { app: { ...app, home: intent.home }, effects: [] };
    if (intent.type === 'soundFont/set') {
      return { app: { ...app, shell: { ...app.shell, soundFont: intent.font } }, effects: [] };
    }
    if (intent.type === 'render') {
      return { app: { ...app, shell: { ...app.shell, view: VIEW } }, effects: [] };
    }
    if (intent.type === 'step') {
      return {
        app: intent.change === true ? { ...app, steps: app.steps + 1 } : app,
        effects: pending.effects,
      };
    }
    return { app, effects: [] };
  };
  /** Each shell effect the tests queue, against the adapter the boot built for it (shellEffects.ts's cases, the ones a boot adapter answers). */
  const runEffect = (app: App, effect: FakeEffect, deps: Deps): void => {
    log.ran.push([effect.type, app.steps]);
    if (effect.type === 'toast') deps.toast(effect.message, effect.ms);
    else if (effect.type === 'confirm') {
      if (deps.confirm(effect.message)) deps.dispatch(effect.then);
    } else if (effect.type === 'then') deps.dispatch(effect.intent);
    else if (effect.type === 'scrollTop') deps.scrollTop();
    else if (effect.type === 'startTimer') deps.timers.start(effect.id, effect.ms, effect.then);
    else if (effect.type === 'cancelTimer') deps.timers.cancel(effect.id);
    else if (effect.type === 'toggleSound') deps.toggleSound();
    else if (effect.type === 'share') deps.share(effect.code);
    else if (effect.type === 'fx') deps.fx(effect.cue, app.shell.soundFont);
    else if (effect.type === 'phrases') deps.fx(effect.phrases, app.shell.soundFont);
    else if (effect.type === 'wakeLock') deps.wakeLock(effect.hold);
    else if (effect.type === 'startHost')
      deps.net.startHost(effect.code, effect.attempt, effect.resume);
    else if (effect.type === 'startGuest') deps.net.startGuest(effect.code, effect.attempt);
    else if (effect.type === 'send') deps.net.send(effect.frame);
    else if (effect.type === 'closeNet') deps.net.close();
    else if (effect.type === 'fillName') deps.page.fillName(effect.name, effect.default === true);
    else if (effect.type === 'fillP2Name')
      deps.page.fillP2Name(effect.name, effect.default === true);
    else if (effect.type === 'setCode') deps.page.setCode(effect.value);
    else if (effect.type === 'revealRule') deps.revealRule(effect.slot, effect.rule);
    else if (effect.type === 'own') deps.own(effect.tag);
  };
  const fxDeps = { value: null as FxDepsOf<Fake> | null };
  const fx = (deps: FxDepsOf<Fake>): CuePlayer<'tap' | 'yourTurn' | 'ding'> => {
    fxDeps.value = deps;
    const on = { value: deps.audio.enabled() };
    return {
      play: (event, font) => {
        log.plays.push([event, font]);
      },
      playPhrases: (phrases, font) => {
        log.plays.push([phrases, font]);
      },
      toggle: (font) => {
        on.value = !on.value;
        log.toggles.push(font);
        deps.onToggle(on.value);
      },
      enabled: () => on.value,
      warm: (font) => {
        log.warms.count += 1;
        log.warms.fonts.push(font);
      },
    };
  };
  const cfg: BootConfig<Fake, App, Extra> = {
    page: { doc, win, nav, store, clock },
    game: { hook: '__fake', title: 'Fake', debug: 0 },
    // prefs.ts `soundPref.enabled`: a stored 'on'/'off' wins; otherwise the boot's fallback.
    sound: {
      enabled: (s, fallback) => {
        log.fallbacks.push(fallback);
        const stored = s.readText(SOUND_KEY);
        return stored.ok ? stored.value === 'on' : fallback;
      },
      fontKey: FONT_KEY,
    },
    reducer: {
      initialApp,
      reduce,
      runEffect,
      readHome: () => HOME,
      hostContextOf: (app) => ({
        attempt: app.steps,
        role: 'host',
        code: 'ABCD',
        myName: 'Ari',
        level: 3,
        hasGame: false,
        handoff: false,
        oppName: null,
        oppConnected: false,
      }),
      guestContextOf: (app) => ({
        attempt: app.steps,
        role: 'guest',
        code: 'ABCD',
        myName: 'Jeff',
        oppConnected: false,
      }),
    },
    paint: {
      paint: (_doc, app) => {
        log.paints.push(app);
      },
      bindAll: (d) => {
        log.order.push(d === doc ? 'bindAll' : 'bindAll:other document');
      },
      paintSound: (_doc, enabled) => {
        log.order.push('paintSound');
        log.sounds.push(enabled);
      },
      toastMarks: (message) => ({ hit: message.startsWith('Hit') }),
      // The default mark (shell.ts `fillName.default`) arrives as the flag; logged as `:default`.
      fillName: (_doc, name, isDefault) => {
        log.inputs.push([isDefault ? 'name:default' : 'name', name]);
      },
      fillP2Name: (_doc, name, isDefault) => {
        log.inputs.push([isDefault ? 'p2:default' : 'p2', name]);
      },
      setCode: (_doc, value) => {
        log.inputs.push(['code', value]);
      },
    },
    fx,
    net: {
      Host: class extends FakeHost {
        constructor(deps: HostDepsOf<Fake>, opts: HostOptionsOf) {
          super(deps, opts);
          log.hosts.push(this);
        }
      },
      Guest: class extends FakeGuest {
        constructor(deps: GuestDepsOf<Fake>, opts: GuestOptionsOf) {
          super(deps, opts);
          log.guests.push(this);
        }
      },
      isGuestFrame,
    },
    legal: (view) => [{ move: view.seat }],
    deps: {
      own: (tag) => {
        log.own.push(tag);
      },
    },
    ...(options.hooks === undefined ? {} : { hooks: options.hooks(log) }),
  };
  const boot = bootShell(cfg);
  /** Dispatch one `step` that runs `effects`; `change` makes the reducer return a new App. */
  const run = (effects: ReadonlyArray<FakeEffect>, change = false): void => {
    pending.effects = effects;
    boot.dispatch({ type: 'step', ...(change ? { change } : {}) });
  };
  const hook = (): Readonly<Record<string, unknown>> =>
    win['__fake'] as Readonly<Record<string, unknown>>;
  return { boot, run, hook, log, p, ruleEl, clock, store, win, visibility, fxDeps };
};

/** The types of the intents the reducer saw. */
const seen = (b: ReturnType<typeof bootPage>): ReadonlyArray<string> =>
  b.log.intents.map((i) => i.type);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bootShell', () => {
  test('the boot order: the game renders, the binders bind, the game binds, the sound button paints, the hook, then home/init, the invite link and the rule link', () => {
    const b = bootPage({
      search: '?join=KQZM&peer=127.0.0.1%3A9000',
      hash: '#rule-knock',
      hooks: (log) => ({
        render: (ctx) => {
          log.order.push(`render:${String(ctx.app().steps)}`);
        },
        bind: () => {
          log.order.push('bind');
        },
        hook: () => {
          log.order.push('hook');
          return {};
        },
      }),
    });
    expect(b.log.order).toEqual([
      'render:0',
      'bindAll',
      'bind',
      'paintSound',
      'hook',
      'intent:home/init',
      'intent:join/link',
      'intent:resume/auto',
      'intent:rules/show',
    ]);
    expect(b.log.sounds).toEqual([true]);
    expect(b.log.intents[0]).toEqual({ type: 'home/init', home: HOME });
    expect(b.log.intents[1]).toEqual({ type: 'join/link', code: 'KQZM' });
    // The lobby's own resume comes after the link (docs/design/lobby-resume.md D4), before the rule.
    expect(b.log.intents[2]).toEqual({ type: 'resume/auto' });
    expect(b.log.intents[3]).toEqual({ type: 'rules/show', rule: 'knock' });
    // The invite left the address bar, the other hook and the hash kept.
    expect(b.log.replaced).toEqual(['/fake/?peer=127.0.0.1%3A9000#rule-knock']);
    expect(b.boot.app().home).toEqual(HOME);
    // A tap on a jargon link anywhere on the page (web/shared/edge/glossary.ts) shows its rule.
    const jargon = fakeEl('j', { attrs: { 'data-rule': 'undercut' } });
    b.p.fire('click', { target: fakeTarget({ closest: { 'a.jargon': jargon } }) });
    expect(b.log.intents.at(-1)).toEqual({ type: 'rules/show', rule: 'undercut' });
    // A bare page without hooks: home/init, then the lobby's own resume.
    expect(bootPage().log.order).toEqual([
      'bindAll',
      'paintSound',
      'intent:home/init',
      'intent:resume/auto',
    ]);
  });

  test("the hook: the shared members, the getter app, the game's own members after them", () => {
    const b = bootPage({
      hooks: () => ({
        hook: ({ app, dispatch }) => ({
          act: (action: Action) => {
            dispatch({ type: 'step', change: action.move > 0 });
          },
          view: () => app().shell.view,
        }),
      }),
    });
    const hook = b.hook();
    expect(Object.keys(hook)).toEqual([
      'app',
      'dispatch',
      'render',
      'showScreen',
      'initHome',
      'fx',
      'legal',
      'soundFont',
      'soundFontName',
      'recentGames',
      'act',
      'view',
    ]);
    // The finished games, as the shell state holds them (the history sheet's list).
    expect((hook['recentGames'] as () => unknown)()).toEqual([]);
    // `app` is live: a step that changes the App is seen through it.
    expect(hook['app']).toBe(b.boot.app());
    (hook['act'] as (a: Action) => void)({ move: 1 });
    expect((hook['app'] as App).steps).toBe(1);
    expect(hook['app']).toBe(b.boot.app());
    expect(hook['fx']).toBe(b.boot.fx);
    expect(hook['dispatch']).toBe(b.boot.dispatch);
    // `legal` is the engine's for my view, nothing without one; `render`, `showScreen` and
    // `initHome` are their intents (initHome re-reads the snapshot).
    expect((hook['legal'] as () => ReadonlyArray<Action>)()).toEqual([]);
    (hook['render'] as () => void)();
    expect((hook['view'] as () => View | null)()).toEqual(VIEW);
    expect((hook['legal'] as () => ReadonlyArray<Action>)()).toEqual([{ move: 1 }]);
    (hook['showScreen'] as (s: string) => void)('ownScreen');
    (hook['initHome'] as () => void)();
    expect(seen(b).slice(-4)).toEqual(['step', 'render', 'screen/show', 'home/init']);
    expect(b.log.intents.at(-2)).toEqual({ type: 'screen/show', screen: 'ownScreen' });
    expect(b.log.intents.at(-1)).toEqual({ type: 'home/init', home: HOME });
  });

  test("the sound font hook: a font is dispatched, anything else logged under the page's key and refused", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = bootPage();
    const hook = b.hook();
    expect((hook['soundFontName'] as () => string)()).toBe('default');
    (hook['soundFont'] as (n: string) => void)('felt');
    expect((hook['soundFontName'] as () => string)()).toBe('felt');
    expect(b.log.intents.at(-1)).toEqual({ type: 'soundFont/set', font: 'felt' });
    (hook['soundFont'] as (n: string) => void)('plaid');
    expect((hook['soundFontName'] as () => string)()).toBe('felt');
    expect(error.mock.calls).toEqual([[badSoundFontMsg(FONT_KEY, 'plaid')]]);
  });

  test("the home read: a stored font that names none is logged and dropped, after the game's own guard", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const guarded: string[] = [];
    const b = bootPage({
      stored: { [FONT_KEY]: 'tartan' },
      hooks: () => ({
        home: (store) => {
          guarded.push(store.readText(FONT_KEY).ok ? 'font still there' : 'gone');
        },
      }),
    });
    expect(guarded).toEqual(['font still there']);
    expect(error.mock.calls).toEqual([[badSoundFontMsg(FONT_KEY, 'tartan')]]);
    expect(b.store.readText(FONT_KEY).ok).toBe(false);
    // Every later read runs the guard again and logs nothing more.
    b.boot.homeSnapshot();
    expect(guarded).toEqual(['font still there', 'gone']);
    expect(error.mock.calls).toHaveLength(1);
  });

  test('dispatch: the reducer gets the seeded rng and the clock; an unchanged App paints nothing, a changed one paints once after the effects ran against it', () => {
    const b = bootPage();
    const rng = mulberry32(7);
    // Two intents at boot (home/init, resume/auto), each reduced with the seeded rng and the clock.
    expect(b.log.ctx).toEqual([
      [rng(), b.clock.now()],
      [rng(), b.clock.now()],
    ]);
    expect(b.log.paints).toHaveLength(1);
    b.run([{ type: 'own', tag: 'a' }]);
    expect(b.log.paints).toHaveLength(1);
    expect(b.log.own).toEqual(['a']);
    b.run([{ type: 'own', tag: 'b' }], true);
    expect(b.log.paints).toHaveLength(2);
    expect(b.log.paints[1]?.steps).toBe(1);
    // `runEffect` saw the App after the step (steps 1), before the paint.
    expect(b.log.ran.at(-1)).toEqual(['own', 1]);
    // The `then` effect and a `confirm` the player accepts dispatch through the same path.
    b.run([
      { type: 'then', intent: { type: 'render' } },
      { type: 'confirm', message: 'Sure?', then: { type: 'visible' } },
    ]);
    expect(seen(b).slice(-3)).toEqual(['step', 'render', 'visible']);
    expect(b.log.confirms).toEqual(['Sure?']);
    // A refused confirm dispatches nothing.
    const refused = bootPage({ confirm: false });
    refused.run([{ type: 'confirm', message: 'Leave?', then: { type: 'render' } }]);
    expect(seen(refused)).toEqual(['home/init', 'resume/auto', 'step']);
  });

  test("the page adapters: the toast with the game's marks, scrollTop, the three input writes, the rule reveal", () => {
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
      fn();
      return 0;
    });
    const b = bootPage();
    b.run([{ type: 'toast', message: 'Hit!', ms: null }]);
    expect(b.p.get('toast').text()).toBe('Hit!');
    expect(b.p.get('toast').hasClass('hit')).toBe(true);
    expect(b.p.get('toast').hasClass('show')).toBe(true);
    b.clock.advance(TOAST_MS);
    expect(b.p.get('toast').hasClass('show')).toBe(false);
    b.run([{ type: 'toast', message: 'Plain', ms: 100 }]);
    expect(b.p.get('toast').hasClass('hit')).toBe(false);
    b.clock.advance(100);
    expect(b.p.get('toast').hasClass('show')).toBe(false);
    b.run([
      { type: 'scrollTop' },
      { type: 'fillName', name: 'Ari' },
      { type: 'fillP2Name', name: 'Jeff' },
      { type: 'fillName', name: 'Ari', default: true },
      { type: 'fillP2Name', name: 'Ethan', default: true },
      { type: 'setCode', value: 'ABCD' },
      { type: 'revealRule', slot: 'rulesList', rule: 'knock' },
    ]);
    expect(b.log.scrolls).toEqual([[0, 0]]);
    expect(b.log.inputs).toEqual([
      ['name', 'Ari'],
      ['p2', 'Jeff'],
      ['name:default', 'Ari'],
      ['p2:default', 'Ethan'],
      ['code', 'ABCD'],
    ]);
    // The reveal (web/shared/edge/glossary.ts) scrolled the rule inside the slot into view and flashed it.
    expect(b.ruleEl.scrolledInto()).toBe(1);
    expect(b.ruleEl.hasClass(RULE_FLASH_CLASS)).toBe(true);
  });

  test('the timers: a named timer fires its intent on the clock, arming again restarts it, cancel disarms it', () => {
    const b = bootPage();
    b.run([{ type: 'startTimer', id: 'beat', ms: 500, then: { type: 'render' } }]);
    b.clock.advance(400);
    b.run([{ type: 'startTimer', id: 'beat', ms: 500, then: { type: 'render' } }]);
    b.clock.advance(400);
    expect(seen(b)).not.toContain('render');
    b.clock.advance(100);
    expect(seen(b).at(-1)).toBe('render');
    b.run([
      { type: 'startTimer', id: 'longPress', ms: 10, then: { type: 'render' } },
      { type: 'cancelTimer', id: 'longPress' },
    ]);
    b.clock.advance(10);
    expect(seen(b).filter((t) => t === 'render')).toHaveLength(1);
  });

  test("sound: the preference under the game's key seeds the cues, the toggle repaints the button, cues play in the App's font, buzzes reach the navigator", () => {
    const b = bootPage({ stored: { [SOUND_KEY]: 'off' } });
    expect(b.log.sounds).toEqual([false]);
    expect(b.fxDeps.value?.audio.enabled()).toBe(false);
    b.run([{ type: 'toggleSound' }]);
    expect(b.log.toggles).toEqual(['default']);
    expect(b.log.sounds).toEqual([false, true]);
    (b.hook()['soundFont'] as (n: string) => void)('felt');
    b.run([{ type: 'fx', cue: 'ding' }, { type: 'toggleSound' }]);
    expect(b.log.plays).toEqual([['ding', 'felt']]);
    // The one `fx` dep routes a cue to `play` and chosen phrases to `playPhrases`, both in the App's font.
    b.run([{ type: 'phrases', phrases: [SHELL_CUES.win, SHELL_CUES.lose] }]);
    expect(b.log.plays).toEqual([
      ['ding', 'felt'],
      [[SHELL_CUES.win, SHELL_CUES.lose], 'felt'],
    ]);
    expect(b.log.toggles).toEqual(['default', 'felt']);
    b.fxDeps.value?.vibrate([10, 20]);
    expect(b.log.buzzes).toEqual([[10, 20]]);
    expect(b.fxDeps.value?.store).toBe(b.store);
  });

  test("the sample seam: the page's fetch, the bytes on ok, a rejection naming the status and the URL otherwise", async () => {
    const b = bootPage();
    const bytes = await b.fxDeps.value?.sound.fetchBuffer('ding.wav');
    expect(bytes?.byteLength).toBe(3);
    await expect(b.fxDeps.value?.sound.fetchBuffer('missing.wav')).rejects.toThrow(
      '404 missing.wav',
    );
    await expect(fetchArrayBuffer(b.win)('missing.wav')).rejects.toThrow('404 missing.wav');
  });

  test("audio warms on the first gesture through the page's AudioContext; the page visible again warms and dispatches `visible`", () => {
    FakeAudioContext.made = 0;
    const b = bootPage({ audio: true });
    // The four gestures WebKit counts (sound-fonts.md §12) each warm the player, none passive;
    // the context is made once, on the first. `touchstart` is no longer one: a passive
    // scroll-blocking listener is what iPhone Safari would not count.
    // (The jargon binder's document click comes first; the audio's four are bound after the binders.)
    const gestures = b.log.listeners.filter(([type]) =>
      ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].includes(type),
    );
    expect(gestures.slice(-4)).toEqual([
      ['pointerdown', undefined],
      ['touchend', undefined],
      ['click', undefined],
      ['keydown', undefined],
    ]);
    expect(gestures.some(([type]) => type === 'touchstart')).toBe(false);
    b.p.fire('pointerdown');
    b.p.fire('touchend');
    b.p.fire('click');
    b.p.fire('keydown');
    expect(b.log.warms.count).toBe(4);
    // Each gesture warms in the App's font, so the table's samples are fetched with the context.
    expect(b.log.warms.fonts).toEqual(['default', 'default', 'default', 'default']);
    b.fxDeps.value?.audio.warm();
    b.fxDeps.value?.audio.warm();
    expect(FakeAudioContext.made).toBe(1);
    // Hidden: nothing; visible: a warm (an `interrupted` context asked to resume) and the intent.
    b.visibility.state = 'hidden';
    b.p.fire('visibilitychange');
    expect(seen(b)).toEqual(['home/init', 'resume/auto']);
    expect(b.log.warms.count).toBe(4);
    b.visibility.state = 'visible';
    b.p.fire('visibilitychange');
    expect(seen(b)).toEqual(['home/init', 'resume/auto', 'visible']);
    expect(b.log.warms.count).toBe(5);
    // Without a constructor the cues have no context and warming is silent.
    const silent = bootPage();
    silent.fxDeps.value?.audio.warm();
    expect(silent.fxDeps.value?.audio.context()).toBeNull();
  });

  test('a phone starts muted (the owner, 2026-09-25): a coarse pointer makes the fallback off; a remembered preference wins; a desktop or a window without matchMedia keeps on', () => {
    // A fresh phone visitor: muted, and no gesture warms a muted player (the tap on the speaker
    // is the gesture that turns it on, through `toggle`, which the fx fake stands in for here).
    const phone = bootPage({ audio: true, coarse: true });
    expect(phone.log.queries).toEqual(['(pointer: coarse)']);
    expect(phone.log.fallbacks).toEqual([false]);
    expect(phone.fxDeps.value?.audio.enabled()).toBe(false);
    expect(phone.log.sounds).toEqual([false]);
    phone.p.fire('pointerdown');
    phone.p.fire('touchend');
    expect(phone.log.warms.count).toBe(0);
    // The phone that remembered sound on plays from the first tap, as a desktop does.
    const returning = bootPage({ audio: true, coarse: true, stored: { [SOUND_KEY]: 'on' } });
    expect(returning.fxDeps.value?.audio.enabled()).toBe(true);
    returning.p.fire('touchend');
    expect(returning.log.warms.count).toBe(1);
    // A desktop (a fine pointer) and a window with no `matchMedia` at all: on, as before.
    expect(bootPage({ coarse: false }).log.fallbacks).toEqual([true]);
    const bare = bootPage();
    expect(bare.log.queries).toEqual([]);
    expect(bare.log.fallbacks).toEqual([true]);
    expect(bare.fxDeps.value?.audio.enabled()).toBe(true);
    // A desktop that remembered off stays off, and its gestures warm nothing.
    const off = bootPage({ stored: { [SOUND_KEY]: 'off' } });
    expect(off.fxDeps.value?.audio.enabled()).toBe(false);
    off.p.fire('click');
    expect(off.log.warms.count).toBe(0);
  });

  test("the share chain and the wake lock: the invite on the page's origin and path to the clipboard with the copied toast; the lock held and dropped without a navigator lock", async () => {
    const b = bootPage();
    b.run([
      { type: 'share', code: 'ABCD' },
      { type: 'wakeLock', hold: true },
      { type: 'wakeLock', hold: false },
    ]);
    await settle();
    expect(b.log.copied).toEqual(['https://games.sweedler.com/fake/?join=ABCD']);
    expect(b.p.get('toast').text()).toBe(INVITE_COPIED_MSG);
  });

  test('the sessions: the host and the guest built over the browser net deps, the App read back live, the events as intents, send routed by side, close', () => {
    const b = bootPage();
    b.run([{ type: 'startHost', code: 'ABCD', attempt: 1, resume: false }], true);
    const host = b.log.hosts[0];
    expect(host?.opts).toEqual({ code: 'ABCD', attempt: 1, resume: false });
    expect(host?.deps.clock).toBe(realClock);
    expect(typeof host?.deps.transportFor).toBe('function');
    expect(typeof host?.deps.onWake).toBe('function');
    // `read` sees the current App (attempt is the steps count here).
    expect(host?.deps.read()).toMatchObject({ role: 'host', code: 'ABCD', level: 3, attempt: 1 });
    b.run([], true);
    expect(host?.deps.read().attempt).toBe(2);
    // The events are the adapters: a status becomes its intent.
    host?.deps.events.status('Waiting…', true);
    expect(b.log.intents.at(-1)).toEqual({
      type: 'host/status',
      text: 'Waiting…',
      stopPulse: true,
    });
    // A host sends host frames alone; a guest frame is dropped.
    b.run([
      { type: 'send', frame: FULL },
      { type: 'send', frame: JOIN },
    ]);
    expect(host?.sent).toEqual([FULL]);
    b.run([{ type: 'closeNet' }]);
    expect(host?.closed).toBe(1);
    // The guest, the other way round.
    b.run([{ type: 'startGuest', code: 'ABCD', attempt: 3 }]);
    const guest = b.log.guests[0];
    expect(guest?.opts).toEqual({ code: 'ABCD', attempt: 3 });
    expect(guest?.deps.read()).toMatchObject({ role: 'guest', code: 'ABCD', myName: 'Jeff' });
    guest?.deps.events.lost();
    expect(b.log.intents.at(-1)).toEqual({ type: 'guest/lost' });
    b.run([
      { type: 'send', frame: FULL },
      { type: 'send', frame: JOIN },
    ]);
    expect(guest?.sent).toEqual([JOIN]);
    expect(host?.sent).toEqual([FULL]);
    b.run([{ type: 'closeNet' }]);
    expect(guest?.closed).toBe(1);
    // No session: send and close are no-ops.
    const idle = bootPage();
    idle.run([{ type: 'send', frame: FULL }, { type: 'closeNet' }]);
    expect(idle.log.hosts).toEqual([]);
  });

  test('what the boot returns is what the hooks were given', () => {
    const given: BootCtx<Fake, App>[] = [];
    const b = bootPage({
      hooks: () => ({
        render: (ctx) => {
          given.push(ctx);
        },
        bind: (ctx) => {
          given.push(ctx);
        },
      }),
    });
    expect(given).toEqual([b.boot, b.boot]);
    expect(b.boot.store).toBe(b.store);
    expect(b.boot.now()).toBe(b.clock.now());
    expect(b.boot.rng).toBe(b.win.__rng);
    expect(b.boot.toast).toBeDefined();
    // Without the harness's seeded rng the boot draws from Math.random.
    expect(bootPage({ unseeded: true }).boot.rng).toBe(Math.random);
  });
});
