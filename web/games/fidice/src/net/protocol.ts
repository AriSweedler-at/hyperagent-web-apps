// The wire codecs (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 559-607
// (bundle section "// src/net/protocol.ts"); the accepted frames, the rebuilt values and the
// refusal texts are unchanged, test/parity/fidice.legacy.test.ts is the oracle. This is the trust
// boundary (docs/ARCHITECTURE.md "Module boundaries"): an inbound frame is `unknown` until a
// decoder here rebuilds it field by field, so extra and prototype keys never reach the game. The
// field checks are web/shared/lib/json leaf decoders where the bundle's own checks match them for
// every input; the frame shapes and the per-frame refusal texts stay the bundle's.
import { arrayOf, boolean, integer } from '../../../../shared/lib/json.ts';
import { isRank } from '../domain/hands.ts';
import { err, ok, type Result } from '../domain/result.ts';
import { NAME_RULE, type Action, type PublicState, type Seat } from '../domain/types.ts';

export type Role = 'player' | 'spectator';
export type ClientMessage =
  | Readonly<{ t: 'hello'; role: Role; name: string | null; token: string | null }>
  | Readonly<{ t: 'act'; action: Action }>;
/** The guest's own seat and token as the host sees them. */
export type You = Readonly<{ seat: Seat | null; token: string | null; role: Role }>;
export type ServerMessage =
  | Readonly<{ t: 'state'; state: PublicState; you: You }>
  | Readonly<{ t: 'error' | 'info'; message: string }>;
/** Why a frame was refused, worded for the log. */
export type DecodeFailure = string;

/** Any object, arrays included: something `x['key']` can be read from. */
const isRecord = (x: unknown): x is Readonly<Record<string, unknown>> =>
  typeof x === 'object' && x !== null;
const isRole = (x: unknown): x is Role => x === 'player' || x === 'spectator';
const dieIndex = integer(0, 4);
const indexList = arrayOf(dieIndex);
const isIndexList = (x: unknown): x is ReadonlyArray<number> => indexList(x).ok;
const decodeAction = (x: unknown): Result<Action, DecodeFailure> => {
  if (!isRecord(x)) return err('Action must have a type.');
  const type = x['type'];
  if (typeof type !== 'string') return err('Action must have a type.');
  switch (type) {
    case 'start':
    case 'next':
    case 'peek':
    case 'call':
    case 'finish':
      return ok({ type });
    case 'pull': {
      const die = dieIndex(x['die']);
      return die.ok ? ok({ type: 'pull', die: die.value }) : err('pull needs a die index 0–4.');
    }
    case 'roll': {
      const cup = boolean(x['cup']);
      const table = x['table'];
      const intoCup = x['intoCup'];
      return cup.ok && isIndexList(table) && (intoCup === undefined || isIndexList(intoCup))
        ? ok({ type: 'roll', cup: cup.value, table, intoCup: intoCup ?? [] })
        : err('roll needs cup:boolean, table:number[] and optionally intoCup:number[].');
    }
    case 'bid': {
      const rank = x['rank'];
      return isRank(rank) ? ok({ type: 'bid', rank }) : err('bid needs a rank 0–251.');
    }
    default:
      return err(`Unknown action type: ${type}`);
  }
};
const decodeClientMessage = (x: unknown): Result<ClientMessage, DecodeFailure> => {
  if (!isRecord(x)) return err('Message must be an object.');
  if (x['t'] === 'hello') {
    const role = x['role'];
    if (!isRole(role)) return err('hello needs a role.');
    const name = x['name'];
    const token = x['token'];
    return ok({
      t: 'hello',
      role,
      // Cut, not trimmed: the seat (lobby.ts makeHuman) normalises what the wire carried.
      name: typeof name === 'string' ? name.slice(0, NAME_RULE.max) : null,
      token: typeof token === 'string' ? token.slice(0, 64) : null,
    });
  }
  if (x['t'] === 'act') {
    const action = decodeAction(x['action']);
    return action.ok ? ok({ t: 'act', action: action.value }) : action;
  }
  return err(`Unknown client message: ${String(x['t'])}`);
};
const decodeServerMessage = (x: unknown): Result<ServerMessage, DecodeFailure> => {
  if (!isRecord(x)) return err('Message must be an object.');
  const t = x['t'];
  const state = x['state'];
  const you = x['you'];
  if (t === 'state' && isRecord(state) && isRecord(you)) {
    const role = you['role'];
    const seat = you['seat'];
    const token = you['token'];
    if (isRole(role))
      return ok({
        t: 'state',
        // The bundle passes the host's state through on the shape check alone: the guest trusts the
        // host. A field-by-field decoder is deferred (docs/MIGRATION.md "Deviations", step 8).
        state: state as PublicState,
        you: {
          // Any number passes, as in the bundle; the seat is trusted like the state above.
          seat: typeof seat === 'number' ? (seat as Seat) : null,
          token: typeof token === 'string' ? token : null,
          role,
        },
      });
  }
  const message = x['message'];
  if ((t === 'error' || t === 'info') && typeof message === 'string') return ok({ t, message });
  return err(`Unknown server message: ${String(t)}`);
};

export { isRecord, isRole, isIndexList, decodeAction, decodeClientMessage, decodeServerMessage };
