// The gin wire codecs (docs/MIGRATION.md step 11): the seven frames the legacy multiplayer UI
// sends over its PeerJS data channel (legacy/gin-rummy/index.html, `conn.send({ t: ... })`),
// typed and frozen by the recorded corpus test/fixtures/legacy/gin-wire/*.json. This is the trust
// boundary (docs/ARCHITECTURE.md "Module boundaries"): an inbound frame is `unknown` until a
// decoder here rebuilds it field by field, so extra and prototype keys never reach the game, and
// every outbound frame is built here with the legacy key order, so its JSON is the legacy's byte
// for byte (test/parity/gin.protocol.test.ts). The legacy host read a join loosely
// (`String(msg.name || 'Jeff').slice(0, 20).trim() || 'Jeff'`); the decoder takes only a string of
// at most NAME_MAX characters (what a legacy guest ever sends) and `guestNameFor` applies the
// host's normalisation. A wire-visible change adds a version field here.
import { formatError, integer, literal, object, refine, string } from '../../../shared/lib/json.ts';
import { err, ok, type Result } from '../../../shared/lib/result.ts';
import { decodeAction, decodeView } from './engine/decode.ts';
import type { Action, View } from './engine/types.ts';

/** The `t` of every frame, guest-to-host first. */
export const WIRE_TAGS = ['join', 'action', 'welcome', 'lobby', 'full', 'toast', 'state'] as const;
export type WireTag = (typeof WIRE_TAGS)[number];

/** The legacy inputs are `maxlength="20"` and every name is `.slice(0, 20)`d before it is sent. */
export const NAME_MAX = 20;
/** A toast carries an engine refusal (the longest is well under 100 characters). */
export const TOAST_MAX = 500;
/** What the legacy host calls a guest whose name is empty. */
export const DEFAULT_GUEST_NAME = 'Jeff';

export type JoinFrame = Readonly<{ t: 'join'; name: string }>;
export type ActionFrame = Readonly<{ t: 'action'; action: Action }>;
export type GuestFrame = JoinFrame | ActionFrame;

export type WelcomeFrame = Readonly<{ t: 'welcome'; hostName: string; target: number }>;
export type LobbyFrame = Readonly<{ t: 'lobby'; hostName: string; target: number }>;
export type FullFrame = Readonly<{ t: 'full' }>;
export type ToastFrame = Readonly<{ t: 'toast'; msg: string }>;
export type StateFrame = Readonly<{ t: 'state'; view: View }>;
export type HostFrame = WelcomeFrame | LobbyFrame | FullFrame | ToastFrame | StateFrame;

export type Frame = GuestFrame | HostFrame;

/** Why a frame was refused, worded for the log: `$.name: expected a name of at most 20 characters`. */
export type DecodeFailure = string;

const name = refine(
  string,
  (s) => s.length <= NAME_MAX,
  `a name of at most ${String(NAME_MAX)} characters`,
);
const target = integer(1);
const msg = refine(
  string,
  (s) => s.length <= TOAST_MAX,
  `a message of at most ${String(TOAST_MAX)} characters`,
);

const head = object({ t: literal(...WIRE_TAGS) });
const joinFrame = object({ t: literal('join'), name });
const actionFrame = object({ t: literal('action'), action: decodeAction });
const welcomeFrame = object({ t: literal('welcome'), hostName: name, target });
const lobbyFrame = object({ t: literal('lobby'), hostName: name, target });
const fullFrame = object({ t: literal('full') });
const toastFrame = object({ t: literal('toast'), msg });
const stateFrame = object({ t: literal('state'), view: decodeView });

const failure = <T>(r: Result<T, Parameters<typeof formatError>[0]>): Result<T, DecodeFailure> =>
  r.ok ? r : err(formatError(r.error));

/** Any of the seven frames; the tag decides the shape. */
export const decodeFrame = (input: unknown): Result<Frame, DecodeFailure> => {
  const tag = head(input);
  if (!tag.ok) return failure(tag);
  switch (tag.value.t) {
    case 'join':
      return failure(joinFrame(input));
    case 'action':
      return failure(actionFrame(input));
    case 'welcome':
      return failure(welcomeFrame(input));
    case 'lobby':
      return failure(lobbyFrame(input));
    case 'full':
      return failure(fullFrame(input));
    case 'toast':
      return failure(toastFrame(input));
    case 'state':
      return failure(stateFrame(input));
  }
};

const isGuestFrame = (frame: Frame): frame is GuestFrame =>
  frame.t === 'join' || frame.t === 'action';

/** What a host accepts from its guest: `join` and `action`; a host frame here is refused. */
export const decodeGuestFrame = (input: unknown): Result<GuestFrame, DecodeFailure> => {
  const frame = decodeFrame(input);
  if (!frame.ok) return frame;
  return isGuestFrame(frame.value)
    ? ok(frame.value)
    : err(`$.t: expected a guest frame (one of "join" | "action"), got "${frame.value.t}"`);
};

/** What a guest accepts from its host: the other five; a guest frame here is refused. */
export const decodeHostFrame = (input: unknown): Result<HostFrame, DecodeFailure> => {
  const frame = decodeFrame(input);
  if (!frame.ok) return frame;
  return isGuestFrame(frame.value)
    ? err(
        `$.t: expected a host frame (one of "welcome" | "lobby" | "full" | "toast" | "state"), got "${frame.value.t}"`,
      )
    : ok(frame.value);
};

// Outbound builders: the legacy object literals, key for key.
export const join = (guestName: string): JoinFrame => ({ t: 'join', name: guestName });
export const action = (move: Action): ActionFrame => ({ t: 'action', action: move });
export const welcome = (hostName: string, to: number): WelcomeFrame => ({
  t: 'welcome',
  hostName,
  target: to,
});
export const lobby = (hostName: string, to: number): LobbyFrame => ({
  t: 'lobby',
  hostName,
  target: to,
});
export const full = (): FullFrame => ({ t: 'full' });
export const toast = (message: string): ToastFrame => ({ t: 'toast', msg: message });
export const state = (view: View): StateFrame => ({ t: 'state', view });

/**
 * The name the legacy host gives a joining guest (`onGuestMsg`): cut to NAME_MAX and trimmed,
 * `Jeff` when that leaves nothing, and ` 2` appended when it matches the host's own name
 * case-insensitively.
 */
export const guestNameFor = (rawName: string, hostName: string): string => {
  const trimmed = rawName.slice(0, NAME_MAX).trim();
  const named = trimmed === '' ? DEFAULT_GUEST_NAME : trimmed;
  return named.toLowerCase() === hostName.toLowerCase() ? `${named} 2` : named;
};
