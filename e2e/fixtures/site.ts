// The two emulated origins (docs/ARCHITECTURE.md "Two origins") and where each page lives on them.
// `pages` mirrors GitHub Pages: the site under /hyperagent-web-apps/ on tools/serve-dist.ts.
// `proxy` mirrors games.sweedler.com: short game URLs on tools/proxy-dev.ts, which runs the real
// Worker against the pages origin. Both serve dist/, the only build tree since docs/MIGRATION.md
// step 13 cut the last page over. `E2E_TARGET=live` (the nightly, .github/workflows/nightly.yml)
// swaps both for the deployed origins below: nothing local is started, and the pages fetch their
// ICE servers from turn.sweedler.com. Everything the harness needs to know about URLs is here, so
// specs never spell out an absolute site path themselves.
//
// Every local port is a fixed base plus one offset, `E2E_PORT_OFFSET` (default 0): pages 4173+o,
// proxy 8787+o, PeerServer 9000+o, and 3478+o reserved for the TURN server the relay spec will
// start. playwright.config.ts derives its webServer commands and readiness URLs from the same
// values, so `E2E_PORT_OFFSET=1000 npm run test:e2e` runs a second harness beside one that holds
// the default ports (another checkout, a stuck `npm run serve`), with nothing else to pass.

export type Project = 'pages' | 'proxy';
export type PageName = 'landing' | 'gin-rummy' | 'fidice';

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
/** The deployed origins the nightly plays (GitHub Pages, and the Cloudflare Worker in front of it). */
export const LIVE_ORIGINS: Readonly<Record<Project, string>> = {
  pages: 'https://arisweedler-at.github.io',
  proxy: 'https://games.sweedler.com',
};
const LOCAL_ORIGINS: Readonly<Record<Project, string>> = {
  pages: PAGES_ORIGIN,
  proxy: PROXY_ORIGIN,
};

/** `E2E_TARGET=live` plays the deployed site instead of the emulated one. */
export const isLive = (): boolean => process.env['E2E_TARGET'] === 'live';

/** A project's baseURL: the site root under the Pages mount, or the proxy's root. */
export const baseUrl = (project: Project): string => {
  const origin = (isLive() ? LIVE_ORIGINS : LOCAL_ORIGINS)[project];
  return project === 'pages' ? `${origin}${PAGES_BASE_PATH}` : `${origin}/`;
};
/** Local PeerServer (`peer` package) that `?peer=host:port` aims the pages at. */
export const PEER_HOST = LOCAL_HOST;
export const PEER_PORT = PORTS.peer;
export const PEER_SERVER = `${PEER_HOST}:${String(PEER_PORT)}`;
/** Reserved for the coturn the relay spec starts (e2e/gin-relay.spec.ts); nothing binds it yet. */
export const TURN_PORT = PORTS.turn;
/** STUN-only ICE list served by serve-dist from e2e/fixtures/e2e-ice.json (`--alias`). */
export const ICE_URL = `${PAGES_ORIGIN}${PAGES_BASE_PATH}e2e-ice.json`;
/** What e2e/fixtures/e2e-ice.json holds; test/tools/serve-dist.test.ts pins the file to it. */
export const ICE_FIXTURE = { iceServers: [{ urls: 'stun:127.0.0.1:3478' }] } as const;

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

export const PROJECTS: ReadonlyArray<Project> = ['pages', 'proxy'];
export const PAGES: ReadonlyArray<PageName> = ['landing', 'gin-rummy', 'fidice'];

export const EXPECTED_TITLES: Readonly<Record<PageName, string>> = {
  landing: "Ari's web apps",
  'gin-rummy': 'Gin Rummy',
  fidice: "Fidice — one-cup liar's dice",
};

/** Path of a page relative to the project's baseURL (`games/fidice/` on pages, `fidice/` on proxy). */
export const pagePath = (project: Project, page: PageName): string => {
  if (page === 'landing') return '';
  return project === 'proxy' ? `${page}/` : `games/${page}/`;
};

export const asProject = (name: string): Project => {
  if (name === 'pages' || name === 'proxy') return name;
  throw new Error(`unknown Playwright project: ${name}`);
};
