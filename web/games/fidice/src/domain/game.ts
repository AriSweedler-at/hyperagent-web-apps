// The rules (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 666-859 (bundle
// section "// src/domain/game.ts"); behaviour, log lines and refusals are unchanged,
// test/parity/fidice.legacy.test.ts is the oracle. `apply(s, actor, action, rng)` is the reducer:
// it returns a new State or a RuleError worded for the player, never mutates and never throws.
import type { Rng } from '../../../../shared/lib/rng.ts';
import { rollDice } from './dice.ts';
import { handAt, rankOf, spokenName } from './hands.ts';
import { err, ok, type Result } from './result.ts';
import {
  MAX_SEATS,
  type Action,
  type Actor,
  type DieValue,
  type Player,
  type PublicRound,
  type Rank,
  type Round,
  type RuleError,
  type Seat,
  type State,
} from './types.ts';

type Outcome = Result<State, RuleError>;

/** The Seat constructor: an index the caller has already bounded by `players.length`. */
const seat = (n: number): Seat => n as Seat;
const bySeat = (s: Seat): Actor => ({ kind: 'seat', seat: s });
const HOST: Actor = { kind: 'host' };
const MIN_PLAYERS = 2;
const LOG_LIMIT = 80;
const RECORD_LIMIT = 60;

const newGame = (code: string, lives: number): State => ({
  code,
  lives,
  phase: 'lobby',
  players: [],
  spectators: 0,
  roundNo: 0,
  round: null,
  reveal: null,
  winner: null,
  log: [],
  records: [],
  hostSeat: seat(0),
  autoNextAt: null,
});

const withLog = (s: State, text: string, big = false): State => ({
  ...s,
  log: [...s.log, { text, big, at: null }].slice(-LOG_LIMIT),
});

/** Give every unstamped log entry the host's clock reading; a no-op when none is pending. */
const stampLog = (s: State, now: number): State =>
  s.log.some((e) => e.at === null)
    ? { ...s, log: s.log.map((e) => (e.at === null ? { ...e, at: now } : e)) }
    : s;

const playerAt = (s: State, i: Seat): Player | undefined => s.players[i];
const nameOf = (s: State, i: Seat): string => playerAt(s, i)?.name ?? '?';
/** `lives: 0` means the table keeps score (rounds lost) instead of knocking players out. */
const keepsScore = (s: State): boolean => s.lives === 0;
const isOut = (s: State, p: Player): boolean => !keepsScore(s) && p.lives <= 0;
const alivePlayers = (s: State): ReadonlyArray<Player> => s.players.filter((p) => !isOut(s, p));
const isAlive = (s: State, i: Seat): boolean => {
  const p = playerAt(s, i);
  return p !== undefined && !isOut(s, p);
};

const standings = (s: State): ReadonlyArray<Seat> =>
  s.players
    .map((p, i): Readonly<{ p: Player; i: Seat }> => ({ p, i: seat(i) }))
    .sort((a, b) => a.p.losses - b.p.losses || b.p.lives - a.p.lives || a.i - b.i)
    .map((x) => x.i);

const nextAlive = (s: State, from: Seat): Seat => {
  const n = s.players.length;
  const found = Array.from({ length: n - 1 }, (_, k) => seat((from + k + 1) % n)).find((i) =>
    isAlive(s, i),
  );
  return found ?? from;
};

const cupIndices = (r: Round): ReadonlyArray<number> =>
  r.dice.flatMap((d, i) => (d.inCup ? [i] : []));
const tableIndices = (r: Round): ReadonlyArray<number> =>
  r.dice.flatMap((d, i) => (d.inCup ? [] : [i]));
const diceValues = (r: Round): ReadonlyArray<DieValue> => r.dice.map((d) => d.value);
const realRank = (r: Round): Rank => rankOf(diceValues(r));
/** The holder may look under the cup once they accept it (or before anyone has bid). */
const holderMaySee = (r: PublicRound): boolean => r.bid === null || r.touched;
const isHostActor = (s: State, a: Actor): boolean =>
  a.kind === 'host' || (s.hostSeat !== null && a.seat === s.hostSeat);

const startRound = (s: State, starter: Seat, rng: Rng): State =>
  withLog(
    {
      ...s,
      roundNo: s.roundNo + 1,
      reveal: null,
      autoNextAt: null,
      round: {
        holder: starter,
        bid: null,
        bidder: null,
        rolled: false,
        touched: false,
        history: [],
        dice: rollDice(5, rng).map((value) => ({ value, inCup: true })),
      },
    },
    `Round ${String(s.roundNo + 1)}: ${nameOf(s, starter)} shakes the cup.`,
    true,
  );

