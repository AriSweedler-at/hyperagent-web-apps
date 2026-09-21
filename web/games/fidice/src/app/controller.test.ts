// The reducer over intents, driven end to end on fakes: effects that record, a fakeClock, the
// structural DOM of web/shared/edge/dom.fake.ts as the document and session stubs that record
// every call and hand back the events the controller gave them, so a "message from the host" is
// one call on the stub's `events`. The menu -> name -> host path goes through the rendered DOM
// (proves the wiring); the rest of the intent surface is sent straight to the reducer through
// `send` (each screen's handlers are pinned by the render tests beside it, the reducer is what this
// file checks). Timings are the module's constants on the fake clock; game states come from
// view/scenarios.ts, built through the domain.
import { describe, expect, test } from 'vitest';

import { fakeClock } from '../../../../shared/edge/clock.fake.ts';
import { byId, fakeDocument, fire, requireId } from '../../../../shared/edge/dom.fake.ts';
import { seat } from '../domain/game.ts';
import { GROUPS, asRank, handAt } from '../domain/hands.ts';
import type { PublicState, Rank } from '../domain/types.ts';
import type { ClientSession } from '../net/client.ts';
import type { HostOptions, HostSession } from '../net/host.ts';
import type { Role } from '../net/protocol.ts';
import type { HostEvents, Me, SessionEvents } from '../net/session.ts';
import { rowId } from '../view/screens/ladder.ts';
import { FIRST_BID, SCENARIOS } from '../view/scenarios.ts';
import type { Intent } from '../view/types.ts';
import { emptyPicker } from '../view/ui.ts';
import {
  Controller,
  HANDOFF_CONFIRM_MS,
  NAME_KEY,
  TICK_MS,
  TOAST_MS,
  currentBid,
  keyRange,
  openPath,
  reducePicker,
  screenFor,
  toggleKey,
  withLadder,
} from './controller.ts';
import type { Effects } from './effects.ts';

type Call = Readonly<{ method: string; args: ReadonlyArray<unknown> }>;

type Recorded = Readonly<{
  calls: () => ReadonlyArray<Call>;
  record: (method: string, ...args: ReadonlyArray<unknown>) => void;
}>;

const recorded = (): Recorded => {
  const calls: Call[] = [];
  return {
    calls: () => calls,
    record: (method, ...args) => {
      calls.push({ method, args });
    },
  };
};

type HostStub = Readonly<{
  opts: HostOptions;
  events: HostEvents;
  calls: () => ReadonlyArray<Call>;
}>;

type ClientStub = Readonly<{
  code: string;
  role: Role;
  name: string | null;
  events: SessionEvents;
  calls: () => ReadonlyArray<Call>;
}>;

type Harness = Readonly<{
  controller: Controller;
  clock: ReturnType<typeof fakeClock>;
  root: ReturnType<ReturnType<typeof fakeDocument>['createElement']>;
  storage: Map<string, string>;
  effectCalls: () => ReadonlyArray<Call>;
  hosts: ReadonlyArray<HostStub>;
  clients: ReadonlyArray<ClientStub>;
  /** The newest host stub; the test must have created one. */
  host: () => HostStub;
  client: () => ClientStub;
  send: (intent: Intent) => void;
  /** Elements the page shows now. */
  has: (id: string) => boolean;
}>;

type Options = Readonly<{
  savedName?: string;
  hash?: string;
  confirm?: boolean;
  copyOk?: boolean;
}>;

const CODES: ReadonlyArray<string> = ['KEZAR', 'PLUMB', 'MAINE'];

