// The one registry of the games the harness enumerates (README.md "Add a game" step 7;
// docs/design/shared-shell.md §6.1): one row per game holding what the e2e fixtures, the dist
// guards and the computed-style oracle used to spell each in a list of their own, so a fact about
// a game (its title, its hook, its storage keys, the shape of its page, the class-contract floors,
// the PeerJS debug level, its test suite and its own specs) is written once; GAMES, PAGE_TITLES and
// HOOKS are read off the rows, and tools/ci/suites.ts derives each game suite's rows from them.
// `Game` itself is web/shared/lib/roomCode.ts's closed union, so a game the harness names must
// have a room-code row, and a game the union gains shows up here as a type error until it has a
// row. tools/games.test.ts pins every value. The `shell` block of §6.1 (the heading, the tabs, the
// guest-answered status, the connection dot, the local fields) is SHELL below, one row per shell
// game, spread into the game's REGISTRY row; e2e/shell-*.spec.ts drive every shell game by it.
import type { Game } from '../web/shared/lib/roomCode.ts';

export type { Game };

/**
 * The game suites' names (tools/ci/suites.ts): `npm run test:<suite>`, the value of CI's two matrix
 * jobs, and the prefix of the game's parity oracles (`test/parity/<suite>.*`) and, by convention,
 * of its own e2e specs. A game's row names its suite (dry-round-2.md I6), and a name here without
 * a suites.ts row is a type error there.
 */
export type GameSuite = 'gin' | 'fidice' | 'backgammon' | 'briscola';

/** The pages smoke opens: every game and the landing page. */
export type PageName = Game | 'landing';

/** One game's row: every fact about it the harness reads. */
export type GameSpec = Readonly<{
  /** `<title>` of the page, as e2e/smoke.spec.ts expects it and the dist guards find it. */
  title: string;
  /** The documented test hook the page exposes once its boot finished (docs/ARCHITECTURE.md "Documented test hooks"). */
  hook: string;
  /** The game's test suite: gin's is `gin`, the others' their folder name (GameSuite). */
  suite: GameSuite;
  /**
   * The game's own e2e specs, as Playwright globs (`**\/<suite>-*.spec.ts`): the table flows and
   * geometry a shared spec cannot carry. The shared specs are not listed: tools/ci/suites.ts adds
   * the shell specs (a describe per game) to every row, since every game is a shell game.
   */
  specs: ReadonlyArray<string>;
  /**
   * The shell's localStorage keys (shared-shell.md §6.1): the save of the game in progress and the
   * prefix every preference key carries (`<prefix>homeTab`, `<prefix>playMode`, ...), as the game's
   * storage.ts STORAGE_KEYS spells them (the test pins the two equal). Fidice's are its shell
   * path's (docs/design/fidice-shell-adoption.md §3 "Storage"; registered at M5): the legacy
   * `fidice-name` is copied into `fidice_name` at boot and never read by the harness.
   */
  storage: Readonly<{ saveKey: string; prefix: string }>;
  /** The PeerJS `debug` level main.ts passes to `realTransport`, which `expectPeerOptions` asserts. */
  debug: 0 | 1;
  /**
   * What the built page must carry (test/dist/dist-parity.test.ts): the ids of its static screens
   * (fidice's are the composed shell page's since M2 of docs/design/fidice-shell-adoption.md, dark
   * while its legacy app paints into `#app`) and whether the two rules lists ship empty, to be
   * filled at boot from ui/rules.ts.
   */
  pageShape: Readonly<{ ids: ReadonlyArray<string>; rulesSlots: boolean }>;
  /**
   * How many class names the class-contract extraction must find in the game's TypeScript and in
   * its page markup (test/dist/class-contract.test.ts), so an extraction that silently finds
   * nothing (a moved file, a changed helper name) fails there rather than passing the two orphan
   * tests vacuously. TypeScript: gin and fidice spell most names out; backgammon's board builders
   * make theirs by template (`die-${face}`, `ck-${owner}`, the `conn-dot` attribute), which the
   * extraction cannot see (42 seen; the rest are CONTRACT.md rows). Markup: every page carries its
   * screens, fidice's since M2 of docs/design/fidice-shell-adoption.md composed its page (before
   * it, the vdom painted the whole page into `#app` and -1 let any count pass).
   */
  contractFloors: Readonly<{ ts: number; markup: number }>;
  /** The shared shell's row (SHELL): every game is a shell game since M5 of docs/design/fidice-shell-adoption.md. */
  shell: ShellSpec;
}>;