const startGame = (s: State, rng: Rng): Outcome => {
  if (s.phase !== 'lobby') return err('The game has already started.');
  if (s.players.length < MIN_PLAYERS) return err(`Need at least ${String(MIN_PLAYERS)} players.`);
  const ready = withLog(
    {
      ...s,
      phase: 'playing',
      players: s.players.map((p) => ({ ...p, lives: s.lives, losses: 0 })),
    },
    keepsScore(s)
      ? `Game on! ${String(s.players.length)} players, keeping score.`
      : `Game on! ${String(s.players.length)} players, ${String(s.lives)} lives each.`,
    true,
  );
  return ok(startRound(ready, seat(0), rng));
};

const nextRound = (s: State, rng: Rng): Outcome => {
  if (!s.reveal) return err('No round to advance.');
  const loser = s.reveal.loser;
  return ok(startRound(s, isAlive(s, loser) ? loser : nextAlive(s, loser), rng));
};

const updateRound = (s: State, r: Round): State => ({ ...s, round: r });

const peek = (s: State, r: Round, me: Player): Outcome =>
  r.touched
    ? err('You already accepted the cup.')
    : ok(withLog(updateRound(s, { ...r, touched: true }), `${me.name} accepts the cup and peeks.`));

const pull = (s: State, r: Round, me: Player, index: number): Outcome => {
  if (!holderMaySee(r)) return err('Peek first.');
  const die = r.dice[index];
  if (!die) return err('No such die.');
  if (!die.inCup) return err('That die is already out.');
  const dice = r.dice.map((d, i) => (i === index ? { ...d, inCup: false } : d));
  return ok(
    withLog(
      updateRound(s, { ...r, dice, touched: true }),
      `${me.name} pulls a ${String(die.value)} out from under the cup.`,
    ),
  );
};

const countDice = (n: number): string => `${String(n)} ${n === 1 ? 'die' : 'dice'}`;

const roll = (
  s: State,
  r: Round,
  me: Player,
  cup: boolean,
  table: ReadonlyArray<number>,
  intoCup: ReadonlyArray<number>,
  rng: Rng,
): Outcome => {
  if (r.rolled) return err('You already rolled this turn.');
  if (!holderMaySee(r)) return err('Peek first.');
  const onTable = new Set(tableIndices(r));
  const tucked = new Set(intoCup.filter((i) => onTable.has(i)));
  const chosen = table.filter((i) => onTable.has(i) && !tucked.has(i));
  const cupIdx = cupIndices(r);
  if (!cup && chosen.length === 0 && tucked.size === 0) return err('Pick something to roll.');
  if (cup && cupIdx.length === 0 && tucked.size === 0) return err('Nothing left under the cup.');
  const shakeCup = cup || tucked.size > 0;
  const rerolled = new Set([...chosen, ...tucked, ...(shakeCup ? cupIdx : [])]);
  const dice = r.dice.map((d, i) =>
    rerolled.has(i)
      ? { ...d, value: rollDice(1, rng)[0] ?? d.value, inCup: d.inCup || tucked.has(i) }
      : d,
  );
  const parts = [
    chosen.length
      ? `rolls ${countDice(chosen.length)} on the table → ${chosen.map((i) => dice[i]?.value).join(', ')}`
      : null,
    tucked.size ? `tucks ${countDice(tucked.size)} back under the cup` : null,
    shakeCup ? `shakes the cup (${countDice(cupIdx.length + tucked.size)})` : null,
  ];
  const text = `${me.name} ${parts.filter((x) => x !== null).join(', ')}.`;
  return ok(withLog(updateRound(s, { ...r, dice, rolled: true, touched: true }), text));
};

const bid = (s: State, r: Round, me: Player, mySeat: Seat, rank: Rank): Outcome => {
  if (r.bid !== null && !r.touched) return err('Accept the cup before bidding.');
  if (r.bid !== null && rank <= r.bid) return err('Your bid must be higher than the current bid.');
  const next: Round = {
    ...r,
    bid: rank,
    bidder: mySeat,
    history: [...r.history, { seat: mySeat, rank }],
    holder: nextAlive(s, mySeat),
    rolled: false,
    touched: false,
  };
  return ok(withLog(updateRound(s, next), `${me.name} bids ${spokenName(rank)}.`, true));
};

