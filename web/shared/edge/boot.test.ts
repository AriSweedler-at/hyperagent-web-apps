// The three boot helpers over fakes: the invite link against a recorded `history`, the share chain
// against the navigators the legacy page met (a sheet, a clipboard, neither, a dismissed sheet)
// with the toast landing on the fake page, and the session adapters against a recording dispatch,
// then through a real host and a real guest session on the fake broker (sessions.harness.ts).
import { describe, expect, test } from 'vitest';

import {
  INVITE_COPIED_MSG,
  SHARE_FALLBACK_MS,
  applyInviteLink,
  roomCodeMsg,
  sessionEvents,
  shareInvite,
  type InviteWindowLike,
  type SessionEventDeps,
  type SessionIntent,
} from './boot.ts';
import { fakeClock } from './clock.fake.ts';
import { fakeEl, fakePage } from './page.fake.ts';
import type { ShareNavigatorLike, SharePayload } from './share.ts';
import { err } from '../lib/result.ts';
import { GUEST_WATCHDOG_MSG, GuestSession, type GuestCodec } from '../net/guest.ts';
import { HostSession, WAITING_MSG, type HostCodec } from '../net/host.ts';
import { CODE, cell, guestCtx, hostCtxFor, world } from '../net/sessions.harness.ts';
import { WATCHDOG_MS } from './peer.ts';
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
    host.frame({ t: 'join' });
    host.guestGone(null);
    host.guestGone('ICE failed');
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