/**
 * What the shared shell specs (e2e/shell-*.spec.ts, docs/design/shared-shell.md §6.1-6.3) ask a game
 * by name: what the two pages spell differently while their ids agree. Data only (strings, lists,
 * one RegExp), so tools/games.test.ts pins every row with toEqual and a node script reads the
 * registry without Playwright; what needs a Page or a seat's name (the curtain's sub line, the
 * table half once the shell has connected) is the game's row in e2e/fixtures/online-games.ts.
 */
export type ShellSpec = Readonly<{
  /** `#homeScreen h1`. */
  heading: string;
  /** The `title` of the payload `#shareCodeBtn` hands the share sheet (main.ts shareInvite). */
  shareTitle: string;
  /** `#topTabbar .tab-btn`, in order. */
  tabs: ReadonlyArray<string>;
  /**
   * `#playModeSwitch .mode-btn` and `#playSubmenu button`, in order, gin's hidden Sandbox entry
   * included: a locator counts hidden buttons too.
   */
  modes: ReadonlyArray<string>;
  /**
   * The host card's fields the shell specs set before hosting, each with its value (`localFields`'
   * twin): fidice's chairs to two, so its room is the two-seat room the shell specs are written
   * for (the waiting-room copy the shell's, a returning guest's join held at the full room and
   * moved back to its seat by name: web/shared/net/host.ts `accept`, plan §7 D5); the N-seat table
   * is e2e/fidice-online.spec.ts's. Empty where the card has no field to set.
   */
  hostFields: ReadonlyArray<readonly [id: string, value: string]>;
  /**
   * `#guestWaitStatus` once the host has answered the join. The guest itself writes 'Connected.
   * Waiting for the host to start…' when the channel opens, before its join is sent; only the
   * host's reply carries a name (gin's a target too).
   */
  hostAnswered: RegExp;
  /** The table's connection dot, `on` while the peer is connected. */
  connDot: string;
  /**
   * What the two pass-and-play inputs show when nothing is remembered, and who is seated when they
   * are left empty: the game's shellConfig.ts `localNames` (backgammon; the owner, 2026-09-25:
   * "backgammon is Ari and Ethan"), else web/shared/ui/shell.ts DEFAULT_LOCAL_NAMES (gin).
   */
  localNames: readonly [string, string];
  /** The pass-and-play panel's fields beyond the two names, each with the value it starts at. */
  localFields: ReadonlyArray<readonly [id: string, value: string]>;
  /**
   * The `.btn`s the curtain carries: the reveal, and backgammon's "Continue online" (the handoff
   * offered under the curtain, where the phone is about to change hands; gin's table alone offers it).
   */
  curtainButtons: number;
}>;

/**
 * The games with the shared shell (the home screen, the waiting rooms, the curtain, the toast:
 * docs/design/shared-shell.md §3.1): every game, since M5 of docs/design/fidice-shell-adoption.md
 * registered fidice (its shell path, behind `?shell=1` until M6 flips the page: the harness opens
 * it through e2e/fixtures/player.ts PAGE_QUERY). A game here without a SHELL row, or a row in
 * e2e/fixtures/online-games.ts, is a type error. GAMES order.
 */
export type ShellGame = 'gin-rummy' | 'fidice' | 'backgammon' | 'briscola';
export const SHELL_GAMES: ReadonlyArray<ShellGame> = [
  'gin-rummy',
  'fidice',
  'backgammon',
  'briscola',
];

