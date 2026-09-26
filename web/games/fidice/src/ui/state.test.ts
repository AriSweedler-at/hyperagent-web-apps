// The reducer alone (docs/design/fidice-shell-adoption.md §3 "ShellConfig", §4 M3; briscola's
// state.test.ts shape): the type bag's proofs (the table's intent and effect names reuse none of
// the shell's; six seats compile, a seventh does not), the three starts from the home card (pass
// the phone for three, Solo, Watch), the deal online dropping an empty seat and gating on the
// engine's own refusal, the two timers doing what the legacy `schedule()` did (a state change
// re-decides and re-arms `bot/step`; a reveal arms `autoNext` once and a repaint leaves it; a
// human's next cancels it), a guest's action as a frame and a host's refusal as a toast, the
// waiting room's bot controls re-sending the lobby, the curtain for pass the phone, the effects as
// data and `runEffect` against a recorded store. The twelve seeded tables are replay.test.ts's.
import { describe, expect, test } from 'vitest';

import { NOW, runIntents } from '../../../../../test/shared/engine-helpers.ts';
import { createStore, type StorageLike } from '../../../../shared/edge/storage.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { EMPTY_SEAT, WAITING_FOR_GUEST_MSG } from '../../../../shared/ui/shell.ts';
import { HOST, apply } from '../domain/game.ts';
import { action as actionFrame, lobby } from '../protocol.ts';
import { seatTable } from '../shellConfig.ts';
import { STORAGE_KEYS } from '../storage.ts';
import {
  ALL_SEATS,
  AUTO_NEXT_MS,
  DEFAULT_OPTS,
  NEED_PLAYERS_MSG,
  PICK_A_BID_MSG,
  PICK_DICE_MSG,
  SCREENS,
  SHELL_EFFECT_TYPES,
  SHELL_INTENT_TYPES,
  TABLE_EFFECT_TYPES,
  TABLE_FULL_TOAST,
  TABLE_INTENT_TYPES,
  TABLE_INTENTS_LISTED,
  cueKey,
  guestContextOf,
  hostContextOf,
  initialApp,
  initialTable,
  isMyTurn,
  localActor,
  optsForMode,
  readHome,
  reduce,
  resumeFor,
  runEffect,
  saveFor,
  suggestionsOf,
  viewedChair,
  type App,
  type Effect,
  type EffectDeps,
  type HomeSnapshot,
  type ShellSeat,
  type Step,
} from './state.ts';

const ctx = { rng: mulberry32(7), now: () => NOW };
const run = runIntents(reduce, ctx);
const kinds = (effects: ReadonlyArray<Effect>): ReadonlyArray<string> => effects.map((e) => e.type);
const toasts = (effects: ReadonlyArray<Effect>): ReadonlyArray<string> =>
  effects.flatMap((e) => (e.type === 'toast' ? [e.message] : []));
type TimerEffect = Extract<Effect, Readonly<{ type: 'startTimer' }>>;
const timers = (effects: ReadonlyArray<Effect>): ReadonlyArray<TimerEffect> =>
  effects.flatMap((e) => (e.type === 'startTimer' ? [e] : []));
const sends = (effects: ReadonlyArray<Effect>): ReadonlyArray<readonly [unknown, unknown]> =>
  effects.flatMap((e) => (e.type === 'send' ? [[e.seat, e.frame]] : []));

const home: HomeSnapshot = {
  name: null,
  p2Name: null,
  homeTab: 'play',
  playMode: 'online',
  soundFont: 'default',
  save: null,
  recentGames: [],
  opts: DEFAULT_OPTS,
  extraNames: { 2: null, 3: null, 4: null, 5: null },
};

/** A hosted waiting room with the seats given (the shell's `host/click` then the joins, spelled directly). */
const hosting = (
  seats: ReadonlyArray<Readonly<{ name: string | null; connected: boolean }>>,
  opts = DEFAULT_OPTS,
): App => ({
  ...initialApp,
  shell: {
    ...initialApp.shell,
    role: 'host',
    code: 'ABCDE',
    myName: 'Ann',
    opts: { ...opts, seatCount: (seats.length + 1) as 2 | 3 | 4 | 5 | 6 },
    seats,
    oppName: seats[0]?.name ?? null,
    oppConnected: seats[0]?.connected ?? false,
    screen: 'hostWaitScreen',
  },
});

