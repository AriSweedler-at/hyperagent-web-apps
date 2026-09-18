// The two emulated origins (docs/ARCHITECTURE.md "Two origins") and where each page lives on them.
// `pages` mirrors GitHub Pages: the site under /hyperagent-web-apps/ on tools/serve-dist.ts.
// `proxy` mirrors games.sweedler.com: short game URLs on tools/proxy-dev.ts, which runs the real
// Worker against the pages origin. `next` is the Pages layout again, serving dist-next/ (built with
// `LEGACY_PAGES=`, docs/MIGRATION.md step 6), so a ported page is played end to end before it is
// flipped; only the ported pages exist in that tree (fidice, flipped in step 7, is the same bytes
// there as in dist/; gin-rummy joins when its port lands). Everything the harness needs to know
// about URLs is here, so specs never spell out an absolute site path themselves.

export type Project = 'pages' | 'proxy' | 'next';
export type PageName = 'landing' | 'gin-rummy' | 'fidice';

/** The GitHub Pages mount point. The one place the harness may name it (see the lint ban). */
// eslint-disable-next-line no-restricted-syntax -- this is the mount point itself, not a URL a page emits
export const PAGES_BASE_PATH = '/hyperagent-web-apps/';

export const PAGES_ORIGIN = 'http://127.0.0.1:4173';
export const PROXY_ORIGIN = 'http://127.0.0.1:8787';
/** dist-next/ on a second tools/serve-dist.ts, mounted like Pages. */
export const NEXT_ORIGIN = 'http://127.0.0.1:4174';
/** Local PeerServer (`peer` package) that `?peer=host:port` aims the pages at. */
export const PEER_HOST = '127.0.0.1';
export const PEER_PORT = 9000;
export const PEER_SERVER = `${PEER_HOST}:${String(PEER_PORT)}`;
/** STUN-only ICE list served by serve-dist from e2e/fixtures/e2e-ice.json (`--alias`). */
export const ICE_URL = `${PAGES_ORIGIN}${PAGES_BASE_PATH}e2e-ice.json`;
/** What e2e/fixtures/e2e-ice.json holds; test/tools/serve-dist.test.ts pins the file to it. */
export const ICE_FIXTURE = { iceServers: [{ urls: 'stun:127.0.0.1:3478' }] } as const;

export const PROJECTS: ReadonlyArray<Project> = ['pages', 'proxy', 'next'];
export const PAGES: ReadonlyArray<PageName> = ['landing', 'gin-rummy', 'fidice'];
/** Pages a project's tree holds: dist/ has every page; dist-next/ only the landing and ported ones (no gin-rummy yet). */
export const PORTED_PAGES: ReadonlyArray<PageName> = ['landing', 'fidice'];
export const pagesOn = (project: Project): ReadonlyArray<PageName> =>
  project === 'next' ? PORTED_PAGES : PAGES;

export const EXPECTED_TITLES: Readonly<Record<PageName, string>> = {
  landing: "Ari's web apps",
  'gin-rummy': 'Gin Rummy',
  fidice: "Fidice — one-cup liar's dice",
};

/** Path of a page relative to the project's baseURL (`games/fidice/` on pages and next, `fidice/` on proxy). */
export const pagePath = (project: Project, page: PageName): string => {
  if (page === 'landing') return '';
  return project === 'proxy' ? `${page}/` : `games/${page}/`;
};

export const asProject = (name: string): Project => {
  if (name === 'pages' || name === 'proxy' || name === 'next') return name;
  throw new Error(`unknown Playwright project: ${name}`);
};
