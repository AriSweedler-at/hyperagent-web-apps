// Representative UI states for the view tests (docs/MIGRATION.md step 9): one catalogue, used by
// the per-screen render tests beside the screens and by test/parity/fidice.view.test.ts, which
// renders each state through the typed view and the legacy view code and compares the trees and
// the intents every handler dispatches. Game states come from the domain itself (a seeded rng, the
// lobby constructors, `startGame` and `apply`), redacted for the viewer as the host would send them,
// so the dice, log lines and reveal are real ones. DOM-free: tsconfig.node.json lists this module.
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { CHECKPOINTS } from '../bots/strategies/learnerWeights.ts';
import {
  HOST,
  apply,
  bySeat,
  newGame,
  scheduleAutoNext,
  seat,
  stampLog,
  startGame,
} from '../domain/game.ts';
import { TOP_RANK, asRank, handAt } from '../domain/hands.ts';
import { makeBot, makeHuman, seatPlayer, withSpectators } from '../domain/lobby.ts';
import { redactFor } from '../domain/publicState.ts';
import type { Result } from '../domain/result.ts';
import type { Action, PublicState, Rank, Seat, State, Viewer } from '../domain/types.ts';
import type { Ui } from './types.ts';
import { initialUi } from './ui.ts';

const SHARE_BASE = 'https://games.example/games/fidice/';
const CODE = 'KEZAR';
/** A fixed clock reading for `ui.now` and the stamped log. */
const NOW = 1_700_000_000_000;

const must = <T>(r: Result<T, string>, what: string): T => {
  if (!r.ok) throw new Error(`${what}: ${r.error}`);
  return r.value;
};

const rng = mulberry32(7);

const seated = (lives: number): State => {
  const g0 = newGame(CODE, lives);
  const g1 = must(seatPlayer(g0, makeHuman('host-id', 'Ari', lives)), 'seat host');
  const g2 = must(seatPlayer(g1, makeHuman('guest-id', 'Tyler', lives)), 'seat guest');
  const g3 = must(
    seatPlayer(g2, makeBot(g2, 'bot-1', { strategy: 'profiler', random: false })),
    'seat bot 1',
  );
  const g4 = must(
    seatPlayer(g3, makeBot(g3, 'bot-2', { strategy: 'gambler', random: true })),
    'seat bot 2',
  );
  return withSpectators(g4, 2);
};

const play = (s: State, who: Seat, action: Action, what: string): State =>
  must(apply(s, bySeat(who), action, rng), what);

/** The lobby as the host built it: two people, two computers, two spectators. */
const LOBBY: State = stampLog(seated(0), NOW);
/** Seat 0 opens the round. */
const OPENING: State = must(startGame(LOBBY, rng), 'start');
/** The opener pulled two dice out onto the table. */
const OPENER_PULLED: State = play(
  play(OPENING, seat(0), { type: 'pull', die: 0 }, 'pull 0'),
  seat(0),
  { type: 'pull', die: 1 },
  'pull 1',
);
const FIRST_BID: Rank = asRank(40);
const SECOND_BID: Rank = asRank(60);
/** A hand in a collapsible group, opened by hand in the ladder scenario. */
const OPENED_GROUP: Rank = asRank(100);
/** Seat 1 faces the opener's bid, untouched. */
const FACING: State = play(OPENER_PULLED, seat(0), { type: 'bid', rank: FIRST_BID }, 'bid 40');
/** Seat 1 accepted the cup. */
const TOUCHED: State = play(FACING, seat(1), { type: 'peek' }, 'peek');
/** ... and rolled the cup. */
const ROLLED: State = play(
  TOUCHED,
  seat(1),
  { type: 'roll', cup: true, table: [], intoCup: [] },
  'roll',
);
/** Seat 2 called seat 1's raise: the cup is lifted. */
const REVEALED: State = scheduleAutoNext(
  play(
    play(ROLLED, seat(1), { type: 'bid', rank: SECOND_BID }, 'bid 60'),
    seat(2),
    { type: 'call' },
    'call',
  ),
  NOW + 7000,
);
/** The host ended a scored game after that round. */
const FINISHED: State = must(apply(REVEALED, HOST, { type: 'finish' }, rng), 'finish');
/** Seat 1 faces the very top of the ladder. */
const MAXED: State = play(OPENING, seat(0), { type: 'bid', rank: TOP_RANK }, 'bid top');

