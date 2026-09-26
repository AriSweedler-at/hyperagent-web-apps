// The two-seat wire protocol both games speak (the shared-shell design, §4.5 "protocol"; PR A2 of
// §5): the seven frames a host and its guest exchange over the PeerJS data channel, typed once and
// specialised per game by its action and view decoders and its room. Gin's protocol.ts wrote them
// first against the legacy corpus (test/fixtures/legacy/gin-wire/*.json, docs/MIGRATION.md step
// 11) and backgammon's copied them frame for frame with one change, the fields `welcome` and
// `lobby` carry after `hostName` (gin `target`; backgammon `matchLength`, `variant`). That
// difference is the `room`: one decoder per field, declared in wire order, so a decoded frame
// re-encodes byte for byte and `welcome(hostName, room)` spreads the room after `hostName` into
// the legacy key order. This is the trust boundary (docs/ARCHITECTURE.md "Module boundaries"): an
// inbound frame is `unknown` until a decoder here rebuilds it field by field, so extra and
// prototype keys never reach the game. The legacy host read a join loosely
// (`String(msg.name || 'Jeff').slice(0, 20).trim() || 'Jeff'`); the decoder takes only a string of
// at most NAME_MAX characters (what a legacy guest ever sends) and `guestNameFor` applies the
// host's normalisation. A wire-visible change adds a version field here.
//
// The ephemeral lane (docs/design/briscola-battle.md §4.5): one more tag, `intent`, that a game
// declares through `twoSeatProtocol`'s `extra.ephemeral` and that BOTH sides may send (briscola's
// live hover mirror). It sits beside `WIRE_TAGS`, never in it, so a game that declares none refuses
// the tag with the same words as before and its wire goldens and refusal strings are untouched.
import {
  formatError,
  literal,
  object,
  refine,
  string,
  taggedUnion,
  type DecodeError,
  type Decoder,
  type Shape,
} from './json.ts';
import { err, ok, type Result } from './result.ts';

/** The `t` of every frame, guest-to-host first. */
export const WIRE_TAGS = ['join', 'action', 'welcome', 'lobby', 'full', 'toast', 'state'] as const;
export type WireTag = (typeof WIRE_TAGS)[number];

/**
 * The tag of the one frame either side may send and no game state ever sees (the ephemeral lane):
 * declared per game through `twoSeatProtocol`'s `extra`, refused as an unknown tag when it is not.
 */
export const EPHEMERAL_TAG = 'intent' as const;
export type EphemeralTag = typeof EPHEMERAL_TAG;
/** What every ephemeral frame has: the tag; a game's own decoder spells the rest. */
export type EphemeralFrame = Readonly<{ t: EphemeralTag }>;

/** The name inputs are `maxlength="20"` and every name is `.slice(0, 20)`d before it is sent. */
export const NAME_MAX = 20;
/** A toast carries an engine refusal (the longest is well under 100 characters). */
export const TOAST_MAX = 500;
/** What the host calls a guest whose name is empty. */
export const DEFAULT_GUEST_NAME = 'Jeff';

export type JoinFrame = Readonly<{ t: 'join'; name: string }>;
export type ActionFrame<A> = Readonly<{ t: 'action'; action: A }>;
export type GuestFrame<A> = JoinFrame | ActionFrame<A>;

/** The host's name, then the room `R`: what a guest must know to sit down under the host's rules. */
export type WelcomeFrame<R> = Readonly<{ t: 'welcome'; hostName: string }> & R;
/** Repeated while the host waits: the same fields as `welcome`. */
export type LobbyFrame<R> = Readonly<{ t: 'lobby'; hostName: string }> & R;
export type FullFrame = Readonly<{ t: 'full' }>;
export type ToastFrame = Readonly<{ t: 'toast'; msg: string }>;
/** The guest's seat as the host renders it, after every applied action and on (re)connect. */
export type StateFrame<V> = Readonly<{ t: 'state'; view: V }>;
export type HostFrame<V, R> =
  WelcomeFrame<R> | LobbyFrame<R> | FullFrame | ToastFrame | StateFrame<V>;

