// Seating (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 1816-1889 (bundle
// section "// src/domain/lobby.ts"); behaviour and log lines are unchanged,
// test/parity/fidice.legacy.test.ts is the oracle. Everything here is lobby-phase bookkeeping over
// `State.players`; the helpers that cannot fail return the State unchanged when nothing applies.
import { normaliseName } from '../../../../shared/lib/name.ts';
import { MAX_SEATS, seat, withLog } from './game.ts';
import { err, ok, type Result } from './result.ts';
import {
  NAME_RULE,
  type BotProfile,
  type Player,
  type RuleError,
  type Seat,
  type State,
} from './types.ts';

const BOT_NAMES: ReadonlyArray<string> = [
  'Loon',
  'Moose',
  'Pike',
  'Otter',
  'Osprey',
  'Beaver',
  'Heron',
  'Trout',
  'Chickadee',
  'Blackfly',
];

const seatOf = (s: State, id: string): Seat | null => {
  const i = s.players.findIndex((p) => p.id === id);
  return i < 0 ? null : seat(i);
};
const findSeat = seatOf;

const shiftHostSeat = (hostSeat: Seat | null, removed: Seat): Seat | null =>
  hostSeat === null ? null : hostSeat > removed ? seat(hostSeat - 1) : hostSeat;

const seatPlayer = (s: State, player: Player): Result<State, RuleError> => {
  if (s.phase !== 'lobby') return err('The game already started.');
  if (s.players.length >= MAX_SEATS) return err(`Table is full (${String(MAX_SEATS)}).`);
  const verb = player.bot
    ? `(a computer${player.bot.random ? ', strategy drawn at random' : ''}) sits down.`
    : 'sits down at the table.';
  return ok(withLog({ ...s, players: [...s.players, player] }, `${player.name} ${verb}`));
};

const unseatPlayer = (s: State, id: string): State => {
  const at = seatOf(s, id);
  if (at === null || s.phase !== 'lobby') return s;
  const name = s.players[at]?.name ?? '?';
  return withLog(
    {
      ...s,
      players: s.players.filter((_, i) => i !== at),
      hostSeat: shiftHostSeat(s.hostSeat, at),
    },
    `${name} leaves the table.`,
  );
};

const setConnected = (s: State, id: string, connected: boolean, rename?: string): State => {
  const at = seatOf(s, id);
  if (at === null) return s;
  const players = s.players.map((p, i) =>
    i === at ? { ...p, connected, name: rename ?? p.name } : p,
  );
  const name = players[at]?.name ?? '?';
  return withLog(
    { ...s, players },
    connected ? `${name} is back at the table.` : `${name} disconnected.`,
  );
};

const withSpectators = (s: State, delta: number): State => ({
  ...s,
  spectators: Math.max(0, s.spectators + delta),
});

const nextBotName = (s: State): string => {
  const taken = new Set(s.players.map((p) => p.name));
  return BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${String(s.players.length + 1)}`;
};

const makeBot = (s: State, id: string, profile: BotProfile): Player => ({
  id,
  name: nextBotName(s),
  lives: s.lives,
  losses: 0,
  connected: true,
  bot: profile,
});

/** The name cut as every name is, without the fallback: the callers pick theirs (or filter). */
const cleanName = (name: string): string =>
  normaliseName(name, { max: NAME_RULE.max, fallback: '' });

const renameBot = (s: State, id: string, name: string): State => {
  const at = seatOf(s, id);
  const p = at === null ? undefined : s.players[at];
  if (!p?.bot || s.phase !== 'lobby') return s;
  const fresh = cleanName(name) || nextBotName(s);
  if (fresh === p.name) return s;
  return withLog(
    { ...s, players: s.players.map((q, i) => (i === at ? { ...q, name: fresh } : q)) },
    `${p.name} is now called ${fresh}.`,
  );
};

const setBotProfile = (s: State, id: string, profile: BotProfile, label: string): State => {
  const at = seatOf(s, id);
  const p = at === null ? undefined : s.players[at];
  if (!p?.bot || s.phase !== 'lobby') return s;
  if (p.bot.strategy === profile.strategy && p.bot.random === profile.random) return s;
  return withLog(
    { ...s, players: s.players.map((q, i) => (i === at ? { ...q, bot: profile } : q)) },
    `${p.name} will play ${label}.`,
  );
};

const makeHuman = (id: string, name: string, lives: number): Player => ({
  id,
  name: normaliseName(name, NAME_RULE),
  lives,
  losses: 0,
  connected: true,
  bot: null,
});

const hostStandsUp = (s: State): State => {
  if (s.hostSeat === null || s.phase !== 'lobby') return s;
  return withLog(
    { ...s, players: s.players.filter((_, i) => i !== s.hostSeat), hostSeat: null },
    'The host stands up to watch.',
  );
};

const hostSitsDown = (s: State, host: Player): State => {
  if (s.hostSeat !== null || s.phase !== 'lobby') return s;
  return withLog(
    { ...s, players: [host, ...s.players], hostSeat: seat(0) },
    `${host.name} takes a seat.`,
  );
};

export {
  BOT_NAMES,
  seatOf,
  findSeat,
  shiftHostSeat,
  seatPlayer,
  unseatPlayer,
  setConnected,
  withSpectators,
  nextBotName,
  makeBot,
  cleanName,
  renameBot,
  setBotProfile,
  makeHuman,
  hostStandsUp,
  hostSitsDown,
};