const harness = (options: Options = {}): Harness => {
  const clock = fakeClock(1_700_000_000_000);
  const doc = fakeDocument();
  const root = doc.createElement('div');
  const storage = new Map<string, string>();
  if (options.savedName !== undefined) storage.set(NAME_KEY, options.savedName);
  const fx = recorded();
  const counter = { codes: 0, ids: 0 };
  const effects: Effects = {
    storage: {
      get: (key) => storage.get(key) ?? null,
      set: (key, value) => {
        storage.set(key, value);
      },
    },
    copyToClipboard: (text) => {
      fx.record('copyToClipboard', text);
      return Promise.resolve(options.copyOk ?? true);
    },
    setHash: (hash) => {
      fx.record('setHash', hash);
    },
    readHash: () => options.hash ?? '',
    scrollToTop: () => {
      fx.record('scrollToTop');
    },
    scrollIntoView: (id) => {
      fx.record('scrollIntoView', id);
    },
    scrollToBottom: (id) => {
      fx.record('scrollToBottom', id);
    },
    confirm: (question) => {
      fx.record('confirm', question);
      return options.confirm ?? true;
    },
    randomCode: () => {
      const code = CODES[counter.codes % CODES.length] ?? 'KEZAR';
      counter.codes += 1;
      return code;
    },
    randomId: () => {
      counter.ids += 1;
      return `id-${String(counter.ids)}`;
    },
  };
  const hosts: HostStub[] = [];
  const clients: ClientStub[] = [];
  const makeHost = (opts: HostOptions, events: HostEvents): HostSession => {
    const r = recorded();
    hosts.push({ opts, events, calls: r.calls });
    const stub = {
      kind: 'host',
      act: (action: unknown) => {
        r.record('act', action);
      },
      close: () => {
        r.record('close');
      },
      addBot: () => {
        r.record('addBot');
      },
      removeBot: (at: unknown) => {
        r.record('removeBot', at);
      },
      renameBot: (at: unknown, name: unknown) => {
        r.record('renameBot', at, name);
      },
      setBot: (at: unknown, choice: unknown) => {
        r.record('setBot', at, choice);
      },
      hostWatches: (watching: unknown, hostName: unknown) => {
        r.record('hostWatches', watching, hostName);
      },
    };
    // The controller sees a HostSession; the stub is one structurally minus its private state.
    return stub as unknown as HostSession;
  };
  const makeClient = (
    code: string,
    role: Role,
    name: string | null,
    events: SessionEvents,
  ): ClientSession => {
    const r = recorded();
    clients.push({ code, role, name, events, calls: r.calls });
    const stub = {
      kind: 'client',
      act: (action: unknown) => {
        r.record('act', action);
      },
      close: () => {
        r.record('close');
      },
    };
    return stub as unknown as ClientSession;
  };
  const controller = new Controller(
    {
      effects,
      clock,
      doc: doc as unknown as Document,
      root: root as unknown as Element,
      makeHost,
      makeClient,
    },
    'https://games.example/games/fidice/',
  );
  const last = <T>(xs: ReadonlyArray<T>, what: string): T => {
    const x = xs[xs.length - 1];
    if (x === undefined) throw new Error(`no ${what} was constructed`);
    return x;
  };
  return {
    controller,
    clock,
    root,
    storage,
    effectCalls: fx.calls,
    hosts,
    clients,
    host: () => last(hosts, 'host'),
    client: () => last(clients, 'client'),
    // `handle` is private to the class; the screens' handlers are its only production callers.
    send: (intent) => {
      (controller as unknown as Readonly<{ handle: (i: Intent) => void }>).handle(intent);
    },
    has: (id) => byId(root, id) !== null,
  };
};

const game = (name: keyof typeof SCENARIOS): PublicState => {
  const g = SCENARIOS[name].game;
  if (g === null) throw new Error(`scenario ${name} has no game`);
  return g;
};

const LOBBY = game('lobby: host');
/** Seat 0 holds the cup, no bid yet. */
const OPENING = game('game: opener, my turn');
/** Seat 1 holds the cup facing FIRST_BID. */
const FACING = game('game: facing a bid, not my turn');
/** Cup lifted, the next round counting down. */
const REVEALED = game('game: revealed, someone else lost');
const FINISHED = game('game: over, scored');

const player = (n: number): Me => ({ seat: seat(n), role: 'player' });
const SPECTATOR: Me = { seat: null, role: 'spectator' };

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Menu to lobby through the rendered DOM: the saved name is offered, the typed one is kept. */
const hostALobby = (h: Harness): void => {
  h.controller.start();
  fire(requireId(h.root, 'btnCreate'), 'click');
  fire(requireId(h.root, 'nameInput'), 'input', { value: ' Ari ' });
  fire(requireId(h.root, 'btnNameGo'), 'click');
  h.host().events.onReady();
  h.host().events.onState(LOBBY, player(0));
};

describe('Controller boot', () => {
  test('the saved name seeds the form and the first frame is the menu', () => {
    const h = harness({ savedName: 'Tyler' });
    expect(h.controller.state.nameForm.name).toBe('Tyler');
    expect(h.controller.state.screen).toBe('menu');
    expect(h.has('screen-menu')).toBe(false);
    h.controller.start();
    expect(h.has('screen-menu')).toBe(true);
    expect(h.hosts).toEqual([]);
    expect(h.clients).toEqual([]);
  });

  test('#join=code opens the name screen with the code filled in, upper-cased', () => {
    const h = harness({ hash: '#join=kezar' });
    h.controller.start();
    expect(h.controller.state).toMatchObject({
      joinCode: 'KEZAR',
      pending: { kind: 'join', code: 'KEZAR' },
      screen: 'name',
      error: null,
    });
    expect(h.has('screen-name')).toBe(true);
    expect(requireId(h.root, 'joinCode').value).toBe('KEZAR');
  });

  test('#watch=code joins as a spectator at once', () => {
    const h = harness({ hash: '#watch=kezar' });
    h.controller.start();
    expect(h.client()).toMatchObject({ code: 'KEZAR', role: 'spectator', name: null });
    expect(h.controller.state).toMatchObject({
      role: 'spectator',
      screen: 'spec',
      busy: 'Paddling out to the host…',
      game: null,
    });
  });

  test('a malformed hash is ignored', () => {
    const h = harness({ hash: '#join=abc' });
    h.controller.start();
    expect(h.controller.state.screen).toBe('menu');
  });
});