const call = (s: State, r: Round, me: Player, mySeat: Seat): Outcome => {
  if (r.bid === null || r.bidder === null) return err('There is no bid to call.');
  if (r.touched) return err('You accepted the cup — you must bid.');
  const real = realRank(r);
  const holds = real >= r.bid;
  const loser = holds ? mySeat : r.bidder;
  const scoring = keepsScore(s);
  const players = s.players.map((p, i) =>
    i === loser ? { ...p, lives: scoring ? p.lives : p.lives - 1, losses: p.losses + 1 } : p,
  );
  const reveal = {
    dice: diceValues(r),
    real,
    bid: r.bid,
    holds,
    caller: mySeat,
    bidder: r.bidder,
    loser,
  };
  const record = {
    roundNo: s.roundNo,
    bids: r.history,
    bidder: r.bidder,
    caller: mySeat,
    bid: r.bid,
    real,
    holds,
    loser,
  };
  const cost = scoring
    ? `loses the round (${String(players[loser]?.losses ?? 0)} lost)`
    : 'loses a life';
  const revealed = withLog(
    { ...s, players, reveal, records: [...s.records, record].slice(-RECORD_LIMIT) },
    `${me.name} calls liar! Under the cup: ${handAt(real).name}. ${holds ? 'The bid holds' : 'Busted'} — ${nameOf(s, loser)} ${cost}.`,
    true,
  );
  if (scoring) return ok(revealed);
  const loserOut = (players[loser]?.lives ?? 0) === 0;
  const afterOut = loserOut
    ? withLog(revealed, `${nameOf(s, loser)} is out of lives.`, true)
    : revealed;
  const remaining = alivePlayers(afterOut);
  if (remaining.length > 1) return ok(afterOut);
  const champion = remaining[0];
  const winner = champion ? seat(afterOut.players.indexOf(champion)) : null;
  return ok(
    withLog(
      { ...afterOut, phase: 'over', winner },
      champion ? `\u{1F3C6} ${champion.name} wins — last kayak on the lake!` : 'Everyone fell in?!',
      true,
    ),
  );
};

const finish = (s: State, actor: Actor): Outcome => {
  if (!isHostActor(s, actor)) return err('Only the host can end the game.');
  const order = standings(s);
  const top = order[0];
  const runnerUp = order[1];
  const tied =
    top !== undefined &&
    runnerUp !== undefined &&
    (playerAt(s, top)?.losses ?? 0) === (playerAt(s, runnerUp)?.losses ?? 0);
  const winner = top !== undefined && !tied ? top : null;
  const board = order
    .map((i) => `${nameOf(s, i)} ${String(playerAt(s, i)?.losses ?? 0)}`)
    .join(', ');
  return ok(
    withLog(
      { ...s, phase: 'over', winner },
      `\u{1F3C1} The host ends the game. Rounds lost — ${board}.${winner === null ? ' A tie at the top!' : ` ${nameOf(s, winner)} wins.`}`,
      true,
    ),
  );
};

const apply = (s: State, actor: Actor, action: Action, rng: Rng): Outcome => {
  if (s.phase === 'lobby') {
    if (action.type !== 'start') return err('The game has not started.');
    return isHostActor(s, actor) ? startGame(s, rng) : err('Only the host can start.');
  }
  if (s.phase === 'over') return err('The game is over.');
  if (action.type === 'finish') return finish(s, actor);
  const r = s.round;
  if (!r) return err('No round in progress.');
  if (s.reveal)
    return action.type === 'next' ? nextRound(s, rng) : err('Waiting for the next round.');
  if (actor.kind !== 'seat') return err('Only a seated player can play.');
  if (actor.seat !== r.holder) return err("It's not your turn.");
  const me = playerAt(s, actor.seat);
  if (!me) return err('No such seat.');
  switch (action.type) {
    case 'peek':
      return peek(s, r, me);
    case 'pull':
      return pull(s, r, me, action.die);
    case 'roll':
      return roll(s, r, me, action.cup, action.table, action.intoCup, rng);
    case 'bid':
      return bid(s, r, me, actor.seat, action.rank);
    case 'call':
      return call(s, r, me, actor.seat);
    // The bundle also listed 'finish' here; it is handled above, so the compiler knows the case
    // cannot be reached.
    case 'start':
    case 'next':
      return err('Not now.');
  }
};

const scheduleAutoNext = (s: State, at: number): State => ({ ...s, autoNextAt: at });

export {
  seat,
  bySeat,
  HOST,
  MAX_SEATS,
  MIN_PLAYERS,
  LOG_LIMIT,
  RECORD_LIMIT,
  newGame,
  withLog,
  stampLog,
  playerAt,
  nameOf,
  keepsScore,
  isOut,
  alivePlayers,
  isAlive,
  standings,
  nextAlive,
  cupIndices,
  tableIndices,
  diceValues,
  realRank,
  holderMaySee,
  isHostActor,
  startRound,
  startGame,
  nextRound,
  updateRound,
  peek,
  pull,
  countDice,
  roll,
  bid,
  call,
  finish,
  apply,
  scheduleAutoNext,
};
