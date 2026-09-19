// The two emulated origins (docs/ARCHITECTURE.md "Two origins") and where each page lives on them.
// `pages` mirrors GitHub Pages: the site under /hyperagent-web-apps/ on tools/serve-dist.ts.
// `proxy` mirrors games.sweedler.com: short game URLs on tools/proxy-dev.ts, which runs the real
// Worker against the pages origin. Both serve dist/, the only build tree since docs/MIGRATION.md
// step 13 cut the last page over. Everything the harness needs to know about URLs is here, so
// specs never spell out an absolute site path themselves.

export type Project = 'pages' | 'proxy';
export type PageName = 'landing' | 'gin-rummy' | 'fidice';

/** The GitHub Pages mount point. The one place the harness may name it (see the lint ban). */
// eslint-disable-next-line no-restricted-syntax -- this is the mount point itself, not a URL a page emits
export const PAGES_BASE_PATH = '/hyperagent-web-apps/';

export const PAGES_ORIGIN = 'http://127.0.0.1:4173';
export const PROXY_ORIGIN = 'http://127.0.0.1:8787';
/** Local PeerServer (`peer` package) that `?peer=host:port` aims the pages at. */
export const PEER_HOST = '127.0.0.1';
export const PEER_PORT = 9000;
export const PEER_SERVER = `${PEER_HOST}:${String(PEER_PORT)}`;
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
