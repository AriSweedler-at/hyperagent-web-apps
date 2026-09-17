// Cloudflare Worker serving the GitHub Pages site at https://games.sweedler.com.
//   /            -> arisweedler-at.github.io/hyperagent-web-apps/
//   /XXX         -> .../hyperagent-web-apps/games/XXX      (short game URLs)
//   /games/XXX   -> 301 to /XXX                            (landing-page links)
//   /shared/…    -> .../hyperagent-web-apps/shared/…       (assets loaded relatively by game pages)
//   /hyperagent-web-apps/… passes through unchanged.
// Only the slash-terminated prefixes are special: /games, /shared and /hyperagent-web-apps without
// a trailing slash fall into the /XXX rule. worker.test.js pins every row of this table.
// The upstream origin is env.UPSTREAM (default https://arisweedler-at.github.io) so the same
// handler can front a local dist server in tests (tools/proxy-dev.ts).
// Deploy with `npx wrangler deploy` from this directory, or paste into the dashboard editor.
// The TURN Worker's ALLOWED_ORIGINS must include https://games.sweedler.com.

export const DEFAULT_UPSTREAM = 'https://arisweedler-at.github.io';

const SITE = '/hyperagent-web-apps';

/**
 * Pure mapping from a pathname on this origin to what the Worker does with it.
 * @param {string} pathname
 * @returns {{ kind: 'fetch', path: string } | { kind: 'redirect', path: string }}
 *   fetch: the upstream pathname to proxy; redirect: the same-origin pathname to 301 to.
 */
export const mapPath = (pathname) => {
  if (pathname === '/' || pathname === '') return { kind: 'fetch', path: `${SITE}/` };
  if (pathname.startsWith(`${SITE}/`)) return { kind: 'fetch', path: pathname };
  if (pathname.startsWith('/games/')) {
    return { kind: 'redirect', path: pathname.slice('/games'.length) };
  }
  if (pathname.startsWith('/shared/')) return { kind: 'fetch', path: SITE + pathname };
  return { kind: 'fetch', path: `${SITE}/games${pathname}` };
};

/**
 * Pure inverse used for upstream redirects: an upstream pathname becomes the short pathname on
 * this origin (/hyperagent-web-apps/games/XXX -> /XXX, /hyperagent-web-apps/YYY -> /YYY).
 * @param {string} upstreamPathname
 * @returns {string}
 */
export const unmapPath = (upstreamPathname) => {
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
 * @param {Headers} upstreamHeaders
 * @param {URL} target the upstream URL that was fetched; base for relative Location values
 * @param {string} origin this Worker's origin, e.g. https://games.sweedler.com
 * @returns {Headers}
 */
const rewriteLocation = (upstreamHeaders, target, origin) => {
  const headers = new Headers(upstreamHeaders);
  const loc = headers.get('Location');
  if (!loc) return headers;
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

export default {
  /**
   * @param {Request} request
   * @param {{ UPSTREAM?: string } | undefined} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstream = env?.UPSTREAM ?? DEFAULT_UPSTREAM;
    const mapped = mapPath(url.pathname);

    if (mapped.kind === 'redirect') {
      return Response.redirect(url.origin + mapped.path + url.search, 301);
    }

    const target = new URL(mapped.path + url.search, upstream);

    const proxyReq = new Request(target, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'manual',
    });

    const response = await fetch(proxyReq);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: rewriteLocation(response.headers, target, url.origin),
    });
  },
};
