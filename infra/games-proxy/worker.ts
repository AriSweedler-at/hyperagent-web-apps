// Cloudflare Worker serving the GitHub Pages site at https://games.sweedler.com.
//   /            -> arisweedler-at.github.io/hyperagent-web-apps/
//   /XXX         -> .../hyperagent-web-apps/games/XXX      (short game URLs)
//   /games/XXX   -> 301 to /XXX                            (landing-page links)
//   /shared/…    -> .../hyperagent-web-apps/shared/…       (assets loaded relatively by game pages)
//   /favicon.ico -> .../hyperagent-web-apps/shared/favicon.ico (the one icon the site ships; browsers
//                   and bookmarks ask the origin root for it)
//   /hyperagent-web-apps/… passes through unchanged.
// Only the slash-terminated prefixes are special: /games, /shared and /hyperagent-web-apps without
// a trailing slash fall into the /XXX rule. worker.test.ts pins every row of this table.
// The upstream origin is env.UPSTREAM (default https://arisweedler-at.github.io) so the same
// handler can front a local dist server in tests (tools/proxy-dev.ts).
// Deploy with `npx wrangler deploy` from this directory (wrangler bundles TypeScript natively).
// The TURN Worker's ALLOWED_ORIGINS must include https://games.sweedler.com.
// Types: `Request`, `Response`, `Headers`, `URL` and `fetch` are the globals @types/node declares
// (tsconfig.node.json); on Cloudflare they are the same WHATWG interfaces.

export const DEFAULT_UPSTREAM = 'https://arisweedler-at.github.io';

const SITE = '/hyperagent-web-apps';

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
  return { kind: 'fetch', path: `${SITE}/games${pathname}` };
};

/**
 * Pure inverse used for upstream redirects: an upstream pathname becomes the short pathname on
 * this origin (/hyperagent-web-apps/games/XXX -> /XXX, /hyperagent-web-apps/YYY -> /YYY).
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

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: rewriteLocation(response.headers, target, url.origin),
    });
  },
};

export default handler;
