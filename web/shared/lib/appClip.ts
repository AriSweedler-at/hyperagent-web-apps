// The Dice App Clip as the site names it (ios/DiceClip/README.md "Owner checklist";
// docs/design/rps-island.md D2, §8 step 1, §11): the clip's bundle id, the App Store id the Smart
// App Banner needs (a placeholder until App Store Connect assigns one, the owner's step), the two
// invocation URLs (`/clip/dice`, `/clip/rps?session=<id>`) and the banner's `content`. The URLs
// are the clip's registered experiences on the live host, not site paths a page resolves (the
// "Two origins" rule is about the page's own assets): iOS matches them against the AASA whatever
// origin served the page, so the emulated proxy links to the same address the live one does. The
// session id's alphabet and shape are here too, so the page (which mints one) and the Worker
// (which validates `[A-Za-z0-9]{8}`) agree; the random bytes come from the edge.

/** The clip's bundle id (infra/games-proxy/rps-push.ts CLIP_BUNDLE spells the same for the Worker). */
export const CLIP_BUNDLE_ID = 'com.sweedler.games.dice.Clip';

/**
 * The parent app's App Store id, the `app-id` the Smart App Banner requires. PLACEHOLDER: App
 * Store Connect assigns the real one when the owner creates the app record (ios/DiceClip/README.md
 * step 3); until then Safari shows no banner for it, which is the right thing.
 */
export const APP_STORE_ID = '0000000000';

/** The host the App Clip experiences are registered on (the AASA is served from it). */
export const CLIP_ORIGIN = 'https://games.sweedler.com';

/** The two experiences one clip answers (rps-island.md D2). */
export const CLIP_PATHS = { dice: '/clip/dice', rps: '/clip/rps' } as const;
export type ClipExperience = keyof typeof CLIP_PATHS;

/** `<meta name="apple-itunes-app">`: the Smart App Banner's tag name. */
export const SMART_APP_BANNER_META = 'apple-itunes-app';

/** A session id: eight lowercase letters or digits (the Worker takes either case; the page mints lowercase). */
export const SESSION_LENGTH = 8;
export const SESSION_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SESSION_SHAPE = /^[A-Za-z0-9]{8}$/;

export const isSession = (value: string): boolean => SESSION_SHAPE.test(value);

/**
 * A session id from random bytes (the edge's `crypto.getRandomValues`): one alphabet character
 * per byte, the first eight. The modulo's bias (256 is not a multiple of 36) is a hair on an id
 * that is a pairing handle, not a secret.
 */
export const sessionFrom = (bytes: ReadonlyArray<number>): string =>
  bytes
    .slice(0, SESSION_LENGTH)
    .map((b) => SESSION_ALPHABET.charAt(b % SESSION_ALPHABET.length))
    .join('');

/** A query string from pairs, each side percent-encoded; '' for none. */
const queryOf = (params: ReadonlyArray<readonly [string, string]>): string =>
  params.length === 0
    ? ''
    : `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;

/** An experience's invocation URL, with its query. */
export const clipUrl = (
  experience: ClipExperience,
  params: ReadonlyArray<readonly [string, string]> = [],
): string => `${CLIP_ORIGIN}${CLIP_PATHS[experience]}${queryOf(params)}`;

/** The buddy's URL for a session: `https://games.sweedler.com/clip/rps?session=<id>` (§5, §8 step 1). */
export const rpsClipUrl = (session: string): string => clipUrl('rps', [['session', session]]);

/**
 * The Smart App Banner's `content` for an App Clip (Apple, "Configuring the launch experience of
 * your App Clip": `app-id`, `app-clip-bundle-id`, `app-clip-display=card` for the full card, and
 * `app-argument`, the invocation URL the clip receives).
 */
export const smartAppBanner = (argument: string): string =>
  `app-id=${APP_STORE_ID}, app-clip-bundle-id=${CLIP_BUNDLE_ID}, app-clip-display=card, app-argument=${argument}`;