describe('Controller hosting', () => {
  test('menu -> name -> host: the name is trimmed and saved, the host gets the options', () => {
    const h = harness({ savedName: 'Tyler' });
    hostALobby(h);
    expect(h.storage.get(NAME_KEY)).toBe('Ari');
    expect(h.host().opts).toEqual({
      hostName: 'Ari',
      lives: 0,
      watch: false,
      bots: 0,
      autostart: false,
      code: 'KEZAR',
    });
    expect(h.controller.state).toMatchObject({
      role: 'host',
      screen: 'lobby',
      busy: null,
      game: LOBBY,
      mySeat: 0,
      now: h.clock.now(),
    });
    expect(h.has('screen-lobby')).toBe(true);
    expect(requireId(h.root, 'roomPill').textContent).toBe('KEZAR');
  });

  test('before onReady the lobby is busy', () => {
    const h = harness();
    h.controller.start();
    h.send({ type: 'menu.create' });
    h.send({ type: 'form.submit' });
    expect(h.controller.state).toMatchObject({
      screen: 'lobby',
      busy: 'Setting up the table…',
      error: null,
    });
    // An empty name falls back to Player.
    expect(h.host().opts.hostName).toBe('Player');
    h.host().events.onReady();
    expect(h.controller.state.busy).toBeNull();
  });

  test('the lobby intents reach the host session', () => {
    const h = harness();
    hostALobby(h);
    h.send({ type: 'lobby.addBot' });
    h.send({ type: 'lobby.removeBot', seat: seat(2) });
    h.send({ type: 'lobby.renameBot', seat: seat(2), name: 'Robo' });
    h.send({ type: 'lobby.setBot', seat: seat(2), choice: 'gambler' });
    h.send({ type: 'lobby.watch', watching: true });
    h.send({ type: 'lobby.start' });
    expect(h.host().calls()).toEqual([
      { method: 'addBot', args: [] },
      { method: 'removeBot', args: [2] },
      { method: 'renameBot', args: [2, 'Robo'] },
      { method: 'setBot', args: [2, 'gambler'] },
      { method: 'hostWatches', args: [true, 'Ari'] },
      { method: 'act', args: [{ type: 'start' }] },
    ]);
  });

  test('the form edits: lives, difficulty, code and back', () => {
    const h = harness();
    h.controller.start();
    h.send({ type: 'menu.solo' });
    expect(h.controller.state.pending).toEqual({ kind: 'solo', bots: 2 });
    h.send({ type: 'form.lives', value: 3 });
    h.send({ type: 'form.difficulty', value: 'hard' });
    h.send({ type: 'form.code', value: 'abc' });
    expect(h.controller.state.nameForm).toMatchObject({ lives: 3, botChoice: 'gambler' });
    expect(h.controller.state.joinCode).toBe('ABC');
    h.send({ type: 'form.name', value: 'Ari' });
    h.send({ type: 'form.submit' });
    expect(h.host().opts).toMatchObject({ bots: 2, botChoice: 'gambler', lives: 3 });
    h.send({ type: 'form.back' });
    expect(h.host().calls()).toEqual([{ method: 'close', args: [] }]);
    expect(h.controller.state).toMatchObject({ screen: 'menu', pending: null, game: null });
  });

  test('watching bots hosts a self-starting table and shows the spectator screen', () => {
    const h = harness();
    h.controller.start();
    h.send({ type: 'menu.watchBots' });
    expect(h.host().opts).toEqual({
      hostName: 'Host',
      lives: 3,
      watch: true,
      bots: 4,
      autostart: true,
      code: 'KEZAR',
    });
    expect(h.controller.state.screen).toBe('spec');
    h.send({ type: 'lobby.watch', watching: false });
    expect(h.host().calls()).toEqual([{ method: 'hostWatches', args: [false, 'Host'] }]);
  });

  test('the config screen edits the solo choice or a seated computer', () => {
    const h = harness();
    hostALobby(h);
    h.send({ type: 'config.pick', choice: 'gambler' });
    h.send({ type: 'config.open', target: { kind: 'solo' } });
    expect(h.effectCalls().filter((c) => c.method === 'scrollToTop')).toHaveLength(1);
    h.send({ type: 'config.pick', choice: 'pressure' });
    expect(h.controller.state.nameForm.botChoice).toBe('pressure');
    h.send({ type: 'config.open', target: { kind: 'seat', seat: seat(3) } });
    h.send({ type: 'config.pick', choice: 'gambler' });
    expect(h.host().calls()).toEqual([{ method: 'setBot', args: [3, 'gambler'] }]);
    h.send({ type: 'config.close' });
    expect(h.controller.state.configTarget).toBeNull();
  });
});