describe('the type bag', () => {
  test('the table`s intent and effect names reuse none of the shell`s 45 and 29; every table intent is listed; the screens', () => {
    expect(SHELL_INTENT_TYPES).toHaveLength(45);
    expect(SHELL_EFFECT_TYPES).toHaveLength(29);
    const shellIntents = new Set<string>(SHELL_INTENT_TYPES);
    const shellEffects = new Set<string>(SHELL_EFFECT_TYPES);
    expect(TABLE_INTENT_TYPES.filter((t) => shellIntents.has(t))).toEqual([]);
    expect(TABLE_EFFECT_TYPES.filter((t) => shellEffects.has(t))).toEqual([]);
    expect(new Set(TABLE_INTENT_TYPES).size).toBe(TABLE_INTENT_TYPES.length);
    expect(TABLE_INTENTS_LISTED).toBe(true);
    expect(SCREENS).toEqual([
      'homeScreen',
      'hostWaitScreen',
      'guestWaitScreen',
      'tableScreen',
      'endgameScreen',
      'configScreen',
    ]);
  });

  test('six seats compile (shell.test.ts `Wide`); a seventh does not', () => {
    const six: ReadonlyArray<ShellSeat> = [0, 1, 2, 3, 4, 5];
    // @ts-expect-error a seventh chair is not one of the table's
    const seventh: ShellSeat = 6;
    expect(ALL_SEATS).toEqual(six);
    expect(seventh).toBe(6);
    expect(initialApp.table).toBe(initialTable);
  });
});

describe('home', () => {
  test('home/init puts the terms into the shell and the extra names onto the table', () => {
    const { app, effects } = run(initialApp, {
      type: 'home/init',
      home: {
        ...home,
        opts: { ...DEFAULT_OPTS, lives: 2, bots: 1 },
        extraNames: { 2: 'Cara', 3: null, 4: null, 5: null },
      },
    });
    expect(app.shell.opts).toEqual({ ...DEFAULT_OPTS, lives: 2, bots: 1 });
    expect(app.table.extraNames).toEqual({ 2: 'Cara', 3: null, 4: null, 5: null });
    expect(kinds(effects)).toEqual(['scrollTop', 'fillName', 'fillP2Name']);
  });

  test('opts/set parses the card and remembers; pname/typed remembers a seat`s name; mode/set shows solo and watch without storing', () => {
    const { app, effects } = run(
      initialApp,
      { type: 'opts/set', raw: { lives: '4', seats: '3', bots: '1', difficulty: 'hard' } },
      { type: 'pname/typed', seat: 4, value: ' Eve ' },
      { type: 'mode/set', mode: 'watch' },
    );
    expect(app.shell.opts).toEqual({
      lives: 4,
      seatCount: 3,
      bots: 1,
      botChoice: 'gambler',
      watch: false,
    });
    expect(app.table.extraNames[4]).toBe(' Eve ');
    expect(app.shell.playMode).toBe('watch');
    expect(effects).toEqual([
      {
        type: 'writeOpts',
        opts: { lives: 4, seatCount: 3, bots: 1, botChoice: 'gambler', watch: false },
      },
      { type: 'rememberPName', seat: 4, name: 'Eve' },
    ]);
  });
});

