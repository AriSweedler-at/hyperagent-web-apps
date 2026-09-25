// The two emulated origins (docs/ARCHITECTURE.md "Two origins") and where each page lives on them.
// `pages` mirrors GitHub Pages: the site under /hyperagent-web-apps/ on tools/serve-dist.ts.
// `proxy` mirrors games.sweedler.com: short game URLs on tools/proxy-dev.ts, which runs the real
// Worker against the pages origin. Both serve dist/, the only build tree since docs/MIGRATION.md
// step 13 cut the last page over. `E2E_TARGET=deployed` (the nightly, .github/workflows/nightly.yml)
// aims `pages` at the deployed GitHub Pages origin instead and defines no `proxy` project
// (games.sweedler.com is a Cloudflare Worker, and no test depends on Cloudflare: issue #19); every
// server stays local, and the deployed page reaches them through its `?peer=` and `?ice=` hooks.
// Everything the harness needs to know about URLs is here, so specs never spell out an absolute
// site path themselves.
//
// Every local port is a fixed base plus one offset, `E2E_PORT_OFFSET` (default 0): pages 4173+o,
// proxy 8787+o, PeerServer 9000+o, and the TURN relay (coturn) 3478+o with its relay ports right
// above it. playwright.config.ts derives its webServer commands and readiness URLs from the same
// values, so `E2E_PORT_OFFSET=1000 npm run test:e2e` runs a second harness beside one that holds
// the default ports (another checkout, a stuck `npm run serve`), with nothing else to pass.
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

import { GAMES, PAGE_TITLES, type PageName } from '../../tools/games.ts';

export type Project = 'pages' | 'proxy';
export type { PageName };

/** The GitHub Pages mount point. The one place the harness may name it (see the lint ban). */
// eslint-disable-next-line no-restricted-syntax -- this is the mount point itself, not a URL a page emits
export const PAGES_BASE_PATH = '/hyperagent-web-apps/';

/** `E2E_PORT_OFFSET`, parsed once: unset or empty is 0; anything but a non-negative integer is a mistake. */
const portOffset = (): number => {
  const raw = process.env['E2E_PORT_OFFSET'];
  if (raw === undefined || raw === '') return 0;
  const offset = Number(raw);
  if (!Number.isInteger(offset) || offset < 0 || offset > 60_000) {
    throw new Error(`E2E_PORT_OFFSET must be a non-negative integer, got ${JSON.stringify(raw)}`);
  }
  return offset;
};
export const PORT_OFFSET = portOffset();
const BASE_PORTS = { pages: 4173, proxy: 8787, peer: 9000, turn: 3478 } as const;
/** The four local ports this run binds (pages, proxy, PeerServer, TURN), each base plus PORT_OFFSET. */
export const PORTS: Readonly<Record<keyof typeof BASE_PORTS, number>> = {
  pages: BASE_PORTS.pages + PORT_OFFSET,
  proxy: BASE_PORTS.proxy + PORT_OFFSET,
  peer: BASE_PORTS.peer + PORT_OFFSET,
  turn: BASE_PORTS.turn + PORT_OFFSET,
};
export const LOCAL_HOST = '127.0.0.1';

export const PAGES_ORIGIN = `http://${LOCAL_HOST}:${String(PORTS.pages)}`;
export const PROXY_ORIGIN = `http://${LOCAL_HOST}:${String(PORTS.proxy)}`;
/** The deployed GitHub Pages origin, the `pages` project's under `E2E_TARGET=deployed`. */
export const DEPLOYED_PAGES_ORIGIN = 'https://arisweedler-at.github.io';

export type Target = 'local' | 'deployed';
/**
 * `E2E_TARGET`, parsed once: unset or empty is `local`. The retired `live` (both deployed origins
 * through the real broker and turn.sweedler.com) is refused like any other value, so an old
 * command line fails at once instead of quietly playing the emulated site.
 */
const target = (): Target => {
  const raw = process.env['E2E_TARGET'];
  if (raw === undefined || raw === '' || raw === 'local') return 'local';
  if (raw === 'deployed') return 'deployed';
  throw new Error(`E2E_TARGET must be "local" or "deployed", got ${JSON.stringify(raw)}`);
};
export const TARGET: Target = target();
/**
 * The deployed page is the subject: `pages` is DEPLOYED_PAGES_ORIGIN, the local servers still run
 * (serve-dist for the ICE lists, PeerServer, coturn) and the page is opened with hooks naming them.
 */
export const isDeployed = (): boolean => TARGET === 'deployed';

/** The Playwright projects this run defines: no `proxy` against the deployed site (it is Cloudflare). */
export const PROJECTS: ReadonlyArray<Project> = isDeployed() ? ['pages'] : ['pages', 'proxy'];