/** One shell row per shell game; REGISTRY carries each as its `shell`. */
export const SHELL: Readonly<Record<ShellGame, ShellSpec>> = {
  'gin-rummy': {
    heading: '♠ Gin Rummy',
    shareTitle: 'Gin Rummy',
    tabs: ['Play', 'Rules', 'Score', 'About'],
    modes: ['🌐 Online', '📱 Pass & Play', '🧪 Sandbox'],
    hostFields: [],
    hostAnswered: /^Connected to .+'s room \(playing to \d+\)\. Waiting for the host to start/,
    connDot: '#connDot',
    localNames: ['Ari', 'Lavi'],
    localFields: [['localTargetInput', '100']],
    curtainButtons: 1,
  },
  fidice: {
    // The masthead's brand (page.ts `masthead`): the cup glyph, then the name.
    heading: '🥤Fidice',
    shareTitle: 'Fidice',
    // Play / Rules / Ladder / About: the composed page's order (storage.ts HOME_TABS; plan §7 D12).
    tabs: ['Play', 'Rules', 'Ladder', 'About'],
    // Online and Pass the phone are stored; Solo and Watch are shown only (plan §7 D9).
    modes: ['Online', 'Pass the phone', 'Solo', 'Watch'],
    // The host card opens six chairs by default; the shell specs' tables seat two (see ShellSpec).
    hostFields: [['seatsSel', '2']],
    // shellConfig.ts `hostRoomMsg`: the host's welcome names the host; past a table of two the
    // count of seats taken rides in front (fidice-online.spec.ts reads that form).
    hostAnswered: /^Connected — (\d+ of \d+ seated · )?waiting for .+ to start$/,
    connDot: '#connDot',
    // shellConfig.ts LOCAL_NAMES: the shell's two proper names; the third to sixth seats are the page's own.
    localNames: ['Ari', 'Lavi'],
    // No field beyond the names: the host card's terms (the kayaks, the computers) apply to pass the phone too (D7).
    localFields: [],
    // The reveal alone ("Lift the cup", D8): the handoff is the table's 🌐, never the curtain's.
    curtainButtons: 1,
  },
  backgammon: {
    heading: 'Sheshbesh',
    shareTitle: 'Sheshbesh',
    tabs: ['Play', 'Rules', 'About'],
    modes: ['Online', 'Pass the phone'],
    hostFields: [],
    // ui/state.ts `hostRoomMsg`: only the host's `lobby` reply carries the host's name.
    hostAnswered: /^Connected — waiting for .+ to start$/,
    connDot: '#oppDot',
    localNames: ['Ari', 'Ethan'],
    localFields: [
      ['localVariantSel', 'portes'],
      ['localMatchLengthSel', '5'],
    ],
    curtainButtons: 2,
  },
  briscola: {
    heading: 'Briscola',
    shareTitle: 'Briscola',
    tabs: ['Play', 'Rules', 'About'],
    modes: ['Online', 'Pass the phone'],
    hostFields: [],
    // shellConfig.ts `hostRoomMsg`: only the host's `lobby` reply carries the host's name.
    hostAnswered: /^Connected — waiting for .+ to deal$/,
    connDot: '#oppDot',
    // The first two of shellConfig.ts LOCAL_NAMES (the owner's "Ari and Lavi (with p3 Sandro and p4 Grant)"); the third and fourth are the page's.
    localNames: ['Ari', 'Lavi'],
    // The one select: two players (D3). One game per sitting and no house-rule controls since
    // 2026-09-25 (the owner: "take out the 'match' dropdown … get rid of the option to set house rules").
    localFields: [['localPlayersSel', '2']],
    // The reveal and "Continue online": the handoff is offered under the curtain at two seats (D17).
    curtainButtons: 2,
  },
};

/** The 24 points, direct children of #board in absolute order (docs/design/backgammon-board.md §2.2.1). */
const POINT_IDS: ReadonlyArray<string> = Array.from(
  { length: 24 },
  (_, i) => `point-${String(i + 1)}`,
);