/** A two-kayak table where the first lost call knocks a player out and ends the game. */
const KAYAKS_OVER: State = ((): State => {
  const g0 = newGame(CODE, 1);
  const g1 = must(seatPlayer(g0, makeHuman('host-id', 'Ari', 1)), 'seat host');
  const g2 = must(seatPlayer(g1, makeHuman('guest-id', 'Tyler', 1)), 'seat guest');
  const started = must(startGame(g2, rng), 'start kayaks');
  const bid = play(started, seat(0), { type: 'bid', rank: asRank(200) }, 'bid 200');
  return play(bid, seat(1), { type: 'call' }, 'call kayaks');
})();

/** A table of four computers the host only watches. */
const BOT_TABLE: State = ((): State => {
  const g0: State = { ...newGame(CODE, 0), hostSeat: null };
  const profiles: ReadonlyArray<string> = ['profiler', 'gambler', 'pressure', 'profiler'];
  return profiles.reduce<State>(
    (s, strategy, k) =>
      must(
        seatPlayer(s, makeBot(s, `bot-${String(k)}`, { strategy, random: k === 3 })),
        `seat bot ${String(k)}`,
      ),
    g0,
  );
})();

const LEARNER_GENERATION = CHECKPOINTS[0]?.generation ?? 0;
/** The lobby with the second computer set to the self-taught strategy. */
const LOBBY_WITH_LEARNER: State = {
  ...LOBBY,
  players: LOBBY.players.map((p, i) =>
    i === 3
      ? { ...p, bot: { strategy: `learner-${String(LEARNER_GENERATION)}`, random: false } }
      : p,
  ),
};

const asSeat = (s: State, mySeat: Seat): PublicState =>
  redactFor(s, { kind: 'seat', seat: mySeat });
const asSpectator = (s: State): PublicState => redactFor(s, { kind: 'spectator' });
const viewerOf = (mySeat: Seat | null): Viewer =>
  mySeat === null ? { kind: 'spectator' } : { kind: 'seat', seat: mySeat };

const base: Ui = initialUi(SHARE_BASE, 'Ari');

const hostAt = (s: State, mySeat: Seat, patch: Partial<Ui> = {}): Ui => ({
  ...base,
  role: 'host',
  mySeat,
  game: redactFor(s, viewerOf(mySeat)),
  screen: 'game',
  now: NOW,
  ...patch,
});

const guestAt = (s: State, mySeat: Seat, patch: Partial<Ui> = {}): Ui => ({
  ...base,
  role: 'player',
  mySeat,
  game: asSeat(s, mySeat),
  screen: 'game',
  now: NOW,
  ...patch,
});

const watching = (s: State, patch: Partial<Ui> = {}): Ui => ({
  ...base,
  role: 'spectator',
  mySeat: null,
  game: asSpectator(s),
  screen: 'spec',
  now: NOW,
  ...patch,
});