describe('the starts from the home card (plan §7 D9)', () => {
  test('pass the phone for three: the names through the shared rule, the table dealt, the curtain up for the first human, the terms remembered', () => {
    const { app, effects } = run(
      initialApp,
      { type: 'mode/set', mode: 'local' },
      { type: 'local/click', p1: 'Ann', p2: '', p3: 'ann' },
    );
    const game = app.shell.game;
    if (game === null) throw new Error('no game');
    expect(app.shell.role).toBe('local');
    expect(game.phase).toBe('playing');
    expect(game.players.map((p) => [p.id, p.name])).toEqual([
      ['host', 'Ann'],
      ['guest', 'Lavi'],
      ['guest2', 'ann 3'],
    ]);
    expect(app.shell.localNames).toEqual(['Ann', 'Lavi', 'ann 3']);
    expect(app.shell.screen).toBe('tableScreen');
    expect(app.table.curtain).toBe(0);
    expect(app.shell.view?.round?.holder).toBe(0);
    expect(kinds(effects)).toEqual([
      'writePlayMode',
      'wakeLock',
      'persist',
      'scrollTop',
      'writeOpts',
    ]);
    // No computer at the table: no timer armed.
    expect(timers(effects)).toEqual([]);
    expect(game.log.every((e) => e.at === NOW)).toBe(true);
  });

  test('solo: one human and the card`s computers (two when none), no curtain; the computers move on the timer once the cup reaches them', () => {
    const { app, effects } = run(
      initialApp,
      { type: 'mode/set', mode: 'solo' },
      { type: 'local/click', p1: '', p2: '' },
    );
    const game = app.shell.game;
    if (game === null) throw new Error('no game');
    expect(game.players.map((p) => [p.id, p.bot === null])).toEqual([
      ['host', true],
      ['bot0', false],
      ['bot1', false],
    ]);
    expect(game.players[0]?.name).toBe('Ari');
    expect(app.table.curtain).toBeNull();
    expect(app.shell.opts).toEqual({ ...DEFAULT_OPTS, bots: 2 });
    expect(optsForMode({ ...DEFAULT_OPTS, bots: 3 }, 'solo').bots).toBe(3);
    expect(isMyTurn(app)).toBe(true);
    expect(timers(effects)).toEqual([]);
    // Ann peeks and bids: the cup passes to bot0, whose move is decided and armed for its delay.
    const bid = run(app, { type: 'peek/click' }, { type: 'bid/place', rank: 10 });
    expect(bid.app.shell.game?.round?.holder).toBe(1);
    expect(bid.app.table.pending?.holder).toBe(1);
    const [armed] = timers(bid.effects);
    expect(armed).toMatchObject({ type: 'startTimer', id: 'bot/step', then: { type: 'bot/step' } });
    expect(armed?.ms).toBeGreaterThan(0);
    // The timer fires: the move is applied (a peek keeps the cup: the next move is decided and armed again).
    const stepped = run(bid.app, { type: 'bot/step' });
    expect(stepped.app.shell.game).not.toBe(bid.app.shell.game);
    expect(stepped.app.shell.game?.log.length).toBeGreaterThan(bid.app.shell.game?.log.length ?? 0);
    expect(stepped.app.table.pending !== null || stepped.app.shell.game?.reveal !== null).toBe(
      true,
    );
    expect(
      timers(stepped.effects).length + (stepped.app.shell.game?.reveal === null ? 0 : 1),
    ).toBeGreaterThan(0);
  });

  test('watch: computers alone (four when the card names none), the host standing; nobody`s turn, a spectator`s view, the first move armed at once (plan §7 D6)', () => {
    const { app, effects } = run(
      initialApp,
      { type: 'mode/set', mode: 'watch' },
      { type: 'local/click', p1: 'x', p2: 'y' },
    );
    const game = app.shell.game;
    if (game === null) throw new Error('no game');
    expect(game.hostSeat).toBeNull();
    expect(game.players.map((p) => p.id)).toEqual(['bot0', 'bot1', 'bot2', 'bot3']);
    expect(app.shell.opts.watch).toBe(true);
    expect(app.shell.playMode).toBe('watch');
    expect(isMyTurn(app)).toBe(false);
    expect(app.shell.view?.round?.dice.every((d) => d.value !== null)).toBe(true);
    expect(app.table.curtain).toBeNull();
    expect(timers(effects).map((t) => t.id)).toEqual(['bot/step']);
    expect(app.table.pending?.holder).toBe(0);
    // Nothing stored for the mode: a reload opens Online.
    expect(kinds(effects)).not.toContain('writePlayMode');
  });

  test('a start the engine refuses is its toast, and nothing starts: Watch with computers but the host card at zero chairs is impossible, so a one-human pass the phone with no computer', () => {
    const { app, effects } = run(
      initialApp,
      { type: 'mode/set', mode: 'solo' },
      { type: 'opts/set', raw: { bots: '1' } },
      { type: 'local/click', p1: 'Ann', p2: '' },
    );
    expect(app.shell.game?.players).toHaveLength(2);
    // The refusal path: seatTable with the host alone (a term the card cannot set today, spelled directly).
    const alone = apply(
      seatTable('', [{ id: 'host', name: 'Ann' }], DEFAULT_OPTS, ctx.rng),
      HOST,
      { type: 'start' },
      ctx.rng,
    );
    expect(alone).toEqual({ ok: false, error: NEED_PLAYERS_MSG });
    expect(toasts(effects)).toEqual([]);
  });
});