describe('Controller pass the phone', () => {
  test('a local table needs one more name, then covers the screen for each human holder', () => {
    const h = harness();
    h.controller.start();
    h.send({ type: 'menu.local' });
    h.send({ type: 'form.name', value: 'Ari' });
    h.send({ type: 'form.submit' });
    expect(h.controller.state.error).toBe('Add at least one more player to pass the phone to.');
    expect(h.hosts).toEqual([]);
    h.send({ type: 'form.local.set', index: 0, value: 'Bob' });
    h.send({ type: 'form.local.add' });
    h.send({ type: 'form.local.add' });
    h.send({ type: 'form.local.remove', index: 2 });
    expect(h.controller.state.nameForm.locals).toEqual(['Bob', '']);
    h.send({ type: 'form.submit' });
    expect(h.host().opts).toMatchObject({ locals: ['Bob'], bots: 0 });
    expect(h.controller.state.localTable).toBe(true);

    // Nothing to cover in the lobby.
    h.host().events.onState(LOBBY, player(0));
    expect(h.controller.state.handoff).toBeNull();

    // Seat 0 (a human) holds the cup and this device shows seat 0: cover.
    h.host().events.onState(OPENING, player(0));
    expect(h.controller.state.handoff).toEqual({ seat: 0, stage: 'cover' });
    h.send({ type: 'handoff.confirm' });
    expect(h.controller.state.handoff).toEqual({ seat: 0, stage: 'cover' });

    // Tap: the confirm shows, then times out back to the cover.
    h.send({ type: 'handoff.tap' });
    expect(h.controller.state.handoff).toEqual({ seat: 0, stage: 'confirm' });
    h.clock.advance(HANDOFF_CONFIRM_MS - 1);
    expect(h.controller.state.handoff).toEqual({ seat: 0, stage: 'confirm' });
    h.clock.advance(1);
    expect(h.controller.state.handoff).toEqual({ seat: 0, stage: 'cover' });

    // Tap and confirm in time: the cover lifts and seat 0 stays uncovered on the next state.
    h.send({ type: 'handoff.tap' });
    h.send({ type: 'handoff.confirm' });
    expect(h.controller.state).toMatchObject({ handoff: null, shownSeat: 0 });
    expect(h.clock.pending()).toBe(0);
    h.host().events.onState(OPENING, player(0));
    expect(h.controller.state.handoff).toBeNull();

    // The cup moves to seat 1 (Tyler): cover again; the same state twice does not restart it.
    h.host().events.onState(FACING, player(1));
    expect(h.controller.state.handoff).toEqual({ seat: 1, stage: 'cover' });
    h.send({ type: 'handoff.tap' });
    h.host().events.onState(FACING, player(1));
    expect(h.controller.state.handoff).toEqual({ seat: 1, stage: 'confirm' });

    // A reveal needs no cover, and a bot's turn neither.
    h.host().events.onState(REVEALED, player(1));
    expect(h.controller.state.handoff).toBeNull();
  });

  test('handoff.tap with nothing to cover is a no-op', () => {
    const h = harness();
    hostALobby(h);
    h.send({ type: 'handoff.tap' });
    expect(h.controller.state.handoff).toBeNull();
    expect(h.clock.pending()).toBe(0);
  });
});

describe('Controller joining', () => {
  test('menu.join then a short code is refused, a full one paddles out', () => {
    const h = harness({ savedName: 'Ari' });
    h.controller.start();
    h.send({ type: 'menu.join' });
    expect(h.controller.state.pending).toEqual({ kind: 'join', code: '' });
    h.send({ type: 'form.code', value: 'ab' });
    h.send({ type: 'form.submit' });
    expect(h.controller.state.error).toBe('Codes are 5 characters');
    expect(h.clients).toEqual([]);
    h.send({ type: 'form.code', value: ' plumb' });
    h.send({ type: 'form.submit' });
    expect(h.client()).toMatchObject({ code: 'PLUMB', role: 'player', name: 'Ari' });
    expect(h.controller.state).toMatchObject({
      joinCode: 'PLUMB',
      pending: { kind: 'join', code: 'PLUMB' },
      role: 'player',
      screen: 'lobby',
      busy: 'Paddling out to the host…',
    });
    h.client().events.onReady();
    h.client().events.onState(LOBBY, player(1));
    expect(h.controller.state).toMatchObject({ role: 'player', screen: 'lobby', mySeat: 1 });
    h.send({ type: 'lobby.start' });
    h.send({ type: 'lobby.addBot' });
    expect(h.client().calls()).toEqual([{ method: 'act', args: [{ type: 'start' }] }]);
  });

  test('a spectator sees the spectator screen; a watching host in the lobby sees the lobby', () => {
    const h = harness({ hash: '#watch=KEZAR' });
    h.controller.start();
    h.client().events.onState(LOBBY, SPECTATOR);
    expect(h.controller.state).toMatchObject({ screen: 'spec', role: 'spectator', mySeat: null });
    h.client().events.onState(FACING, SPECTATOR);
    h.send({ type: 'spec.truth', on: true });
    expect(h.controller.state.showTruth).toBe(true);
    h.send({ type: 'ladder.toggle', ladder: 'spec', key: 'cat:high' });
    expect(h.controller.state.ladders.spec.open.has('cat:high')).toBe(true);
    expect(screenFor(LOBBY, SPECTATOR, true)).toBe('lobby');
    expect(screenFor(LOBBY, SPECTATOR, false)).toBe('spec');
    expect(screenFor(FACING, SPECTATOR, true)).toBe('spec');
    expect(screenFor(LOBBY, player(0), true)).toBe('lobby');
    expect(screenFor(FACING, player(0), false)).toBe('game');
  });

  test('onClosed tears the session down and returns to the name screen with the reason', () => {
    const h = harness({ hash: '#join=KEZAR', savedName: 'Ari' });
    h.controller.start();
    h.send({ type: 'form.submit' });
    h.client().events.onState(LOBBY, player(1));
    h.client().events.onClosed('The host closed the table');
    expect(h.client().calls()).toEqual([{ method: 'close', args: [] }]);
    expect(h.controller.state).toMatchObject({
      screen: 'name',
      error: 'The host closed the table',
      busy: null,
      game: null,
      mySeat: null,
      role: null,
    });
    expect(h.has('screen-name')).toBe(true);
    // No session any more: play is a no-op.
    h.send({ type: 'play', action: { type: 'peek' } });
    expect(h.client().calls()).toHaveLength(1);
  });
});

