// Cloudflare Worker serving the GitHub Pages site at https://games.sweedler.com.
//   /            -> arisweedler-at.github.io/hyperagent-web-apps/
//   /XXX         -> .../hyperagent-web-apps/games/XXX      (short game URLs)
//   /ALIAS/…     -> .../hyperagent-web-apps/games/GAME/…   (ALIASES: a game's second name, served in
//                   place so the address bar keeps /ALIAS/)
//   /ALIAS       -> 301 to /ALIAS/                          (this origin's slash redirect: the
//                   upstream's would land on /GAME/)
//   /games/XXX   -> 301 to /XXX                            (links already out there; /games/ALIAS too.
//                   The landing page itself is served with its `games/XXX/` hrefs rewritten to
//                   /XXX/, "Landing links" below, so a click from it never takes this hop.)
//   /shared/…    -> .../hyperagent-web-apps/shared/…       (assets loaded relatively by game pages)
//   /favicon.ico -> .../hyperagent-web-apps/shared/favicon.ico (the one icon the site ships; browsers
//                   and bookmarks ask the origin root for it)
//   /hyperagent-web-apps/… passes through unchanged.
// Only the slash-terminated prefixes are special: /games, /shared and /hyperagent-web-apps without
// a trailing slash fall into the /XXX rule. worker.test.ts pins every row of this table.
// A page fetched with `?join=CODE` (an invite link) has its Open Graph head rewritten to name the
// code: "Link previews" below, docs/design/link-previews.md.
// Two rewrites of a page body, then, both plain string rewrites over the buffered page rather than
// HTMLRewriter: the handler also runs in node (worker.test.ts, tools/proxy-dev.ts behind the
// Playwright `proxy` project), which has none, and both pages are this repo's own markup.
// The upstream origin is env.UPSTREAM (default https://arisweedler-at.github.io) so the same
// handler can front a local dist server in tests (tools/proxy-dev.ts).
// Deploy with `npx wrangler deploy` from this directory (wrangler bundles TypeScript natively).
// The TURN Worker's ALLOWED_ORIGINS must include https://games.sweedler.com.
// Types: `Request`, `Response`, `Headers`, `URL` and `fetch` are the globals @types/node declares
// (tsconfig.node.json); on Cloudflare they are the same WHATWG interfaces.

export const DEFAULT_UPSTREAM = 'https://arisweedler-at.github.io';

const SITE = '/hyperagent-web-apps';

/**
 * A game's second URL name -> the game folder it stands for (`/sheshbesh/` is the backgammon page).
 * tools/games.ts ALIASES spells the same map for the Pages origin, where dist/games/<alias>/ holds a
 * stub that forwards; worker.test.ts pins the two equal. Not imported from there: wrangler deploys
 * this file alone.
 */
export const ALIASES: Readonly<Record<string, string>> = { sheshbesh: 'backgammon' };

/** The Worker's bindings (wrangler.toml `[vars]`, or what tools/proxy-dev.ts passes). */
export type Env = Readonly<{ UPSTREAM?: string }>;

/**
 * What the Worker does with a pathname on this origin: `fetch` names the upstream pathname to
 * proxy; `redirect` the same-origin pathname to 301 to.
 */
export type Mapped =
  Readonly<{ kind: 'fetch'; path: string }> | Readonly<{ kind: 'redirect'; path: string }>;

/** Pure mapping from a pathname on this origin to what the Worker does with it. */
export const mapPath = (pathname: string): Mapped => {
  if (pathname === '/' || pathname === '') return { kind: 'fetch', path: `${SITE}/` };
  if (pathname.startsWith(`${SITE}/`)) return { kind: 'fetch', path: pathname };
  if (pathname.startsWith('/games/')) {
    return { kind: 'redirect', path: pathname.slice('/games'.length) };
  }
  if (pathname.startsWith('/shared/')) return { kind: 'fetch', path: SITE + pathname };
  if (pathname === '/favicon.ico') return { kind: 'fetch', path: `${SITE}/shared/favicon.ico` };
  const [, first = '', ...rest] = pathname.split('/');
  const game = ALIASES[first];
  if (game !== undefined) {
    if (rest.length === 0) return { kind: 'redirect', path: `/${first}/` };
    return { kind: 'fetch', path: `${SITE}/games/${game}/${rest.join('/')}` };
  }
  return { kind: 'fetch', path: `${SITE}/games${pathname}` };
};