/** The seven frames and, for a game that declares one, its ephemeral frame `E` (`never` otherwise). */
export type Frame<A, V, R, E extends EphemeralFrame = never> = GuestFrame<A> | HostFrame<V, R> | E;

/** Why a frame was refused, worded for the log: `$.name: expected a name of at most 20 characters`. */
export type DecodeFailure = string;
export type FrameDecoder<T> = (input: unknown) => Result<T, DecodeFailure>;

/**
 * A game's room: the fields `welcome` and `lobby` carry after `hostName`, one decoder per key,
 * declared in wire order (`object` decodes them in that order and the builders spread the room
 * literal a caller passes, so a caller spells its room in the same order).
 */
export type RoomFields = Readonly<Record<string, Decoder<unknown>>>;

/** The seven builders and the three decoders, specialised to a game's action `A`, view `V`, room `R` and ephemeral frame `E`. */
export type TwoSeatProtocol<A, V, R, E extends EphemeralFrame = never> = Readonly<{
  /** Any of the seven frames (and the ephemeral one when declared); the tag decides the shape. */
  decodeFrame: FrameDecoder<Frame<A, V, R, E>>;
  /** What a host accepts from its guest: `join` and `action` (and the ephemeral frame); a host frame here is refused. */
  decodeGuestFrame: FrameDecoder<GuestFrame<A> | E>;
  /** What a guest accepts from its host: the other five (and the ephemeral frame); a guest frame here is refused. */
  decodeHostFrame: FrameDecoder<HostFrame<V, R> | E>;
  join: (guestName: string) => JoinFrame;
  action: (act: A) => ActionFrame<A>;
  welcome: (hostName: string, room: R) => WelcomeFrame<R>;
  lobby: (hostName: string, room: R) => LobbyFrame<R>;
  full: () => FullFrame;
  toast: (message: string) => ToastFrame;
  state: (view: V) => StateFrame<V>;
}>;

const name = refine(
  string,
  (s) => s.length <= NAME_MAX,
  `a name of at most ${String(NAME_MAX)} characters`,
);
const msg = refine(
  string,
  (s) => s.length <= TOAST_MAX,
  `a message of at most ${String(TOAST_MAX)} characters`,
);

const joinFrame = object({ t: literal('join'), name });
const fullFrame = object({ t: literal('full') });
const toastFrame = object({ t: literal('toast'), msg });

const failure = <T>(r: Result<T, DecodeError>): Result<T, DecodeFailure> =>
  r.ok ? r : err(formatError(r.error));

/**
 * `head` then `room`, both over the same input, merged with `head`'s keys first: the decoded
 * `welcome` is `{ t, hostName, ...room }` in wire order, and the first failing key is reported in
 * that same order, as the one-object decoders the games had did.
 */
const withRoom =
  <H, R>(head: Decoder<H>, room: Decoder<R>): Decoder<H & R> =>
  (input) => {
    const h = head(input);
    if (!h.ok) return h;
    const r = room(input);
    return r.ok ? ok({ ...h.value, ...r.value }) : r;
  };

/** `join` and `action` come from a guest; the other five from a host (main.ts routes a send by it); an ephemeral frame is neither. */
export const isGuestFrame = <A, V, R, E extends EphemeralFrame>(
  frame: Frame<A, V, R, E>,
): frame is GuestFrame<A> => frame.t === 'join' || frame.t === 'action';

/** The ephemeral frame, which either side sends and the boot routes to whichever session is open. */
export const isEphemeral = <A, V, R, E extends EphemeralFrame>(
  frame: Frame<A, V, R, E>,
): frame is E => frame.t === EPHEMERAL_TAG;

/**
 * A game's protocol: its engine decoders guard `action` and `state`, its room the two lobby frames,
 * and `extra.ephemeral`, when given, an eighth `taggedUnion` case for the lane (absent, the seven
 * cases and every refusal string are as they were).
 */