describe('Controller toasts and timers', () => {
  /** The host's info hook, which the controller always registers. */
  const infoOf = (h: Harness): ((m: string) => void) => {
    const info = h.host().events.onInfo;
    if (info === undefined) throw new Error('the controller always listens for info');
    return info;
  };
  const toastText = (h: Harness): string | null => requireId(h.root, 'toast').textContent;

  test('onInfo and onError toast for TOAST_MS; a second toast within it waits its turn (docs/MIGRATION.md step 15)', () => {
    const h = harness();
    hostALobby(h);
    h.host().events.onError('No relay configured');
    expect(h.controller.state.toast).toBe('No relay configured');
    expect(requireId(h.root, 'toast').getAttribute('class')).toBe('toast show');
    h.clock.advance(TOAST_MS - 1);
    expect(h.controller.state.toast).toBe('No relay configured');
    // The legacy's one timer restarted here and 'Copied!' replaced the error at once. Now the
    // first toast keeps its last millisecond and the second gets a full TOAST_MS after it.
    infoOf(h)('Copied!');
    expect(h.controller.state.toast).toBe('No relay configured');
    expect(toastText(h)).toBe('No relay configured');
    h.clock.advance(1);
    expect(h.controller.state.toast).toBe('Copied!');
    expect(toastText(h)).toBe('Copied!');
    h.clock.advance(TOAST_MS - 1);
    expect(h.controller.state.toast).toBe('Copied!');
    h.clock.advance(1);
    expect(h.controller.state.toast).toBeNull();
    expect(requireId(h.root, 'toast').getAttribute('class')).toBe('toast');
    expect(h.clock.pending()).toBe(0);
  });

  test('a burst of three toasts shows each for TOAST_MS, in arrival order, on one timer at a time', () => {
    const h = harness();
    hostALobby(h);
    const info = infoOf(h);
    ['one', 'two', 'three'].forEach(info);
    expect(h.controller.state.toast).toBe('one');
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(TOAST_MS);
    expect(h.controller.state.toast).toBe('two');
    expect(toastText(h)).toBe('two');
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(TOAST_MS);
    expect(h.controller.state.toast).toBe('three');
    h.clock.advance(TOAST_MS - 1);
    expect(h.controller.state.toast).toBe('three');
    h.clock.advance(1);
    expect(h.controller.state.toast).toBeNull();
    expect(requireId(h.root, 'toast').getAttribute('class')).toBe('toast');
    expect(h.clock.pending()).toBe(0);
  });

  test('a toast arriving as the showing one expires follows it without a gap; with nothing showing a toast is immediate', () => {
    const h = harness();
    hostALobby(h);
    const info = infoOf(h);
    info('first');
    // Queued in the same instant the first expires: shown as it goes, for its own TOAST_MS.
    h.clock.advance(TOAST_MS - 1);
    info('second');
    h.clock.advance(1);
    expect(h.controller.state.toast).toBe('second');
    h.clock.advance(TOAST_MS);
    expect(h.controller.state.toast).toBeNull();
    expect(h.clock.pending()).toBe(0);
    // Nothing showing: no wait.
    info('third');
    expect(h.controller.state.toast).toBe('third');
    expect(requireId(h.root, 'toast').getAttribute('class')).toBe('toast show');
    h.clock.advance(TOAST_MS);
    expect(h.controller.state.toast).toBeNull();
    expect(requireId(h.root, 'toast').getAttribute('class')).toBe('toast');
  });

  test('a repeated message coalesces: three roll.go taps with nothing chosen read as one toast for one TOAST_MS', () => {
    const h = harness();
    hostALobby(h);
    h.host().events.onState(OPENING, player(0));
    const refusal = 'Select table dice or tick "Shake the cup" first';
    h.send({ type: 'roll.go' });
    h.send({ type: 'roll.go' });
    h.send({ type: 'roll.go' });
    expect(h.controller.state.toast).toBe(refusal);
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(TOAST_MS - 1);
    expect(h.controller.state.toast).toBe(refusal);
    h.clock.advance(1);
    expect(h.controller.state.toast).toBeNull();
    expect(requireId(h.root, 'toast').getAttribute('class')).toBe('toast');
    expect(h.clock.pending()).toBe(0);
    // The check is against the toast showing and the queue's tail: the second 'b' repeats the
    // tail and the last 'a' repeats the one showing, so both are dropped; 'c' is new and queues.
    const info = infoOf(h);
    ['a', 'b', 'b', 'a', 'c'].forEach(info);
    expect(h.controller.state.toast).toBe('a');
    h.clock.advance(TOAST_MS);
    expect(h.controller.state.toast).toBe('b');
    h.clock.advance(TOAST_MS);
    expect(h.controller.state.toast).toBe('c');
    h.clock.advance(TOAST_MS);
    expect(h.controller.state.toast).toBeNull();
    expect(h.clock.pending()).toBe(0);
  });

  test('leaving a table drops the toasts queued behind the one showing, which finishes its TOAST_MS', () => {
    const h = harness();
    hostALobby(h);
    h.host().events.onState(OPENING, player(0));
    const error = h.host().events.onError;
    ['Connection problem: a', 'Connection problem: b', 'Connection problem: c'].forEach(error);
    h.send({ type: 'leave' });
    expect(h.controller.state.screen).toBe('menu');
    expect(h.controller.state.toast).toBe('Connection problem: a');
    h.clock.advance(TOAST_MS);
    expect(h.controller.state.toast).toBeNull();
    expect(requireId(h.root, 'toast').getAttribute('class')).toBe('toast');
    expect(h.clock.pending()).toBe(0);
  });

  test("a closed table's queued toasts do not delay the next table's", () => {
    const h = harness();
    hostALobby(h);
    const info = infoOf(h);
    info('old one');
    info('old two');
    h.host().events.onClosed('Host left');
    expect(h.controller.state.screen).toBe('name');
    fire(requireId(h.root, 'btnNameGo'), 'click');
    h.host().events.onReady();
    h.host().events.onState(LOBBY, player(0));
    infoOf(h)('new table ready');
    // 'old one' finishes its TOAST_MS; 'old two' is gone; the new table's toast is next.
    h.clock.advance(TOAST_MS);
    expect(h.controller.state.toast).toBe('new table ready');
    h.clock.advance(TOAST_MS);
    expect(h.controller.state.toast).toBeNull();
    expect(h.clock.pending()).toBe(0);
  });

  test('the countdown ticks every TICK_MS while a reveal is showing', () => {
    const h = harness();
    hostALobby(h);
    h.host().events.onState(REVEALED, player(0));
    const shown = h.controller.state.now;
    expect(h.clock.pending()).toBe(1);
    h.clock.advance(TICK_MS);
    expect(h.controller.state.now).toBe(shown + TICK_MS);
    expect(h.clock.pending()).toBe(1);
    h.host().events.onState(FINISHED, player(0));
    h.clock.advance(TICK_MS);
    expect(h.clock.pending()).toBe(0);
    expect(h.controller.state.screen).toBe('game');
  });

  test('copy toasts Copied! or the fallback', async () => {
    const ok = harness({ copyOk: true });
    hostALobby(ok);
    ok.send({ type: 'copy', text: 'https://games.example/games/fidice/#join=KEZAR' });
    await flush();
    expect(ok.controller.state.toast).toBe('Copied!');
    expect(ok.effectCalls()).toContainEqual({
      method: 'copyToClipboard',
      args: ['https://games.example/games/fidice/#join=KEZAR'],
    });
    const refused = harness({ copyOk: false });
    hostALobby(refused);
    refused.send({ type: 'copy', text: 'x' });
    await flush();
    expect(refused.controller.state.toast).toBe('Select the link and press Ctrl/Cmd+C to copy');
  });

  test('the table talk is scrolled to its end when a line lands', () => {
    const h = harness();
    hostALobby(h);
    const scrolls = (): ReadonlyArray<unknown> =>
      h
        .effectCalls()
        .filter((c) => c.method === 'scrollToBottom')
        .map((c) => c.args[0]);
    expect(scrolls()).toEqual(['log', 'spec-log']);
    h.host().events.onState(LOBBY, player(0));
    expect(scrolls()).toHaveLength(2);
    h.host().events.onState(OPENING, player(0));
    expect(scrolls()).toEqual(['log', 'spec-log', 'log', 'spec-log']);
  });
});