/**
 * Pure inverse used for upstream redirects: an upstream pathname becomes the short pathname on
 * this origin (/hyperagent-web-apps/games/XXX -> /XXX, /hyperagent-web-apps/YYY -> /YYY). It knows
 * no alias: a redirect the upstream sends under /ALIAS/ lands on /GAME/, which is why /ALIAS alone
 * is redirected here and never fetched.
 */
export const unmapPath = (upstreamPathname: string): string => {
  const stripped = upstreamPathname.startsWith(`${SITE}/games/`)
    ? upstreamPathname.slice(`${SITE}/games`.length)
    : upstreamPathname.startsWith(`${SITE}/`)
      ? upstreamPathname.slice(SITE.length)
      : upstreamPathname;
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
};

/**
 * Copy the upstream headers, rewriting a Location that points back at the upstream host so the
 * browser stays on this origin. A Location elsewhere (or unparseable) passes through unchanged.
 * `target` is the upstream URL that was fetched (the base for relative Location values); `origin`
 * this Worker's origin, e.g. https://games.sweedler.com.
 */
const rewriteLocation = (
  upstreamHeaders: Headers,
  target: Readonly<URL>,
  origin: string,
): Headers => {
  const headers = new Headers(upstreamHeaders);
  const loc = headers.get('Location');
  if (loc === null || loc === '') return headers;
  try {
    const locUrl = new URL(loc, target);
    if (locUrl.hostname === target.hostname) {
      headers.set('Location', origin + unmapPath(locUrl.pathname) + locUrl.search);
    }
  } catch {
    // unparseable Location: leave it as the upstream sent it
  }
  return headers;
};

// ---- Link previews (docs/design/link-previews.md §3) ----------------------------------------
// An invite link (`/<game>/?join=CODE`) texted to a friend is unfurled by iMessage from the page's
// Open Graph head. The Pages origin serves one static head per game; this origin can vary it by
// query, so a GET for a page that carries a code gets its head rewritten: the title and the
// descriptions say the code, og:url is the invite itself, the splash og:image stays the game's.
// A string rewrite (the file header says why), over pages that are this repo's own composed markup
// (tools/shell-markup.ts), whose meta tags spell `property`/`name` before `content` on one line each.

/** The query parameter an invite link carries (web/shared/lib/invite.ts JOIN_PARAM; the test pins the two). */
export const JOIN_PARAM = 'join';

/**
 * The shape of a room code (web/shared/lib/roomCode.ts ROOM_CODE: four letters for the shell games,
 * five letters or digits for fidice; the test pins every game's alphabet and length inside it). Not
 * imported from there: wrangler deploys this file alone. Anything else in `?join=` is not previewed.
 */
const JOIN_CODE = /^[A-Za-z0-9]{4,5}$/;

/** The code the URL's `?join=` carries when it has a room code's shape, else undefined. */
export const joinCode = (url: Readonly<URL>): string | undefined => {
  const code = url.searchParams.get(JOIN_PARAM);
  return code !== null && JOIN_CODE.test(code) ? code : undefined;
};

/** `<meta property="key" content="…">` or `<meta name="key" content="…">`: the opening, the content, the closing quote. */
const metaTag = (key: string): RegExp =>
  new RegExp(`(<meta\\s+(?:property|name)="${key}"\\s+content=")([^"]*)(")`);

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The `content` of the page's first `<meta>` for `key` (an og: property or a twitter: name), if any. */
export const metaContent = (html: string, key: string): string | undefined =>
  metaTag(key).exec(html)?.[2];

const setMeta = (html: string, key: string, value: string): string =>
  html.replace(
    metaTag(key),
    (_tag: string, open: string, _old: string, close: string) =>
      `${open}${escapeAttribute(value)}${close}`,
  );

/**
 * The page with the invite's code in its preview: og:title and twitter:title name the game (read off
 * the page's own og:title) and the code, both descriptions say the code again, og:url is the invite.
 * A tag the page lacks is left out (nothing is inserted); a page without an og:title (a stub, an
 * error page) comes back untouched. `<title>` is not touched: the tab's name is the page's.
 */
export const joinPreview = (html: string, code: string, inviteUrl: string): string => {
  const game = metaContent(html, 'og:title');
  if (game === undefined) return html;
  const title = `Join ${game}: code ${code}`;
  const description = `You're invited to ${game}. Open the link to sit down; the room code is ${code}.`;
  const tags: ReadonlyArray<readonly [string, string]> = [
    ['og:title', title],
    ['twitter:title', title],
    ['og:description', description],
    ['twitter:description', description],
    ['og:url', inviteUrl],
  ];
  return tags.reduce((page, [key, value]) => setMeta(page, key, value), html);
};

