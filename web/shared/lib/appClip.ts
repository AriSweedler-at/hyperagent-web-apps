// The Dice App Clip as the site names it (ios/DiceClip/README.md "Owner checklist";
// docs/design/rps-island.md D2, §8 step 1, §11): the clip's bundle id, the App Store id the Smart
// App Banner needs (a placeholder until App Store Connect assigns one, the owner's step), the two
// invocation URLs (`/clip/dice`, `/clip/rps?session=<id>`) and the banner's `content`. The URLs
// are the clip's registered experiences on the live host, not site paths a page resolves (the
// "Two origins" rule is about the page's own assets): iOS matches them against the AASA whatever
// origin served the page, so the emulated proxy links to the same address the live one does. The
// session id's alphabet and shape are here too, so the page (which mints one) and the Worker
// (which validates `[A-Za-z0-9]{8}`) agree; the random bytes come from the edge.
// Below the pairing's names, the dice's (docs/design/ui-sandbox.md §7, the `sizer-island-dice`
// lane): the owner's two ids with their placeholders and `isConfigured`, the AASA document, the
// dice URL with a roll, and the gate the sandbox's "Roll in the Island" button obeys.
import type { Device } from './devices.ts';

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

// ---- The dice: what only the owner can fill, and what turns on when they do -------------------------

/** `APP_STORE_ID`'s value until App Store Connect assigns the real one (README step 3). */
export const APP_STORE_ID_PLACEHOLDER = '0000000000';
/**
 * The owner's Apple team id (README step 1: Membership details), the AASA's prefix. PLACEHOLDER
 * until the owner fills it; `isConfigured` is false while either id is its placeholder.
 */
export const TEAM_ID = 'TEAMID';
export const TEAM_ID_PLACEHOLDER = 'TEAMID';
/** The parent app's bundle id: the clip's less `.Clip` (README "What is here"); the AASA's `applinks` names it. */
export const APP_BUNDLE_ID = 'com.sweedler.games.dice';

/** The two ids the site's rules read, as one value: the constants above, or a filled pair a test hands in. */
export type ClipIds = Readonly<{ appStoreId: string; teamId: string }>;
export const CLIP_IDS: ClipIds = { appStoreId: APP_STORE_ID, teamId: TEAM_ID };

/**
 * True once both ids are real. Then, and not before: the sandbox emits the Smart App Banner, the
 * AASA must be in the tree (test/dist/aasa.test.ts) and the sandbox's button may open the clip.
 */
export const isConfigured = (ids: ClipIds = CLIP_IDS): boolean =>
  ids.appStoreId !== APP_STORE_ID_PLACEHOLDER && ids.teamId !== TEAM_ID_PLACEHOLDER;

/** The Smart App Banner's `content` for a filled pair (`smartAppBanner` spells the constants'), or null unconfigured. */
export const bannerContent = (argument: string, ids: ClipIds = CLIP_IDS): string | null =>
  isConfigured(ids)
    ? `app-id=${ids.appStoreId}, app-clip-bundle-id=${CLIP_BUNDLE_ID}, app-clip-display=card, app-argument=${argument}`
    : null;

/**
 * Apple's association file on the host (README step 6): JSON with no extension, served from the
 * site's root with no redirect. web/public/.well-known/ holds it once configured; the Worker maps
 * the directory (infra/games-proxy/worker.ts) and stamps `application/json` on it.
 */
export const AASA_PATH = '/.well-known/apple-app-site-association';
export type AppSiteAssociation = Readonly<{
  appclips: Readonly<{ apps: ReadonlyArray<string> }>;
  applinks: Readonly<{
    details: ReadonlyArray<
      Readonly<{
        appIDs: ReadonlyArray<string>;
        components: ReadonlyArray<Readonly<{ '/': string }>>;
      }>
    >;
  }>;
}>;
/** The clip's app id in Apple's `TEAMID.bundle` form. */
export const clipAppId = (ids: ClipIds = CLIP_IDS): string => `${ids.teamId}.${CLIP_BUNDLE_ID}`;
/**
 * The AASA document: `appclips` names the clip; `applinks` hands `/clip/*` to the full app once
 * installed (README step 6, both blocks). Null unconfigured: the guard asserts the file's absence
 * then, so Apple never reads a placeholder team id.
 */
export const appSiteAssociation = (ids: ClipIds = CLIP_IDS): AppSiteAssociation | null =>
  isConfigured(ids)
    ? {
        appclips: { apps: [clipAppId(ids)] },
        applinks: {
          details: [
            { appIDs: [`${ids.teamId}.${APP_BUNDLE_ID}`], components: [{ '/': '/clip/*' }] },
          ],
        },
      }
    : null;

// ---- A roll ----------------------------------------------------------------------------------------

export type Die = 1 | 2 | 3 | 4 | 5 | 6;
/** Two dice, the first for the island's leading side. */
export type Roll = readonly [Die, Die];
/** The query the clip reads: `?roll=a,b`, a literal comma (README "A roll from the web"). */
export const ROLL_PARAM = 'roll';
/** What the sandbox shows before the first tap: the Xcode scheme's own `?roll=3,5`. */
export const INITIAL_ROLL: Roll = [3, 5];

/** A die from one random byte: the residue mod 6 plus one (a hair of bias, as `sessionFrom`). */
const dieFrom = (byte: number): Die => ((byte % 6) + 1) as Die;
/** A roll from two random bytes (the edge's `crypto.getRandomValues`); a missing byte is a 1. */
export const rollFrom = (bytes: ReadonlyArray<number>): Roll => [
  dieFrom(bytes[0] ?? 0),
  dieFrom(bytes[1] ?? 0),
];
/** The dice experience with a roll: `https://games.sweedler.com/clip/dice?roll=3,5`. */
export const diceClipUrl = (roll: Roll): string =>
  `${clipUrl('dice')}?${ROLL_PARAM}=${String(roll[0])},${String(roll[1])}`;

// ---- The gate --------------------------------------------------------------------------------------

/**
 * An iPhone whose catalogue row has the Dynamic Island (web/shared/lib/devices.ts ISLAND: the 14
 * Pro and Pro Max, every 15, 16 and 17, the Air). An Android hole is an island in the catalogue
 * too and never qualifies: the clip is iPhone-only (README "Hardware").
 */
export const islandIphone = (device: Device | null): boolean =>
  device !== null && device.kind === 'iphone' && device.cut?.island === true;

/** The one-line reasons under a disabled "Roll in the Island" (the owner: "disable the call to action green button unless the phone supports it"). */
export const GATE_REASONS = {
  hardware: 'Needs an iPhone with the Dynamic Island (14 Pro or later).',
  unpublished: 'The Dice App Clip is not published yet.',
} as const;
export type ClipGate = Readonly<{ enabled: boolean; reason: string | null }>;
/** Enabled only for an island iPhone with a configured clip; otherwise the reason, hardware first. */
export const clipGate = (device: Device | null, ids: ClipIds = CLIP_IDS): ClipGate =>
  !islandIphone(device)
    ? { enabled: false, reason: GATE_REASONS.hardware }
    : isConfigured(ids)
      ? { enabled: true, reason: null }
      : { enabled: false, reason: GATE_REASONS.unpublished };