describe('Controller at the table', () => {
  const atTheTable = (): Harness => {
    const h = harness();
    hostALobby(h);
    h.host().events.onState(OPENING, player(0));
    return h;
  };

  test('a new state on my turn resets the roll and picker and lands on the play tab', () => {
    const h = harness();
    hostALobby(h);
    h.send({ type: 'nav', tab: 'rules' });
    expect(h.controller.state.tab).toBe('rules');
    h.send({ type: 'roll.toggleDie', die: 3 });
    h.send({ type: 'picker.query', value: 'pair' });
    h.host().events.onState(OPENING, player(0));
    expect(h.controller.state).toMatchObject({
      screen: 'game',
      tab: 'play',
      picker: emptyPicker,
      rollCup: false,
      rollHidden: false,
    });
    expect(h.controller.state.rollSelection.size).toBe(0);
    expect(h.has('screen-game')).toBe(true);
    // Another state on the same screen keeps the tab.
    h.send({ type: 'nav', tab: 'ladder' });
    h.host().events.onState(OPENING, player(0));
    expect(h.controller.state.tab).toBe('ladder');
  });

  test('play sends the action; a bid clears the picker, a roll clears the selection', () => {
    const h = atTheTable();
    h.send({ type: 'picker.query', value: 'pair' });
    h.send({ type: 'roll.toggleDie', die: 1 });
    h.send({ type: 'play', action: { type: 'bid', rank: asRank(40) } });
    expect(h.controller.state.picker).toEqual(emptyPicker);
    expect(h.controller.state.rollSelection.has(1)).toBe(true);
    h.send({ type: 'play', action: { type: 'roll', cup: true, table: [], intoCup: [] } });
    expect(h.controller.state.rollSelection.size).toBe(0);
    h.send({ type: 'play', action: { type: 'pull', die: 0 } });
    expect(
      h
        .host()
        .calls()
        .map((c) => c.args[0]),
    ).toEqual([
      { type: 'bid', rank: 40 },
      { type: 'roll', cup: true, table: [], intoCup: [] },
      { type: 'pull', die: 0 },
    ]);
  });

  test('roll.go: nothing chosen toasts; table dice roll; tucked dice go under the cup', () => {
    const h = atTheTable();
    h.send({ type: 'roll.go' });
    expect(h.controller.state.toast).toBe('Select table dice or tick "Shake the cup" first');
    expect(h.host().calls()).toEqual([]);

    h.send({ type: 'roll.toggleDie', die: 0 });
    h.send({ type: 'roll.toggleDie', die: 2 });
    h.send({ type: 'roll.toggleDie', die: 2 });
    expect([...h.controller.state.rollSelection]).toEqual([0]);
    h.send({ type: 'roll.go' });
    expect(h.host().calls().at(-1)?.args[0]).toEqual({
      type: 'roll',
      cup: false,
      table: [0],
      intoCup: [],
    });
    expect(h.controller.state.rollSelection.size).toBe(0);

    h.send({ type: 'roll.cup', on: true });
    h.send({ type: 'roll.go' });
    expect(h.host().calls().at(-1)?.args[0]).toEqual({
      type: 'roll',
      cup: true,
      table: [],
      intoCup: [],
    });

    // Tucking ticks the cup; un-tucking leaves it ticked.
    h.send({ type: 'roll.hidden', on: true });
    expect(h.controller.state).toMatchObject({ rollHidden: true, rollCup: true });
    h.send({ type: 'roll.hidden', on: false });
    expect(h.controller.state).toMatchObject({ rollHidden: false, rollCup: true });
    h.send({ type: 'roll.cup', on: false });
    h.send({ type: 'roll.hidden', on: true });
    h.send({ type: 'roll.toggleDie', die: 4 });
    h.send({ type: 'roll.go' });
    expect(h.host().calls().at(-1)?.args[0]).toEqual({
      type: 'roll',
      cup: true,
      table: [],
      intoCup: [4],
    });
  });

  test('the picker: query, move, enter to choose, enter again to bid, place, close', () => {
    const h = harness();
    hostALobby(h);
    h.host().events.onState(FACING, player(0));
    h.send({ type: 'picker.focus' });
    expect(h.controller.state.picker.listOpen).toBe(true);
    h.send({ type: 'picker.query', value: 'pair' });
    expect(h.controller.state.picker).toMatchObject({
      query: 'pair',
      highlight: 0,
      listOpen: true,
    });
    h.send({ type: 'picker.move', delta: 2 });
    h.send({ type: 'picker.move', delta: -5 });
    expect(h.controller.state.picker.highlight).toBe(0);
    h.send({ type: 'picker.move', delta: 1 });
    expect(h.controller.state.picker.highlight).toBe(1);
    h.send({ type: 'picker.enter' });
    const chosen = h.controller.state.picker.selected;
    expect(chosen).not.toBeNull();
    expect(h.controller.state.picker.listOpen).toBe(false);
    expect(h.host().calls()).toEqual([]);
    h.send({ type: 'picker.enter' });
    expect(h.host().calls().at(-1)?.args[0]).toEqual({ type: 'bid', rank: chosen });
    expect(h.controller.state.picker).toEqual(emptyPicker);
    // Enter with nothing selected and the list closed does nothing.
    h.send({ type: 'picker.enter' });
    h.send({ type: 'picker.place' });
    expect(h.host().calls()).toHaveLength(1);
    h.send({ type: 'picker.choose', rank: asRank(100) });
    expect(h.controller.state.picker).toMatchObject({ selected: 100, listOpen: false });
    h.send({ type: 'picker.place' });
    expect(h.host().calls().at(-1)?.args[0]).toEqual({ type: 'bid', rank: 100 });
    h.send({ type: 'picker.focus' });
    h.send({ type: 'picker.close' });
    expect(h.controller.state.picker.listOpen).toBe(false);
  });

  test('the ladder: toggle, expand all, jump and show the bid', () => {
    const h = harness();
    hostALobby(h);
    h.host().events.onState(FACING, player(0));
    const bidKey = `cat:${handAt(FIRST_BID).cat}`;
    // The bid's category reads as open (a mark inside it); toggling closes it.
    h.send({ type: 'ladder.toggle', ladder: 'main', key: bidKey });
    expect(h.controller.state.ladders.main.closed.has(bidKey)).toBe(true);
    h.send({ type: 'ladder.toggle', ladder: 'main', key: bidKey });
    expect(h.controller.state.ladders.main.closed.has(bidKey)).toBe(false);
    expect(h.controller.state.ladders.main.open.has(bidKey)).toBe(true);
    // A key naming no range falls back to the open set alone.
    h.send({ type: 'ladder.toggle', ladder: 'main', key: 'nope' });
    expect(h.controller.state.ladders.main.open.has('nope')).toBe(true);
    h.send({ type: 'ladder.toggle', ladder: 'main', key: 'nope' });
    expect(h.controller.state.ladders.main.closed.has('nope')).toBe(true);
    // The spec ladder from a seat uses the spectator marks over the game.
    h.send({ type: 'ladder.toggle', ladder: 'spec', key: 'cat:five' });
    expect(h.controller.state.ladders.spec.open.has('cat:five')).toBe(true);

    h.send({ type: 'ladder.expandAll', ladder: 'main' });
    expect(h.controller.state.ladders.main).toEqual({
      open: new Set(),
      closed: new Set(),
      allOpen: true,
    });
    h.send({ type: 'ladder.expandAll', ladder: 'main' });
    expect(h.controller.state.ladders.main.allOpen).toBe(false);

    h.send({ type: 'ladder.jump', cat: 'pair' });
    expect(h.controller.state.ladders.main.open.has('cat:pair')).toBe(true);
    expect(h.effectCalls().at(-1)).toEqual({ method: 'scrollIntoView', args: ['main-cat-pair'] });

    h.send({ type: 'ladder.showBid' });
    // Legacy defect kept (named in controller.ts): with a bid, the spread of the whole Ui from
    // withLadder puts the current tab back, so "See on ladder" opens the rows but stays on play.
    expect(h.controller.state.tab).toBe('play');
    expect(h.controller.state.ladders.main.open.has(bidKey)).toBe(true);
    expect(h.controller.state.ladders.main.open.has(handAt(FIRST_BID).groupKey)).toBe(true);
    expect(h.effectCalls().at(-1)).toEqual({
      method: 'scrollIntoView',
      args: [rowId('main', FIRST_BID)],
    });
  });

  test('showBid without a bid only switches tabs; a ladder toggle in the menu uses no marks', () => {
    const h = harness();
    h.controller.start();
    h.send({ type: 'ladder.showBid' });
    expect(h.controller.state.tab).toBe('ladder');
    expect(h.effectCalls().some((c) => c.method === 'scrollIntoView')).toBe(false);
    h.send({ type: 'ladder.toggle', ladder: 'spec', key: 'cat:pair' });
    expect(h.controller.state.ladders.spec.open.has('cat:pair')).toBe(true);
  });

  test('leaving a live table as the host asks first; declining keeps the table', () => {
    const declined = harness({ confirm: false });
    hostALobby(declined);
    declined.host().events.onState(OPENING, player(0));
    declined.send({ type: 'leave' });
    expect(declined.effectCalls().at(-1)).toEqual({
      method: 'confirm',
      args: ['You are the host — leaving closes the table for everyone. Leave?'],
    });
    expect(declined.host().calls()).toEqual([]);
    expect(declined.controller.state.screen).toBe('game');

    const agreed = harness({ confirm: true });
    hostALobby(agreed);
    agreed.host().events.onState(OPENING, player(0));
    agreed.send({ type: 'leave' });
    expect(agreed.host().calls()).toEqual([{ method: 'close', args: [] }]);
    expect(agreed.effectCalls()).toContainEqual({ method: 'setHash', args: [''] });
    expect(agreed.controller.state).toMatchObject({
      screen: 'menu',
      tab: 'play',
      pending: null,
      error: null,
      busy: null,
      game: null,
      role: null,
    });
    expect(agreed.has('screen-menu')).toBe(true);
  });

  test('leaving the lobby needs no confirmation', () => {
    const h = harness({ confirm: false });
    hostALobby(h);
    fire(requireId(h.root, 'btnLeave'), 'click');
    expect(h.effectCalls().some((c) => c.method === 'confirm')).toBe(false);
    expect(h.host().calls()).toEqual([{ method: 'close', args: [] }]);
    expect(h.controller.state.screen).toBe('menu');
  });
});