// ---- Landing links ---------------------------------------------------------------------------
// web/index.html is one page for both origins and links its cards relatively, `games/<name>/`. On
// this origin that resolves to /games/<name>/, a 301 to /<name>/: every click paid a redirect hop,
// and the browser's history and autocomplete recorded the long form first, so players ended up
// copying and sharing /games/<name>/ (the owner's ask, 2026-09-28). Served from here, the landing
// page has its hrefs rewritten to the short URLs up front: a click is one request, and /<name>/ is
// the only form a player sees, copies or is offered. The redirect stays for links already out there.

/** The upstream pathname of the landing page: what `/` fetches (and what its long form passes through as). */
const LANDING = `${SITE}/`;

/**
 * The spellings of "under the site's games/" an href can carry, as the landing page resolves
 * them: relative to it, `/`-rooted on this origin, or the long form under the site prefix.
 */
const GAMES_PREFIXES: ReadonlyArray<string> = ['games/', './games/', '/games/', `${SITE}/games/`];

/**
 * An href as the landing page spells it -> the short URL on this origin: `games/<name>/…` in any
 * of GAMES_PREFIXES's spellings, with or without a trailing slash, query or fragment, becomes
 * `/<name>/…`, the very path mapPath redirects `/games/<name>/…` to (worker.test.ts pins the two
 * equal for every landing card). Every other href (another host, the site's shared/ assets, a
 * fragment, a mailto:) comes back as it is. Like mapPath it knows no list of games: whatever follows
 * games/ is a game's folder or an alias, and a name the site does not hold is the same 404 at
 * /<name>/ that it was at /games/<name>/.
 */
export const shortHref = (href: string): string => {
  const prefix = GAMES_PREFIXES.find((p) => href.startsWith(p));
  return prefix === undefined ? href : `/${href.slice(prefix.length)}`;
};

/** `href="…"` on any tag: the opening, the value, the closing quote (the page is this repo's own markup, double-quoted). */
const HREF = /(\bhref=")([^"]*)(")/g;

/** The landing page with every href under games/ shortened (shortHref); every other byte is the upstream's. */
export const shortenLandingLinks = (html: string): string =>
  html.replace(
    HREF,
    (_attr: string, open: string, value: string, close: string) =>
      `${open}${shortHref(value)}${close}`,
  );

const isHtml = (headers: Headers): boolean =>
  (headers.get('content-type') ?? '').startsWith('text/html');

/**
 * The rewrite a GET's HTML body gets on this origin, if any: the landing page's links shortened,
 * or an invite's preview (the two never meet: the landing page takes no code). `upstreamPath` is
 * the mapped upstream pathname the page is fetched from.
 */
const bodyRewrite = (
  url: Readonly<URL>,
  upstreamPath: string,
): ((html: string) => string) | undefined => {
  if (upstreamPath === LANDING) return shortenLandingLinks;
  const code = joinCode(url);
  if (code === undefined) return undefined;
  const invite = `${url.origin}${url.pathname}?${JOIN_PARAM}=${code}`;
  return (html) => joinPreview(html, code, invite);
};

/** The module-Worker shape Cloudflare calls; tools/proxy-dev.ts calls the same `fetch`. */
export type Handler = Readonly<{
  fetch: (request: Request, env?: Env) => Promise<Response>;
}>;

const handler: Handler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstream = env?.UPSTREAM ?? DEFAULT_UPSTREAM;
    const mapped = mapPath(url.pathname);

    if (mapped.kind === 'redirect') {
      return Response.redirect(url.origin + mapped.path + url.search, 301);
    }

    const target = new URL(mapped.path + url.search, upstream);

    // GET and HEAD carry no body (a `body` key, even undefined, is refused for them).
    const body =
      request.method !== 'GET' && request.method !== 'HEAD' ? { body: request.body } : {};
    const proxyReq = new Request(target, {
      method: request.method,
      headers: request.headers,
      redirect: 'manual',
      ...body,
    });

    const response = await fetch(proxyReq);
    const headers = rewriteLocation(response.headers, target, url.origin);

    // A GET for a page this origin rewrites (the landing page's links, an invite's preview): the
    // body changes, so the upstream's length and encoding no longer describe it. HEAD has no body
    // to rewrite and passes through as it is.
    const rewrite = request.method === 'GET' ? bodyRewrite(url, mapped.path) : undefined;
    if (rewrite !== undefined && response.status === 200 && isHtml(response.headers)) {
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new Response(rewrite(await response.text()), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export default handler;