/** A project's baseURL: the site root under the Pages mount (deployed or emulated), or the emulated proxy's root. */
export const baseUrl = (project: Project): string =>
  project === 'proxy'
    ? `${PROXY_ORIGIN}/`
    : `${isDeployed() ? DEPLOYED_PAGES_ORIGIN : PAGES_ORIGIN}${PAGES_BASE_PATH}`;

/**
 * Specs about the page alone, not its origin (the hand's geometry and flows, the stories, the
 * scorer, the shell's home, pass-and-play and liveness, the two parity oracles): both origins serve
 * the same bytes and the second run only cost CI minutes, so they play on `pages` only and every
 * other project leaves them out (`ignoredSpecs`, each project's `testIgnore` in
 * playwright.config.ts). A spec about an origin (the smoke, the two-peer games, resume, the
 * handoff's invite link, the relay-forced games) is not listed and runs on both. Beside PROJECTS
 * since dry-round-2.md I7 (D11), so the projects and what each plays are read in one place.
 */
export const PAGE_ONLY_SPECS: ReadonlyArray<string> = [
  '**/backgammon-geometry.spec.ts',
  '**/backgammon-local.spec.ts',
  '**/backgammon-table-ux.spec.ts',
  '**/briscola-geometry.spec.ts',
  '**/briscola-local.spec.ts',
  '**/briscola-stories.spec.ts',
  '**/computed-styles.spec.ts',
  '**/gin-drag-discard.spec.ts',
  '**/gin-arrange.spec.ts',
  '**/gin-card-back.spec.ts',
  '**/gin-discard.spec.ts',
  '**/gin-dom-parity.spec.ts',
  '**/gin-draw.spec.ts',
  '**/gin-geometry.spec.ts',
  '**/gin-layoff.spec.ts',
  '**/gin-local.spec.ts',
  '**/gin-sandbox.spec.ts',
  '**/gin-scorer.spec.ts',
  '**/gin-sound-font.spec.ts',
  '**/gin-stories.spec.ts',
  '**/shell-glossary.spec.ts',
  '**/shell-home.spec.ts',
  // The sessions' silence watch is a timer, the same on either origin.
  '**/shell-liveness.spec.ts',
  '**/shell-local.spec.ts',
];

/** The specs a project leaves out: the page-only ones on every project but `pages`. */
export const ignoredSpecs = (project: Project): ReadonlyArray<string> =>
  project === 'pages' ? [] : PAGE_ONLY_SPECS;
/** Local PeerServer (`peer` package) that `?peer=host:port` aims the pages at. */
export const PEER_HOST = LOCAL_HOST;
export const PEER_PORT = PORTS.peer;
export const PEER_SERVER = `${PEER_HOST}:${String(PEER_PORT)}`;
/**
 * The TURN relay the harness runs for the @relay specs (docs/ARCHITECTURE.md "CI"): coturn on
 * PORTS.turn, started by playwright.config.ts when `turnserver` is on PATH, with one static
 * long-term credential, loopback only, no TLS, and its relay ports right above the listening port
 * so they follow the offset too. The pages reach it through the generated ICE list below.
 */
export const TURN_HOST = LOCAL_HOST;
export const TURN_PORT = PORTS.turn;
export const TURN_USER = 'e2e';
export const TURN_CREDENTIAL = 'e2e-secret';
export const TURN_REALM = 'e2e.local';
/** The UDP ports coturn relays on: 64 right above the listening port (two games, a few interfaces each). */
export const TURN_RELAY_PORTS = { min: PORTS.turn + 1, max: PORTS.turn + 64 } as const;
/** Where playwright.config.ts writes what the offset decides (gitignored): the TURN ICE list and coturn's pidfile. */
export const GENERATED_DIR = 'e2e/fixtures/.generated';
export const TURN_PIDFILE = `${GENERATED_DIR}/turnserver.pid`;
export const ICE_TURN_FILE = `${GENERATED_DIR}/e2e-ice-turn.json`;

/**
 * The `turnserver` command line for PORTS.turn: no config file (-n), listen and relay on loopback
 * only, long-term credentials for the one static user, fingerprints, no TLS listener, no TCP
 * relay, peers on loopback allowed (both browsers are), the log on stdout. `--no-cli` matters on
 * Ubuntu's coturn 4.6, whose CLI otherwise binds 5766; Homebrew's 4.18 has it off and logs the
 * flag as deprecated, harmlessly.
 */
export const turnServerCommand = (): string =>
  [
    'turnserver',
    '-n',
    `--listening-ip ${TURN_HOST}`,
    `--listening-port ${String(TURN_PORT)}`,
    `--relay-ip ${TURN_HOST}`,
    `--min-port ${String(TURN_RELAY_PORTS.min)}`,
    `--max-port ${String(TURN_RELAY_PORTS.max)}`,
    '--lt-cred-mech',
    `--user ${TURN_USER}:${TURN_CREDENTIAL}`,
    `--realm ${TURN_REALM}`,
    '--fingerprint',
    '--no-tls',
    '--no-tcp-relay',
    '--no-cli',
    '--allow-loopback-peers',
    '--no-multicast-peers',
    '--log-file stdout',
    '--simple-log',
    `--pidfile ${TURN_PIDFILE}`,
  ].join(' ');