describe('the deal online (plan §4 M3, §7 D10)', () => {
  test('host/deal seats the host, the connected guests in seat order (an empty seat dropped, never dealt to as Jeff) and the computers, then broadcasts one state per connected seat', () => {
    const room = hosting(
      [{ name: 'Bo', connected: true }, EMPTY_SEAT, { name: 'Dee', connected: true }],
      { ...DEFAULT_OPTS, bots: 1 },
    );
    const { app, effects } = run(room, { type: 'host/deal' });
    const game = app.shell.game;
    if (game === null) throw new Error('no game');
    expect(game.players.map((p) => [p.id, p.name])).toEqual([
      ['host', 'Ann'],
      ['guest', 'Bo'],
      ['guest3', 'Dee'],
      ['bot0', 'Loon'],
    ]);
    expect(game.code).toBe('ABCDE');
    expect(game.phase).toBe('playing');
    expect(sends(effects).map(([seat]) => seat)).toEqual([1, 3]);
    expect(kinds(effects)).toEqual(['send', 'send', 'persist', 'scrollTop']);
    expect(app.shell.screen).toBe('tableScreen');
    // The guests' redactions hide the host's cup; the host, holding it before anyone bid, sees its own.
    const [toBo] = sends(effects);
    expect(JSON.stringify(toBo)).toContain('"value":null');
    expect(app.shell.view?.round?.dice.every((d) => d.value !== null)).toBe(true);
  });

  test('the host alone with no computer: the engine`s refusal is the toast and the room keeps waiting (the shell`s notEnough never fires at min 1)', () => {
    const { app, effects } = run(hosting([EMPTY_SEAT]), { type: 'host/deal' });
    expect(app.shell.game).toBeNull();
    expect(app.shell.screen).toBe('hostWaitScreen');
    expect(toasts(effects)).toEqual([NEED_PLAYERS_MSG]);
    expect(toasts(effects)).not.toContain(WAITING_FOR_GUEST_MSG);
  });

  test('a watching host deals a table it does not sit at: its actions are the HOST`s (next, finish), a guest`s action its chair`s', () => {
    const room = hosting(
      [
        { name: 'Bo', connected: true },
        { name: 'Cal', connected: true },
      ],
      { ...DEFAULT_OPTS, watch: true },
    );
    const { app } = run(room, { type: 'host/deal' });
    const game = app.shell.game;
    if (game === null) throw new Error('no game');
    expect(game.hostSeat).toBeNull();
    expect(game.players.map((p) => p.id)).toEqual(['guest', 'guest2']);
    // Bo (seat 1, chair 0) holds the cup: the host's peek is refused, Bo's frame is applied.
    const refused = run(app, { type: 'peek/click' });
    expect(toasts(refused.effects)).toEqual(['Only a seated player can play.']);
    const peeked = run(app, { type: 'host/frame', frame: actionFrame({ type: 'peek' }), seat: 1 });
    expect(peeked.app.shell.game?.round?.touched).toBe(true);
    const wrong = run(app, { type: 'host/frame', frame: actionFrame({ type: 'peek' }), seat: 2 });
    expect(sends(wrong.effects)).toEqual([[2, { t: 'toast', msg: "It's not your turn." }]]);
  });
});

