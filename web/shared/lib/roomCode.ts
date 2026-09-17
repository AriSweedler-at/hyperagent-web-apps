// Room codes and peer ids, frozen to the legacy literals (docs/ARCHITECTURE.md: "peer-id prefixes,
// room-code alphabets ... stay identical"). Gin: 4 letters from an alphabet without I and O, peer id
// `ginrummy-ari-<CODE>`. Fidice: 5 characters from letters and digits without I, L, O, 0 and 1,
// peer id `fidice-<code>` lower-cased. web/shared/lib/roomCode.test.ts pins every literal and
// test/parity/roomCode.legacy.test.ts reads them back out of the legacy pages.
import { err, ok, type Result } from './result.ts';
import type { Rng } from './rng.ts';

export type Game = 'gin-rummy' | 'fidice';

export type RoomCodeSpec = Readonly<{
  /** Characters a generated code is drawn from. */
  alphabet: string;
  /** Length of a valid code. */
  length: number;
  /** Prefix of the host's PeerJS id. */
  peerPrefix: string;
  /** How the code is spelled inside the peer id: gin keeps it upper case, fidice lowers it. */
  peerCase: 'upper' | 'lower';
  /** What the legacy join form says when the code has the wrong length. */
  lengthError: string;
}>;

export const GIN_PEER_PREFIX = 'ginrummy-ari-';
export const GIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const GIN_CODE_LENGTH = 4;
export const GIN_CODE_LENGTH_ERROR = 'Enter the 4-letter room code.';

export const FIDICE_PEER_PREFIX = 'fidice-';
export const FIDICE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const FIDICE_CODE_LENGTH = 5;
export const FIDICE_CODE_LENGTH_ERROR = 'Codes are 5 characters';

export const ROOM_CODE: Readonly<Record<Game, RoomCodeSpec>> = {
  'gin-rummy': {
    alphabet: GIN_CODE_ALPHABET,
    length: GIN_CODE_LENGTH,
    peerPrefix: GIN_PEER_PREFIX,
    peerCase: 'upper',
    lengthError: GIN_CODE_LENGTH_ERROR,
  },
  fidice: {
    alphabet: FIDICE_CODE_ALPHABET,
    length: FIDICE_CODE_LENGTH,
    peerPrefix: FIDICE_PEER_PREFIX,
    peerCase: 'lower',
    lengthError: FIDICE_CODE_LENGTH_ERROR,
  },
};

/** A fresh code: `length` draws from `alphabet`, exactly as the legacy `genCode`/`randomCode`. */
export const randomCode = (game: Game, rng: Rng): string => {
  const { alphabet, length } = ROOM_CODE[game];
  return Array.from({ length }, () => alphabet.charAt(Math.floor(rng() * alphabet.length))).join(
    '',
  );
};

/**
 * What the legacy code inputs keep as the user types, per game and not per alphabet: gin's
 * `input` handler is `toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)`, so I and O survive and
 * digits do not; fidice's `form.code` intent only upper-cases (the length is checked on submit,
 * `validateCode`). test/parity/roomCode.legacy.test.ts runs both legacy expressions beside this.
 */
const TYPED_CODE: Readonly<Record<Game, (raw: string) => string>> = {
  'gin-rummy': (raw) =>
    raw
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, GIN_CODE_LENGTH),
  fidice: (raw) => raw.toUpperCase(),
};

export const sanitiseCode = (game: Game, raw: string): string => TYPED_CODE[game](raw);

/**
 * What the legacy join buttons accept: trimmed and upper-cased, then only the length is checked
 * (a typed `IIII` passes in gin, as it always has). Returns the normalised code.
 */
export const validateCode = (game: Game, raw: string): Result<string, string> => {
  const { length, lengthError } = ROOM_CODE[game];
  const code = raw.trim().toUpperCase();
  return code.length === length ? ok(code) : err(lengthError);
};

/** True when every character of `code` is in the game's alphabet and the length is right. */
export const isWellFormedCode = (game: Game, code: string): boolean => {
  const { alphabet, length } = ROOM_CODE[game];
  return code.length === length && Array.from(code).every((ch) => alphabet.includes(ch));
};

/** The host's PeerJS id for a room code (`ginrummy-ari-ABCD`, `fidice-abcde`). */
export const peerIdFor = (game: Game, code: string): string => {
  const { peerPrefix, peerCase } = ROOM_CODE[game];
  return peerPrefix + (peerCase === 'lower' ? code.toLowerCase() : code);
};