export type TurnStatus = 'on' | 'off' | 'missing';
const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
/** `turnserver` on PATH, as the shell running the webServer command will find it. */
export const turnServerOnPath = (): boolean =>
  (process.env['PATH'] ?? '')
    .split(delimiter)
    .filter((dir) => dir !== '')
    .some((dir) => isExecutable(join(dir, 'turnserver')));
/** Whether the harness starts coturn: `E2E_TURN=off` leaves it out on purpose; `missing` is no `turnserver` on PATH. */
export const turnStatus = (): TurnStatus =>
  process.env['E2E_TURN'] === 'off' ? 'off' : turnServerOnPath() ? 'on' : 'missing';
/** Why a @relay spec skips, per status; the `missing` line names the install on both platforms. */
export const TURN_SKIP_REASON: Readonly<Record<Exclude<TurnStatus, 'on'>, string>> = {
  missing: 'coturn not installed: brew install coturn (macOS) / apt-get install coturn (ubuntu)',
  off: 'the local TURN relay is off (E2E_TURN=off)',
};

/** STUN-only ICE list served by serve-dist from e2e/fixtures/e2e-ice.json (`--alias`). */
export const ICE_URL = `${PAGES_ORIGIN}${PAGES_BASE_PATH}e2e-ice.json`;
/** What e2e/fixtures/e2e-ice.json holds; test/tools/serve-dist.test.ts pins the file to it. */
export const ICE_FIXTURE = { iceServers: [{ urls: 'stun:127.0.0.1:3478' }] } as const;
/** The ICE list naming the local TURN relay, served by serve-dist from ICE_TURN_FILE (`{ ice: 'turn' }` in player.ts). */
export const ICE_TURN_URL = `${PAGES_ORIGIN}${PAGES_BASE_PATH}e2e-ice-turn.json`;
/** What ICE_TURN_FILE holds: a STUN entry on the relay's port (coturn answers Binding too) and the relay with its credentials. */
export const ICE_TURN_FIXTURE = {
  iceServers: [
    { urls: `stun:${TURN_HOST}:${String(TURN_PORT)}` },
    {
      urls: `turn:${TURN_HOST}:${String(TURN_PORT)}`,
      username: TURN_USER,
      credential: TURN_CREDENTIAL,
    },
  ],
} as const;

/**
 * The frozen legacy gin page (docs/MIGRATION.md step 13: no longer served, kept as the oracle
 * source), published on the `pages` origin under legacy/ by tools/serve-dist.ts aliases
 * (playwright.config.ts) for e2e/gin-dom-parity.spec.ts alone; dist/ holds no legacy file. It is
 * mounted two directories deep so its own `../../shared/ice.js` resolves to the aliased legacy copy.
 */
export const LEGACY_GIN_PAGE = 'legacy/games/gin-rummy/index.html';
/** Path under the Pages mount -> repo-relative file, as `--alias path=file` arguments. */
export const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  [LEGACY_GIN_PAGE]: 'legacy/gin-rummy/index.html',
  'legacy/shared/ice.js': 'legacy/shared/ice.js',
};

/** Every page smoke opens: the landing page, then the games as tools/games.ts lists them. */
export const PAGES: ReadonlyArray<PageName> = ['landing', ...GAMES];

export const EXPECTED_TITLES: Readonly<Record<PageName, string>> = PAGE_TITLES;

/** Path of a folder under games/ relative to the project's baseURL (`games/fidice/` on pages, `fidice/` on proxy); a game or an alias (tools/games.ts ALIASES). */
export const folderPath = (project: Project, name: string): string =>
  project === 'proxy' ? `${name}/` : `games/${name}/`;

/** Path of a page relative to the project's baseURL (`games/fidice/` on pages, `fidice/` on proxy). */
export const pagePath = (project: Project, page: PageName): string =>
  page === 'landing' ? '' : folderPath(project, page);

/**
 * The title of a page named at run time (the game an alias forwards to): its PAGE_TITLES row, or
 * an error naming the missing row, so a spec never compares against `undefined`.
 */
export const titleOf = (page: string): string => {
  const titles: Readonly<Record<string, string>> = EXPECTED_TITLES;
  const title = titles[page];
  if (title === undefined) throw new Error(`${page} has no PAGE_TITLES row in tools/games.ts`);
  return title;
};

export const asProject = (name: string): Project => {
  if (name === 'pages' || name === 'proxy') return name;
  throw new Error(`unknown Playwright project: ${name}`);
};