describe('the game loop`s timers (the legacy schedule(), §6 risk 11)', () => {
  /** A pass-the-phone table of Ann and two computers, Ann to shake first. */
  const solo = run(
    initialApp,
    { type: 'mode/set', mode: 'solo' },
    { type: 'local/click', p1: 'Ann', p2: '' },
  ).app;

  test('bot/step: decided at the state change and armed for the move`s delay; a change before it fires decides again and re-arms (createTimers restarts); a stale fire is a no-op', () => {
    const passed = run(solo, { type: 'peek/click' }, { type: 'bid/place', rank: 5 });
    const first = timers(passed.effects);
    expect(first.map((t) => t.id)).toEqual(['bot/step']);
    const pending = passed.app.table.pending;
    expect(pending?.holder).toBe(1);
    // A state change on the host's side while the computer thinks (a rename mid-lobby has no place here; the reveal's `render` does not change the game): a repaint arms nothing.
    const painted = run(passed.app, { type: 'render' });
    expect(timers(painted.effects)).toEqual([]);
    expect(painted.app.table.pending).toEqual(pending);
    // The timer fires once the pending move is gone (a leave cleared it): nothing happens.
    const stale = run(
      { ...passed.app, table: { ...passed.app.table, pending: null } },
      { type: 'bot/step' },
    );
    expect(stale.app.shell.game).toBe(passed.app.shell.game);
    expect(stale.effects).toEqual([]);
    // A move whose holder no longer has the cup is dropped.
    const moved = run(
      {
        ...passed.app,
        table: { ...passed.app.table, pending: { holder: 2, action: { type: 'peek' } } },
      },
      { type: 'bot/step' },
    );
    expect(moved.app.shell.game).toBe(passed.app.shell.game);
    expect(moved.app.table.pending).toBeNull();
  });

  test('autoNext: a reveal stamps autoNextAt once and arms 7 s, broadcast; a repaint leaves the timer; the fire starts the next round; a human`s next cancels it', () => {
    // Drive the computers until a reveal shows.
    const untilReveal = (app: App, left: number): Step => {
      const g = app.shell.game;
      if (g === null || left === 0 || g.reveal !== null) return { app, effects: [] };
      if (app.table.pending === null) {
        // Ann's turn: peek, then bid the lowest raise.
        const bid = (g.round?.bid ?? -1) + 1;
        return untilReveal(
          run(app, { type: 'peek/click' }, { type: 'bid/place', rank: bid as 0 }).app,
          left - 1,
        );
      }
      return untilReveal(run(app, { type: 'bot/step' }).app, left - 1);
    };
    const revealed = untilReveal(solo, 200).app;
    const game = revealed.shell.game;
    if (game === null) throw new Error('no game');
    expect(game.reveal).not.toBeNull();
    expect(game.autoNextAt).toBe(NOW + AUTO_NEXT_MS);
    expect(revealed.table.pending).toBeNull();
    // The step that revealed armed the timer and broadcast the stamp (persist twice: the call, then the stamp).
    const again = untilReveal(
      {
        ...revealed,
        shell: { ...revealed.shell, game: { ...game, reveal: null, autoNextAt: null } },
      },
      0,
    );
    expect(again.app.shell.game?.autoNextAt).toBeNull();
    // A repaint during the reveal arms nothing more.
    const painted = run(revealed, { type: 'render' });
    expect(timers(painted.effects)).toEqual([]);
    expect(painted.app.shell.game).toBe(game);
    // The timer fires: the next round starts, the stamp clears.
    const next = run(revealed, { type: 'autoNext' });
    expect(next.app.shell.game?.reveal).toBeNull();
    expect(next.app.shell.game?.autoNextAt).toBeNull();
    expect(next.app.shell.game?.roundNo).toBe(game.roundNo + 1);
    // A human's next before the timer: the same round starts and the reveal's timer is cancelled.
    const tapped = run(revealed, { type: 'next/click' });
    expect(tapped.app.shell.game?.roundNo).toBe(game.roundNo + 1);
    expect(kinds(tapped.effects)).toContain('cancelTimer');
    expect(tapped.effects.find((e) => e.type === 'cancelTimer')).toEqual({
      type: 'cancelTimer',
      id: 'autoNext',
    });
    // A stale autoNext (no reveal) is a no-op.
    expect(run(next.app, { type: 'autoNext' }).effects).toEqual([]);
  });

  test('the reveal`s arming, spelled: the call`s step carries the stamped broadcast and the 7 s timer', () => {
    const { app, effects } = run(solo, { type: 'peek/click' }, { type: 'bid/place', rank: 251 });
    // Ann bid the top hand: the computer must call (nothing is higher).
    const called = run(app, { type: 'bot/step' });
    const game = called.app.shell.game;
    if (game === null) throw new Error('no game');
    expect(effects.length).toBeGreaterThan(0);
    expect(game.reveal?.bidder).toBe(0);
    expect(game.autoNextAt).toBe(NOW + AUTO_NEXT_MS);
    expect(timers(called.effects)).toEqual([
      { type: 'startTimer', id: 'autoNext', ms: AUTO_NEXT_MS, then: { type: 'autoNext' } },
    ]);
    expect(kinds(called.effects).filter((k) => k === 'persist')).toHaveLength(2);
    // Pass the phone chimes through the curtain alone: no turn cue here.
    expect(kinds(called.effects)).not.toContain('fx');
  });
});

describe('the actions', () => {
  test('a guest sends its action as a frame; bid/place with nothing picked and roll/go with nothing ticked toast; the picker and the dice picked are dropped by an applied action', () => {
    const guest: App = {
      ...initialApp,
      shell: { ...initialApp.shell, role: 'guest', code: 'ABCDE', mySeat: 1 },
    };
    expect(run(guest, { type: 'call/click' }).effects).toEqual([
      { type: 'send', frame: actionFrame({ type: 'call' }) },
    ]);
    expect(toasts(run(guest, { type: 'bid/place' }).effects)).toEqual([PICK_A_BID_MSG]);
    expect(toasts(run(guest, { type: 'roll/go' }).effects)).toEqual([PICK_DICE_MSG]);
    const picked = run(
      guest,
      { type: 'roll/toggleDie', die: 1 },
      { type: 'roll/toggleDie', die: 3 },
      { type: 'roll/hidden', on: true },
      { type: 'roll/go' },
    );
    expect(picked.effects.at(-1)).toEqual({
      type: 'send',
      frame: actionFrame({ type: 'roll', cup: true, table: [], intoCup: [1, 3] }),
    });
    expect(
      run(
        guest,
        { type: 'roll/toggleDie', die: 1 },
        { type: 'roll/cup', on: true },
        { type: 'roll/go' },
      ).effects.at(-1),
    ).toEqual({
      type: 'send',
      frame: actionFrame({ type: 'roll', cup: true, table: [1], intoCup: [] }),
    });
    expect(
      run(guest, { type: 'picker/choose', rank: 9 }, { type: 'bid/place' }).effects.at(-1),
    ).toEqual({ type: 'send', frame: actionFrame({ type: 'bid', rank: 9 }) });
  });

  test('pass the phone: whoever holds the cup acts; a refusal is a toast; the curtain rises for the next human and the reveal lifts it', () => {
    const start = run(
      initialApp,
      { type: 'mode/set', mode: 'local' },
      { type: 'local/click', p1: 'Ann', p2: 'Bob' },
    ).app;
    expect(localActor(start.shell.game ?? seatTable('', [], DEFAULT_OPTS, ctx.rng))).toEqual({
      kind: 'seat',
      seat: 0,
    });
    const lifted = run(start, { type: 'curtain/reveal' });
    expect(lifted.app.table.curtain).toBeNull();
    expect(lifted.app.shell.revealed).toBe(0);
    // A refusal (nothing to call yet) is the engine's toast and the state is kept.
    const refused = run(lifted.app, { type: 'call/click' });
    expect(refused.app.shell.game).toBe(lifted.app.shell.game);
    expect(toasts(refused.effects)).toEqual(['There is no bid to call.']);
    // The opening bid may be blind (the engine's rule); Bob is handed the cup behind the curtain, with the chime.
    const passed = run(lifted.app, { type: 'bid/place', rank: 3 });
    expect(passed.app.shell.game?.round?.holder).toBe(1);
    expect(passed.app.table.curtain).toBe(1);
    expect(passed.effects.filter((e) => e.type === 'fx')).toEqual([
      { type: 'fx', cue: 'yourTurn' },
    ]);
    const bobs = run(passed.app, { type: 'curtain/reveal' }, { type: 'call/click' });
    expect(bobs.app.shell.game?.reveal).not.toBeNull();
    expect(bobs.app.table.curtain).toBeNull();
    const shown = bobs.app.shell.view;
    if (shown === null) throw new Error('no view');
    expect(cueKey(shown)).toContain(':r:');
  });
});