const scenarios = {
  menu: base,
  'menu with a toast': { ...base, toast: 'Link copied' },
  'name: host': { ...base, screen: 'name', pending: { kind: 'host' } },
  'name: solo, a preset': { ...base, screen: 'name', pending: { kind: 'solo', bots: 2 } },
  'name: solo, a custom choice': {
    ...base,
    screen: 'name',
    pending: { kind: 'solo', bots: 2 },
    nameForm: { ...base.nameForm, botChoice: 'random', lives: 3 },
  },
  'name: pass the phone, two more players': {
    ...base,
    screen: 'name',
    pending: { kind: 'local' },
    nameForm: { ...base.nameForm, locals: ['Bea', ''] },
  },
  'name: pass the phone, five players': {
    ...base,
    screen: 'name',
    pending: { kind: 'local' },
    nameForm: { ...base.nameForm, locals: ['Bea', 'Cal', 'Dee', 'Eve', 'Fay'] },
  },
  'name: join, code typed': {
    ...base,
    screen: 'name',
    pending: { kind: 'join', code: CODE },
    joinCode: CODE,
  },
  'name: join, short code, with an error': {
    ...base,
    screen: 'name',
    pending: { kind: 'join', code: '' },
    joinCode: 'KE',
    error: 'No lobby found with that code.',
  },
  'lobby: host': hostAt(LOBBY, seat(0), { screen: 'lobby' }),
  'lobby: host, busy': hostAt(LOBBY, seat(0), { screen: 'lobby', busy: 'Starting…' }),
  'lobby: host alone': hostAt(
    must(seatPlayer(newGame(CODE, 3), makeHuman('host-id', 'Ari', 3)), 'seat host'),
    seat(0),
    { screen: 'lobby' },
  ),
  'lobby: host watching': hostAt({ ...LOBBY, hostSeat: null }, seat(0), {
    screen: 'lobby',
    mySeat: null,
  }),
  'lobby: guest': guestAt(LOBBY, seat(1), { screen: 'lobby' }),
  'lobby: pass the phone': hostAt(LOBBY, seat(0), { screen: 'lobby', localTable: true }),
  'game: opener, my turn': hostAt(OPENING, seat(0)),
  'game: opener, dice out, one selected to roll hidden': hostAt(OPENER_PULLED, seat(0), {
    rollSelection: new Set([0]),
    rollHidden: true,
  }),
  'game: opener, dice out, cup ticked': hostAt(OPENER_PULLED, seat(0), { rollCup: true }),
  'game: facing a bid, untouched': guestAt(FACING, seat(1)),
  'game: facing a bid, not my turn': hostAt(FACING, seat(0)),
  'game: touched, picker open': guestAt(TOUCHED, seat(1), {
    picker: { query: '3s', selected: null, highlight: 1, listOpen: true },
  }),
  'game: touched, a hand picked': guestAt(TOUCHED, seat(1), {
    picker: { query: 'four 6s', selected: asRank(100), highlight: 0, listOpen: false },
  }),
  'game: rolled': guestAt(ROLLED, seat(1)),
  'game: facing the top bid': guestAt(MAXED, seat(1)),
  'game: revealed, I lost': guestAt(REVEALED, REVEALED.reveal?.loser ?? seat(1), {
    now: NOW + 1200,
  }),
  'game: revealed, someone else lost': hostAt(REVEALED, seat(3), { now: NOW + 1200 }),
  'game: over, scored': hostAt(FINISHED, seat(0)),
  'game: over, kayaks': hostAt(KAYAKS_OVER, seat(0)),
  'game: pass the phone, cover': hostAt(FACING, seat(0), {
    localTable: true,
    handoff: { seat: seat(1), stage: 'cover' },
  }),
  'game: pass the phone, confirm': hostAt(FACING, seat(0), {
    localTable: true,
    handoff: { seat: seat(1), stage: 'confirm' },
  }),
  'spec: hosting a table of computers': {
    ...base,
    role: 'host',
    mySeat: null,
    game: asSpectator(BOT_TABLE),
    screen: 'spec',
  },
  'spec: lobby': watching(LOBBY),
  'spec: playing, truth hidden': watching(TOUCHED),
  'spec: playing, truth shown': watching(TOUCHED, { showTruth: true }),
  'spec: revealed': watching(REVEALED),
  'spec: over': watching(FINISHED),
  'spec: busy': watching(LOBBY, { busy: 'Connecting…' }),
  'ladder: collapsed': { ...base, tab: 'ladder' },
  'ladder: a bid marked, a group opened, its category closed': {
    ...hostAt(FACING, seat(0)),
    tab: 'ladder',
    ladders: {
      ...base.ladders,
      main: {
        open: new Set([`cat:${handAt(OPENED_GROUP).cat}`, handAt(OPENED_GROUP).groupKey]),
        closed: new Set([`cat:${handAt(FIRST_BID).cat}`]),
        allOpen: false,
      },
    },
  },
  'ladder: everything open': {
    ...base,
    tab: 'ladder',
    ladders: { ...base.ladders, main: { ...base.ladders.main, allOpen: true } },
  },
  rules: { ...base, tab: 'rules' },
  'config: the solo form': {
    ...base,
    screen: 'name',
    pending: { kind: 'solo', bots: 2 },
    configTarget: { kind: 'solo' },
  },
  'config: a seated computer': hostAt(LOBBY, seat(0), {
    screen: 'lobby',
    configTarget: { kind: 'seat', seat: seat(3) },
  }),
  'config: a self-taught computer': hostAt(LOBBY_WITH_LEARNER, seat(0), {
    screen: 'lobby',
    configTarget: { kind: 'seat', seat: seat(3) },
  }),
} satisfies Readonly<Record<string, Ui>>;

export type ScenarioName = keyof typeof scenarios;

/** Every catalogued state, by name. */
export const SCENARIOS: Readonly<Record<ScenarioName, Ui>> = scenarios;

export const SCENARIO_NAMES: ReadonlyArray<ScenarioName> = Object.keys(scenarios) as ScenarioName[];

export { CODE, NOW, SHARE_BASE, FIRST_BID, SECOND_BID, OPENED_GROUP, LEARNER_GENERATION };