/** Every game the site builds, one row each, in the order the landing page lists them. */
export const REGISTRY: Readonly<Record<Game, GameSpec>> = {
  'gin-rummy': {
    title: 'Gin Rummy',
    hook: 'window.__gin',
    suite: 'gin',
    specs: ['**/gin-*.spec.ts'],
    storage: { saveKey: 'ginRummyMP_v1', prefix: 'ginRummy_' },
    debug: 0,
    // The legacy ids, kept by web/games/gin-rummy/index.html, with the two rules slots empty.
    pageShape: {
      ids: ['app', 'homeScreen', 'tableScreen', 'scResOverlay', 'toast'],
      rulesSlots: true,
    },
    contractFloors: { ts: 50, markup: 40 },
    shell: SHELL['gin-rummy'],
  },
  fidice: {
    title: "Fidice — one-cup liar's dice",
    hook: 'window.__fidice',
    suite: 'fidice',
    // Its own spec (e2e/fidice-online.spec.ts: the N-seat table, three humans and a computer through
    // the shared sessions; Solo and Watch); the eight shell specs play it as they play every shell
    // game, on the shell path (M5 of docs/design/fidice-shell-adoption.md).
    specs: ['**/fidice-*.spec.ts'],
    // src/storage.ts STORAGE_KEYS: the shell path's save and preference keys (plan §3 "Storage").
    storage: { saveKey: 'fidiceMP_v1', prefix: 'fidice_' },
    debug: 1,
    // The composed shell page's screens (M2 of docs/design/fidice-shell-adoption.md; page.ts): the
    // shell's five, the bot config screen, the Ladder tab's panel and the table's mount. The rules
    // slots ship empty and the shell path fills them at boot (M4, ui/rules.ts).
    pageShape: {
      ids: [
        'app',
        'homeScreen',
        'hostWaitScreen',
        'guestWaitScreen',
        'tableScreen',
        'endgameScreen',
        'configScreen',
        'ladderPanel',
        'fidiceTable',
        'toast',
      ],
      rulesSlots: true,
    },
    contractFloors: { ts: 50, markup: 40 },
    shell: SHELL.fidice,
  },
  backgammon: {
    title: 'Sheshbesh — backgammon',
    hook: 'window.__backgammon',
    suite: 'backgammon',
    specs: ['**/backgammon-*.spec.ts'],
    storage: { saveKey: 'backgammonMP_v1', prefix: 'backgammon_' },
    debug: 0,
    // Gin-shaped: static screens, the 24 points (the seat mapping is an attribute, so the markup
    // ships seat 0's `data-own` for every point) and the same empty rules slots.
    pageShape: {
      ids: ['app', 'homeScreen', 'tableScreen', 'board', 'toast', ...POINT_IDS],
      rulesSlots: true,
    },
    contractFloors: { ts: 35, markup: 40 },
    shell: SHELL.backgammon,
  },
  briscola: {
    title: 'Briscola — cards',
    hook: 'window.__briscola',
    suite: 'briscola',
    specs: ['**/briscola-*.spec.ts'],
    storage: { saveKey: 'briscolaMP_v1', prefix: 'briscola_' },
    debug: 0,
    // Gin-shaped: static screens, the table's fixed slots (the hand, the fan, the stock and the
    // briscola under it, the score strip) and the same empty rules slots (docs/design/briscola.md §5.8).
    pageShape: {
      ids: [
        'app',
        'homeScreen',
        'tableScreen',
        'hand',
        'trick',
        'stock',
        'briscola',
        'scoreStrip',
        'toast',
      ],
      rulesSlots: true,
    },
    contractFloors: { ts: 35, markup: 40 },
    shell: SHELL.briscola,
  },
};

/** Every game the site builds, in the order the landing page lists them: REGISTRY's row order. */
export const GAMES: ReadonlyArray<Game> = Object.keys(REGISTRY) as ReadonlyArray<Game>;

/** One value per game, read off its row (the cast: Object.fromEntries widens the keys to string). */
const perGame = <T>(pick: (spec: GameSpec) => T): Readonly<Record<Game, T>> =>
  Object.fromEntries(GAMES.map((game) => [game, pick(REGISTRY[game])])) as Record<Game, T>;

/** The games with a frozen legacy page under legacy/<g>/index.html (the oracle source, never served). */
export const LEGACY_GAMES: ReadonlyArray<Game> = ['gin-rummy', 'fidice'];

/** `<title>` of each page, as e2e/smoke.spec.ts expects it. */
export const PAGE_TITLES: Readonly<Record<PageName, string>> = {
  landing: "Ari's web apps",
  ...perGame((spec) => spec.title),
};

/** The documented test hook each page exposes once its boot finished (docs/ARCHITECTURE.md "Documented test hooks"). */
export const HOOKS: Readonly<Record<Game, string>> = perGame((spec) => spec.hook);

/** The landing page's card links, relative to the site root, in GAMES order. */
export const LANDING_HREFS: ReadonlyArray<string> = GAMES.map((game) => `games/${game}/`);

/**
 * A game's second URL name -> the game folder it stands for: `/sheshbesh/` is the backgammon page.
 * An alias is not a game: no landing card, no room-code row, no REGISTRY row, and never a GAMES entry.
 * On the Pages origin web/games/<alias>/index.html is a stub that forwards to `../<game>/`, query
 * and hash intact; on games.sweedler.com the Worker serves `/<alias>/` from `games/<game>/` in place
 * (infra/games-proxy/worker.ts keeps its own copy of this map, since wrangler deploys that file
 * alone; its test pins the two equal). The dist guards check each stub, and only the game's own URL
 * is linked from the landing page. The values are folder names rather than `Game`: backgammon's
 * page and its `Game` row land separately from this alias.
 */
export const ALIASES: Readonly<Record<string, string>> = { sheshbesh: 'backgammon' };
