// The backgammon wire codecs (design.md §5.1; understand.md §4 step 5): the seven frames a host
// and its guest exchange over the PeerJS data channel, gin's protocol.ts frame for frame with one
// change: `welcome` and `lobby` carry `matchLength` and `variant` instead of gin's `target`, since
// the guest must know which ruleset the host deals under. This is the trust boundary
// (docs/ARCHITECTURE.md "Module boundaries"): an inbound frame is `unknown` until a decoder here
// rebuilds it field by field over the engine's own decoders (`decodeAction`, `decodeView`), so
// extra and prototype keys never reach the game, and every outbound frame is built here in emit
// order, so a decoded frame re-encodes byte for byte (R32: every optional is `null`, nothing
// BinaryPack cannot carry). No legacy corpus exists for this game; protocol.test.ts records one
// JSON golden per frame under test/fixtures/backgammon-wire/ and holds the bytes there. A
// wire-visible change adds a version field here.
import { formatError, integer, literal, object, refine, string } from '../../../shared/lib/json.ts';
import { err, ok, type Result } from '../../../shared/lib/result.ts';
import {
  decodeAction,
  decodeView,
  SHIPPED_VARIANTS,
  type Action,
  type ShippedVariant,
  type View,
} from './engine/index.ts';

/** The `t` of every frame, guest-to-host first. */
export const WIRE_TAGS = ['join', 'action', 'welcome', 'lobby', 'full', 'toast', 'state'] as const;
export type WireTag = (typeof WIRE_TAGS)[number];

/** The name inputs are `maxlength="20"` and every name is `.slice(0, 20)`d before it is sent. */
export const NAME_MAX = 20;
/** A toast carries an engine refusal (the longest `MESSAGES` entry is well under 100 characters). */
export const TOAST_MAX = 500;
/** What the host calls a guest whose name is empty. */
export const DEFAULT_GUEST_NAME = 'Jeff';

export type JoinFrame = Readonly<{ t: 'join'; name: string }>;
/** `roll` from a guest asks the host to roll for it (Q9: the host holds the dice). */
export type ActionFrame = Readonly<{ t: 'action'; action: Action }>;
export type GuestFrame = JoinFrame | ActionFrame;

export type WelcomeFrame = Readonly<{
  t: 'welcome';
  hostName: string;
  matchLength: number;
  variant: ShippedVariant;
}>;
export type LobbyFrame = Readonly<{
  t: 'lobby';
  hostName: string;
  matchLength: number;
  variant: ShippedVariant;
}>;
export type FullFrame = Readonly<{ t: 'full' }>;
export type ToastFrame = Readonly<{ t: 'toast'; msg: string }>;
/** `viewFor(game, 1)`: the guest's seat, after every applied action and on (re)connect. */
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
/** The engine accepts any length >= 1 (R21); the home screen offers 1, 3, 5 and 7. */
const matchLength = integer(1);
const variant = literal(...SHIPPED_VARIANTS);
const msg = refine(
  string,
  (s) => s.length <= TOAST_MAX,
  `a message of at most ${String(TOAST_MAX)} characters`,
);

const head = object({ t: literal(...WIRE_TAGS) });
const joinFrame = object({ t: literal('join'), name });
const actionFrame = object({ t: literal('action'), action: decodeAction });
const welcomeFrame = object({ t: literal('welcome'), hostName: name, matchLength, variant });
const lobbyFrame = object({ t: literal('lobby'), hostName: name, matchLength, variant });
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

/** `join` and `action` come from a guest; the other five from a host (main.ts routes a send by it). */
export const isGuestFrame = (frame: Frame): frame is GuestFrame =>
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

// Outbound builders, in emit order (the golden bytes): a guest joins and acts; a host welcomes,
// repeats the lobby while waiting, turns a third peer away, toasts a refusal, and sends the view.
export const join = (guestName: string): JoinFrame => ({ t: 'join', name: guestName });
export const action = (act: Action): ActionFrame => ({ t: 'action', action: act });
export const welcome = (
  hostName: string,
  length: number,
  ruleset: ShippedVariant,
): WelcomeFrame => ({ t: 'welcome', hostName, matchLength: length, variant: ruleset });
export const lobby = (hostName: string, length: number, ruleset: ShippedVariant): LobbyFrame => ({
  t: 'lobby',
  hostName,
  matchLength: length,
  variant: ruleset,
});
export const full = (): FullFrame => ({ t: 'full' });
export const toast = (message: string): ToastFrame => ({ t: 'toast', msg: message });
export const state = (view: View): StateFrame => ({ t: 'state', view });

/**
 * The name the host gives a joining guest (gin's `onGuestMsg` rule, kept so the shared sessions
 * can inject it unchanged): cut to NAME_MAX and trimmed, `Jeff` when that leaves nothing, and
 * ` 2` appended when it matches the host's own name case-insensitively.
 */
export const guestNameFor = (rawName: string, hostName: string): string => {
  const trimmed = rawName.slice(0, NAME_MAX).trim();
  const named = trimmed === '' ? DEFAULT_GUEST_NAME : trimmed;
  return named.toLowerCase() === hostName.toLowerCase() ? `${named} 2` : named;
};