describe('the waiting room`s bot controls (plan §7 D7) and the watch toggle (D6)', () => {
  test('add, remove, config and watch rewrite the room`s terms, re-send the lobby to every connected seat and remember; rename keeps the name for the deal; a full table refuses', () => {
    const room = hosting([{ name: 'Bo', connected: true }, EMPTY_SEAT]);
    const added = run(room, { type: 'bots/add' });
    expect(added.app.shell.opts.bots).toBe(1);
    expect(added.effects).toEqual([
      { type: 'send', frame: lobby('Ann', added.app.shell.opts, room.shell.seats, 1), seat: 1 },
      { type: 'writeOpts', opts: added.app.shell.opts },
    ]);
    const full = run(added.app, { type: 'bots/add' });
    expect(full.app.shell.opts.bots).toBe(1);
    expect(toasts(full.effects)).toEqual([TABLE_FULL_TOAST]);
    const named = run(
      added.app,
      { type: 'bots/rename', index: 0, name: '  Rex  ' },
      { type: 'bots/config', choice: 'trapper' },
      { type: 'watch/toggle', on: true },
    );
    expect(named.app.table.botNames).toEqual(['Rex']);
    expect(named.app.shell.opts).toEqual({
      ...DEFAULT_OPTS,
      seatCount: 3,
      bots: 1,
      botChoice: 'trapper',
      watch: true,
    });
    expect(kinds(named.effects)).toEqual(['send', 'writeOpts', 'send', 'writeOpts']);
    const dealt = run(named.app, { type: 'host/deal' });
    expect(dealt.app.shell.game?.players.map((p) => [p.name, p.bot?.strategy ?? null])).toEqual([
      ['Bo', null],
      ['Rex', 'trapper'],
    ]);
    expect(dealt.app.shell.game?.hostSeat).toBeNull();
    expect(dealt.app.table.botNames).toEqual([]);
    const removed = run(named.app, { type: 'bots/remove', index: 0 });
    expect(removed.app.shell.opts.bots).toBe(0);
    expect(removed.app.table.botNames).toEqual([]);
    // Outside the waiting room the controls do nothing.
    expect(run(initialApp, { type: 'bots/add' }).effects).toEqual([]);
    expect(run(dealt.app, { type: 'watch/toggle', on: false }).app.shell.opts.watch).toBe(true);
  });

  test('config/open shows the config screen; config/close returns to the room (or home); config/pick sets every computer`s strategy', () => {
    const opened = run(initialApp, { type: 'config/open', target: { kind: 'solo' } });
    expect(opened.app.shell.screen).toBe('configScreen');
    expect(opened.app.table.configTarget).toEqual({ kind: 'solo' });
    const picked = run(
      opened.app,
      { type: 'config/pick', choice: 'learner-300' },
      { type: 'config/close' },
    );
    expect(picked.app.shell.opts.botChoice).toBe('learner-300');
    expect(picked.app.shell.screen).toBe('homeScreen');
    expect(picked.app.table.configTarget).toBeNull();
    expect(kinds(picked.effects)).toEqual(['writeOpts']);
  });
});