export const twoSeatProtocol = <A, V, RF extends RoomFields, E extends EphemeralFrame = never>(
  game: Readonly<{ decodeAction: Decoder<A>; decodeView: Decoder<V>; room: RF }>,
  extra?: Readonly<{ ephemeral: Decoder<E> }>,
): TwoSeatProtocol<A, V, Shape<RF>, E> => {
  type R = Shape<RF>;
  const room = object(game.room);
  const welcomeFrame = withRoom(object({ t: literal('welcome'), hostName: name }), room);
  const lobbyFrame = withRoom(object({ t: literal('lobby'), hostName: name }), room);
  // `object` spells a frame's type from its fields (both games' files let it); with `A` and `V`
  // type parameters that Shape stays an unresolved conditional, so the two engine-typed frames
  // state the type their fields already say.
  const actionFrame = object({ t: literal('action'), action: game.decodeAction }) as Decoder<
    ActionFrame<A>
  >;
  const stateFrame = object({ t: literal('state'), view: game.decodeView }) as Decoder<
    StateFrame<V>
  >;

  // One case per tag in WIRE_TAGS order, so a refused tag names the seven as before (F2); the
  // ephemeral case comes eighth, and only for the game that declared it.
  const seven = {
    join: joinFrame,
    action: actionFrame,
    welcome: welcomeFrame,
    lobby: lobbyFrame,
    full: fullFrame,
    toast: toastFrame,
    state: stateFrame,
  };
  const frame = (
    extra === undefined
      ? taggedUnion('t', seven)
      : taggedUnion('t', { ...seven, [EPHEMERAL_TAG]: extra.ephemeral })
  ) as Decoder<Frame<A, V, R, E>>;
  const decodeFrame = (input: unknown): Result<Frame<A, V, R, E>, DecodeFailure> =>
    failure(frame(input));

  const decodeGuestFrame = (input: unknown): Result<GuestFrame<A> | E, DecodeFailure> => {
    const frame = decodeFrame(input);
    if (!frame.ok) return frame;
    return isGuestFrame(frame.value) || isEphemeral(frame.value)
      ? ok(frame.value)
      : err(`$.t: expected a guest frame (one of "join" | "action"), got "${frame.value.t}"`);
  };

  const decodeHostFrame = (input: unknown): Result<HostFrame<V, R> | E, DecodeFailure> => {
    const frame = decodeFrame(input);
    if (!frame.ok) return frame;
    return isGuestFrame(frame.value)
      ? err(
          `$.t: expected a host frame (one of "welcome" | "lobby" | "full" | "toast" | "state"), got "${frame.value.t}"`,
        )
      : ok(frame.value);
  };

  // Outbound builders, in emit order (the legacy literals, key for key): a guest joins and acts;
  // a host welcomes, repeats the lobby while waiting, turns a third peer away, toasts a refusal,
  // and sends the view. The room spreads after `hostName`, where gin's `target` always sat.
  return {
    decodeFrame,
    decodeGuestFrame,
    decodeHostFrame,
    join: (guestName) => ({ t: 'join', name: guestName }),
    action: (act) => ({ t: 'action', action: act }),
    welcome: (hostName, room) => ({ t: 'welcome', hostName, ...room }),
    lobby: (hostName, room) => ({ t: 'lobby', hostName, ...room }),
    full: () => ({ t: 'full' }),
    toast: (message) => ({ t: 'toast', msg: message }),
    state: (view) => ({ t: 'state', view }),
  };
};

/**
 * The name the host gives a joining guest (the legacy `onGuestMsg`): cut to NAME_MAX and trimmed,
 * `Jeff` when that leaves nothing, and ` 2` appended when it matches the host's own name
 * case-insensitively.
 */
export const guestNameFor = (rawName: string, hostName: string): string => {
  const trimmed = rawName.slice(0, NAME_MAX).trim();
  const named = trimmed === '' ? DEFAULT_GUEST_NAME : trimmed;
  return named.toLowerCase() === hostName.toLowerCase() ? `${named} 2` : named;
};