describe('the pure helpers', () => {
  const ladder = { open: new Set<string>(), closed: new Set<string>(), allOpen: false };

  test('toggleKey moves a key between the open and closed sets', () => {
    const closed = toggleKey(ladder, 'k', true);
    expect([...closed.closed]).toEqual(['k']);
    expect(closed.open.size).toBe(0);
    const opened = toggleKey(closed, 'k', false);
    expect([...opened.open]).toEqual(['k']);
    expect(opened.closed.size).toBe(0);
  });

  test('openPath opens the category and group of a rank and unlocks them', () => {
    const rank: Rank = asRank(40);
    const hnd = handAt(rank);
    const l = openPath({ ...ladder, closed: new Set([`cat:${hnd.cat}`, 'other']) }, rank);
    expect(l.open.has(`cat:${hnd.cat}`)).toBe(true);
    expect(l.open.has(hnd.groupKey)).toBe(true);
    expect([...l.closed]).toEqual(['other']);
  });

  test('withLadder patches one ladder and currentBid reads the round', () => {
    const ui = SCENARIOS['game: facing a bid, not my turn'];
    const next = withLadder(ui, 'spec', (l) => ({ ...l, allOpen: true }));
    expect(next.ladders.spec.allOpen).toBe(true);
    expect(next.ladders.main).toBe(ui.ladders.main);
    expect(currentBid(ui)).toBe(FIRST_BID);
    expect(currentBid(SCENARIOS.menu)).toBeNull();
    expect(currentBid(SCENARIOS['lobby: host'])).toBeNull();
  });

  test('reducePicker clamps the highlight and enter needs an open list with a hit', () => {
    const p = reducePicker(emptyPicker, { type: 'picker.query', value: 'zzzz' }, null);
    expect(reducePicker(p, { type: 'picker.move', delta: 3 }, null).highlight).toBe(0);
    expect(reducePicker(p, { type: 'picker.enter' }, null)).toBe(p);
    const closed = reducePicker(p, { type: 'picker.close' }, null);
    expect(reducePicker(closed, { type: 'picker.enter' }, null)).toBe(closed);
  });

  test('keyRange knows categories and groups, and nothing else', () => {
    const pair = keyRange('cat:pair');
    expect(pair).not.toBeNull();
    expect(pair !== null && pair.lo <= pair.hi).toBe(true);
    expect(keyRange('cat:nope')).toBeNull();
    const g = GROUPS[0];
    if (g === undefined) throw new Error('no groups');
    expect(keyRange(g.key)).toEqual({ lo: g.minRank, hi: g.maxRank });
    expect(keyRange('bogus')).toBeNull();
  });
});