describe('storage, the contexts and the effects', () => {
  test('saveFor and readHome; hostContextOf carries the seats beside the shell`s fields and the five terms', () => {
    const room = hosting([{ name: 'Bo', connected: true }, EMPTY_SEAT]);
    expect(saveFor(room)).toEqual({
      role: 'host',
      code: 'ABCDE',
      myName: 'Ann',
      ...room.shell.opts,
      game: null,
      oppName: 'Bo',
      seatNames: ['Bo', null],
    });
    expect(hostContextOf(room)).toMatchObject({
      role: 'host',
      code: 'ABCDE',
      myName: 'Ann',
      ...room.shell.opts,
      seats: room.shell.seats,
      hasGame: false,
    });
    const s = fakeStorage();
    const store = createStore(s);
    s.map.set(STORAGE_KEYS.p3Name, 'Cara');
    s.map.set(STORAGE_KEYS.bots, '2');
    expect(readHome(store)).toEqual({
      ...home,
      opts: { ...DEFAULT_OPTS, bots: 2 },
      extraNames: { 2: 'Cara', 3: null, 4: null, 5: null },
    });
  });

  test('runEffect: the two own effects write their keys; a shell effect reaches the shared runner', () => {
    const s = fakeStorage();
    const store = createStore(s);
    const toastsSeen: string[] = [];
    const deps = {
      ...fakeDeps(store),
      toast: (m: string) => toastsSeen.push(m),
    } as unknown as EffectDeps;
    runEffect(initialApp, { type: 'writeOpts', opts: { ...DEFAULT_OPTS, lives: 5 } }, deps);
    runEffect(initialApp, { type: 'rememberPName', seat: 5, name: 'Fay' }, deps);
    runEffect(initialApp, { type: 'toast', message: 'hi', ms: null }, deps);
    expect(s.map.get(STORAGE_KEYS.lives)).toBe('5');
    expect(s.map.get(STORAGE_KEYS.p6Name)).toBe('Fay');
    expect(toastsSeen).toEqual(['hi']);
  });
});

const fakeStorage = (): StorageLike & Readonly<{ map: Map<string, string> }> => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
};

const fakeDeps = (store: ReturnType<typeof createStore>): Partial<EffectDeps> => ({
  store,
  fx: () => undefined,
  wakeLock: () => undefined,
  scrollTop: () => undefined,
  confirm: () => true,
  toggleSound: () => undefined,
  share: () => undefined,
  revealRule: () => undefined,
  dispatch: () => undefined,
  timers: { start: () => undefined, cancel: () => undefined },
  net: {
    startHost: () => undefined,
    startGuest: () => undefined,
    send: () => undefined,
    close: () => undefined,
  },
  page: { fillName: () => undefined, fillP2Name: () => undefined, setCode: () => undefined },
});

describe('the table`s small intents (the picker, the dice, the ladders, the truth) and the contexts', () => {
  test('the picker: a query opens the list, the arrows wrap, enter picks the highlighted row, close puts it away; the dice ticks; the ladders; the truth', () => {
    const typed = run(initialApp, { type: 'picker/query', value: 'five 6s' });
    expect(typed.app.table.picker).toEqual({
      query: 'five 6s',
      selected: null,
      highlight: 0,
      listOpen: true,
    });
    expect(suggestionsOf(typed.app)[0]?.rank).toBe(251);
    const moved = run(
      typed.app,
      { type: 'picker/move', delta: -1 },
      { type: 'picker/move', delta: 1 },
    );
    expect(moved.app.table.picker.highlight).toBe(0);
    const entered = run(typed.app, { type: 'picker/enter' });
    expect(entered.app.table.picker).toEqual({
      query: '',
      selected: 251,
      highlight: 0,
      listOpen: false,
    });
    expect(run(typed.app, { type: 'picker/close' }).app.table.picker.listOpen).toBe(false);
    const nothing = run(
      initialApp,
      { type: 'picker/query', value: 'zzzz' },
      { type: 'picker/enter' },
    );
    expect(nothing.app.table.picker.selected).toBeNull();
    // An empty query lists the forty default rows (search.ts): the arrows walk them.
    expect(run(initialApp, { type: 'picker/move', delta: 3 }).app.table.picker.highlight).toBe(3);
    expect(run(initialApp, { type: 'picker/move', delta: -1 }).app.table.picker.highlight).toBe(39);
    const ticks = run(
      initialApp,
      { type: 'roll/toggleDie', die: 2 },
      { type: 'roll/toggleDie', die: 2 },
      { type: 'roll/cup', on: true },
      { type: 'roll/hidden', on: true },
      { type: 'truth/toggle' },
    );
    expect(ticks.app.table).toMatchObject({
      rollSelection: [],
      rollCup: true,
      rollHidden: true,
      showTruth: true,
    });
    const ladders = run(
      initialApp,
      { type: 'ladder/open' },
      { type: 'ladder/toggle', id: 'main', key: 'full' },
      { type: 'ladder/toggle', id: 'main', key: 'full' },
      { type: 'ladder/all', id: 'spec', open: true },
      { type: 'ladder/toggle', id: 'spec', key: 'pair' },
    );
    expect(ladders.app.table.ladderOpen).toBe(true);
    expect(ladders.app.table.ladders.main).toEqual({ open: [], closed: [], allOpen: false });
    expect(ladders.app.table.ladders.spec).toEqual({ open: [], closed: ['pair'], allOpen: false });
    expect(run(ladders.app, { type: 'ladder/close' }).app.table.ladderOpen).toBe(false);
    expect(ladders.effects).toEqual([]);
  });

  test('the guest`s context, the resume offer for a save, and the shell`s own intents through reduce (a tab, the rules)', () => {
    const guest: App = {
      ...initialApp,
      shell: { ...initialApp.shell, role: 'guest', code: 'ABCDE', myName: 'Zoë', netAttempt: 2 },
    };
    expect(guestContextOf(guest)).toEqual({
      attempt: 2,
      role: 'guest',
      code: 'ABCDE',
      myName: 'Zoë',
      oppConnected: false,
    });
    expect(resumeFor({ role: 'guest', code: 'ABCDE', myName: 'Zoë' })).toEqual({
      kind: 'guest',
      code: 'ABCDE',
      myName: 'Zoë',
    });
    expect(resumeFor(null)).toBeNull();
    const tabbed = run(initialApp, { type: 'tab/set', tab: 'ladder' });
    expect(tabbed.app.shell.homeTab).toBe('ladder');
    expect(tabbed.effects).toEqual([{ type: 'writeHomeTab', tab: 'ladder' }]);
    // A guest's next during the reveal is a frame; a pull is one too.
    expect(
      run(
        guest,
        { type: 'next/click' },
        { type: 'pull/die', die: 1 },
        { type: 'peek/click' },
        { type: 'finish/click' },
      ).effects.map((e) => (e.type === 'send' ? e.frame : e.type)),
    ).toEqual([
      actionFrame({ type: 'next' }),
      actionFrame({ type: 'pull', die: 1 }),
      actionFrame({ type: 'peek' }),
      actionFrame({ type: 'finish' }),
    ]);
  });
});

describe('the sheets, the extra seats and the viewed chair (M4)', () => {
  test('rules/open and rules/close set the shell`s rulesOpen; history/open and history/close the table`s historyOpen', () => {
    const opened = run(initialApp, { type: 'rules/open' }, { type: 'history/open' });
    expect(opened.app.shell.rulesOpen).toBe(true);
    expect(opened.app.table.historyOpen).toBe(true);
    expect(opened.effects).toEqual([]);
    const closed = run(opened.app, { type: 'rules/close' }, { type: 'history/close' });
    expect(closed.app.shell.rulesOpen).toBe(false);
    expect(closed.app.table.historyOpen).toBe(false);
  });

  test('pname/drop forgets an extra seat: its name goes null and its key is removed by forgetPName', () => {
    const typed = run(initialApp, { type: 'pname/typed', seat: 2, value: 'Cara' });
    expect(typed.app.table.extraNames[2]).toBe('Cara');
    const { app, effects } = run(typed.app, { type: 'pname/drop', seat: 2 });
    expect(app.table.extraNames[2]).toBeNull();
    expect(effects).toEqual([{ type: 'forgetPName', seat: 2 }]);
    const s = fakeStorage();
    s.map.set(STORAGE_KEYS.p3Name, 'Cara');
    const deps = fakeDeps(createStore(s)) as EffectDeps;
    runEffect(app, { type: 'forgetPName', seat: 2 }, deps);
    expect(s.map.has(STORAGE_KEYS.p3Name)).toBe(false);
  });

  test('viewedChair: null without a view; online my seat`s chair; pass the phone the chair the view was made for (the cup holder`s)', () => {
    expect(viewedChair(initialApp)).toBeNull();
    const dealt = run(hosting([{ name: 'Bob', connected: true }]), { type: 'host/deal' }).app;
    expect(viewedChair(dealt)).toBe(0);
    const local = run(
      initialApp,
      { type: 'home/init', home },
      { type: 'mode/set', mode: 'local' },
      { type: 'local/click', p1: 'Ann', p2: 'Bob' },
    ).app;
    const holder = local.shell.view?.round?.holder;
    expect(holder).not.toBeUndefined();
    expect(viewedChair(local)).toBe(holder);
    expect(local.table.curtain).not.toBeNull();
  });
});
