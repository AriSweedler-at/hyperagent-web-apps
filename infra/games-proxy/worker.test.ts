import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  ALIASES as REGISTRY_ALIASES,
  LANDING_HREFS,
  LANDING_PAGES,
  SHELL_GAMES,
  TOOL_NAMES,
} from '../../tools/games.ts';
import { AASA_PATH as CLIP_AASA_PATH } from '../../web/shared/lib/appClip.ts';
import { JOIN_PARAM as INVITE_PARAM } from '../../web/shared/lib/invite.ts';
import { ROOM_CODE } from '../../web/shared/lib/roomCode.ts';
import worker, {
  AASA_PATH,
  ALIASES,
  DEFAULT_UPSTREAM,
  type Env,
  JOIN_PARAM,
  joinCode,
  joinPreview,
  mapPath,
  metaContent,
  shortHref,
  shortenLandingLinks,
  unmapPath,
} from './worker.ts';

const ORIGIN = 'https://games.sweedler.com';
const GH = 'https://arisweedler-at.github.io';

/** A stand-in upstream: the Worker always hands `fetch` a Request, never a bare URL. */
type Upstream = (req: Request) => Response;

/** Run fn with the global fetch (the only side effect the Worker has) replaced by handler. */
const withUpstream = async <T>(handler: Upstream, fn: () => Promise<T>): Promise<T> => {
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input) =>
      Promise.resolve(handler(input instanceof Request ? input : new Request(input))),
    );
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
};
const upstreamEcho: Upstream = (req) => new Response(req.url, { status: 200 });
const noUpstream: Upstream = () => {
  throw new Error('no upstream call expected');
};
const get = (path: string, env?: Env): Promise<Response> =>
  worker.fetch(new Request(ORIGIN + path), env);

describe('mapPath: the mapping table in the file header', () => {
  test.each([
    ['/', '/hyperagent-web-apps/'],
    ['', '/hyperagent-web-apps/'],
    ['/gin-rummy', '/hyperagent-web-apps/games/gin-rummy'],
    ['/gin-rummy/', '/hyperagent-web-apps/games/gin-rummy/'],
    ['/fidice/app-abc123.js', '/hyperagent-web-apps/games/fidice/app-abc123.js'],
    // An alias is served in place: the page and its assets come from the game's folder.
    ['/sheshbesh/', '/hyperagent-web-apps/games/backgammon/'],
    ['/sheshbesh/app-abc123.js', '/hyperagent-web-apps/games/backgammon/app-abc123.js'],
    ['/sheshbesh/deep/er/file.js', '/hyperagent-web-apps/games/backgammon/deep/er/file.js'],
    // The installable manifest and its icons (tools/icons.ts) ride the game's folder, under the
    // game's name and its alias alike: `./`-relative in the head and in the manifest itself.
    [
      '/backgammon/manifest.webmanifest',
      '/hyperagent-web-apps/games/backgammon/manifest.webmanifest',
    ],
    ['/backgammon/icons/icon-192.png', '/hyperagent-web-apps/games/backgammon/icons/icon-192.png'],
    [
      '/sheshbesh/manifest.webmanifest',
      '/hyperagent-web-apps/games/backgammon/manifest.webmanifest',
    ],
    [
      '/sheshbesh/icons/maskable-512.png',
      '/hyperagent-web-apps/games/backgammon/icons/maskable-512.png',
    ],
    // Only the whole first segment is an alias.
    ['/sheshbeshx/', '/hyperagent-web-apps/games/sheshbeshx/'],
    ['/shesh/', '/hyperagent-web-apps/games/shesh/'],
    ['/shared/ice.js', '/hyperagent-web-apps/shared/ice.js'],
    ['/shared/assets/chunk-1.js', '/hyperagent-web-apps/shared/assets/chunk-1.js'],
    ['/hyperagent-web-apps/', '/hyperagent-web-apps/'],
    ['/hyperagent-web-apps/games/fidice/', '/hyperagent-web-apps/games/fidice/'],
    ['/hyperagent-web-apps/shared/ice.js', '/hyperagent-web-apps/shared/ice.js'],
    // Only slash-terminated prefixes are special; these quirks are preserved on purpose.
    ['/games', '/hyperagent-web-apps/games/games'],
    ['/shared', '/hyperagent-web-apps/games/shared'],
    ['/hyperagent-web-apps', '/hyperagent-web-apps/games/hyperagent-web-apps'],
    ['/favicon.ico', '/hyperagent-web-apps/shared/favicon.ico'],
    // The well-known directory is the tree's own (web/public/.well-known/): Apple's association
    // file for the Dice App Clip, and whatever else RFC 8615 brings.
    [
      '/.well-known/apple-app-site-association',
      '/hyperagent-web-apps/.well-known/apple-app-site-association',
    ],
    ['/.well-known/other', '/hyperagent-web-apps/.well-known/other'],
    // Without its slash the dot-directory is a game name like any other (the quirk above).
    ['/.well-known', '/hyperagent-web-apps/games/.well-known'],
  ])('%s is fetched from upstream %s', (pathname, upstreamPath) => {
    expect(mapPath(pathname)).toEqual({ kind: 'fetch', path: upstreamPath });
  });

  test.each([
    ['/games/gin-rummy/', '/gin-rummy/'],
    ['/games/gin-rummy', '/gin-rummy'],
    ['/games/fidice/app.js', '/fidice/app.js'],
    ['/games/', '/'],
    // /ALIAS without its slash is redirected here, not fetched: the upstream's slash redirect would
    // come back as /hyperagent-web-apps/games/backgammon/ and unmapPath would send the player to
    // /backgammon/. /games/ALIAS is a landing-style link like any other.
    ['/sheshbesh', '/sheshbesh/'],
    ['/games/sheshbesh/', '/sheshbesh/'],
    ['/games/sheshbesh', '/sheshbesh'],
  ])('%s redirects to %s on this origin', (pathname, shortPath) => {
    expect(mapPath(pathname)).toEqual({ kind: 'redirect', path: shortPath });
  });

  test('AASA_PATH is the path web/shared/lib/appClip.ts spells for the site', () => {
    expect(AASA_PATH).toBe(CLIP_AASA_PATH);
    expect(mapPath(AASA_PATH)).toEqual({ kind: 'fetch', path: `/hyperagent-web-apps${AASA_PATH}` });
  });

  test('ALIASES is the map tools/games.ts spells for the Pages origin', () => {
    expect(ALIASES).toEqual(REGISTRY_ALIASES);
    expect(ALIASES).toEqual({ sheshbesh: 'backgammon' });
  });
});

describe('unmapPath: upstream pathname back to this origin', () => {
  test.each([
    ['/hyperagent-web-apps/games/gin-rummy/', '/gin-rummy/'],
    ['/hyperagent-web-apps/games/', '/'],
    ['/hyperagent-web-apps/', '/'],
    ['/hyperagent-web-apps/shared/ice.js', '/shared/ice.js'],
    ['/hyperagent-web-apps', '/hyperagent-web-apps'],
    ['/elsewhere', '/elsewhere'],
  ])('%s becomes %s', (upstreamPath, shortPath) => {
    expect(unmapPath(upstreamPath)).toBe(shortPath);
  });

  test('a pathname without a leading slash gets one (URL never produces this; kept from the original)', () => {
    expect(unmapPath('relative/path')).toBe('/relative/path');
  });

  test.each(['/', '/gin-rummy/', '/fidice/app.js', '/shared/ice.js'])(
    'round-trips %s through mapPath',
    (pathname) => {
      const mapped = mapPath(pathname);
      expect(mapped.kind).toBe('fetch');
      expect(unmapPath(mapped.path)).toBe(pathname);
    },
  );

  test('knows no alias: the game path an alias fetched comes back as the game, so an alias never round-trips', () => {
    const mapped = mapPath('/sheshbesh/');
    expect(mapped.kind).toBe('fetch');
    expect(unmapPath(mapped.path)).toBe('/backgammon/');
    expect(unmapPath('/hyperagent-web-apps/games/backgammon/')).toBe('/backgammon/');
  });
});

describe('fetch handler', () => {
  test('/ serves the Pages site root', () =>
    withUpstream(upstreamEcho, async () => {
      expect(await (await get('/')).text()).toBe(`${GH}/hyperagent-web-apps/`);
    }));

  test('/XXX/ serves games/XXX/', () =>
    withUpstream(upstreamEcho, async () => {
      expect(await (await get('/gin-rummy/')).text()).toBe(
        `${GH}/hyperagent-web-apps/games/gin-rummy/`,
      );
    }));

  test('/games/XXX/ redirects to the short URL without calling upstream', () =>
    withUpstream(noUpstream, async () => {
      const res = await get('/games/gin-rummy/?v=1');
      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(`${ORIGIN}/gin-rummy/?v=1`);
    }));

  test('/ALIAS/ serves the game page in place, query and all, and its assets from the game folder', () =>
    withUpstream(upstreamEcho, async () => {
      expect(await (await get('/sheshbesh/?join=ABCD')).text()).toBe(
        `${GH}/hyperagent-web-apps/games/backgammon/?join=ABCD`,
      );
      expect(await (await get('/sheshbesh/app-abc.js')).text()).toBe(
        `${GH}/hyperagent-web-apps/games/backgammon/app-abc.js`,
      );
    }));

  test('/ALIAS without its slash redirects to /ALIAS/ on this origin, keeping the query, without calling upstream', () =>
    withUpstream(noUpstream, async () => {
      const res = await get('/sheshbesh?join=ABCD');
      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(`${ORIGIN}/sheshbesh/?join=ABCD`);
    }));

  test('/games/ALIAS/ redirects to /ALIAS/ like every landing-style link', () =>
    withUpstream(noUpstream, async () => {
      const res = await get('/games/sheshbesh/');
      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(`${ORIGIN}/sheshbesh/`);
    }));

  test('/shared/ice.js reaches the shared directory, not games/shared', () =>
    withUpstream(upstreamEcho, async () => {
      expect(await (await get('/shared/ice.js')).text()).toBe(
        `${GH}/hyperagent-web-apps/shared/ice.js`,
      );
    }));

  test('the AASA comes back as application/json whatever the upstream said; a miss keeps its type', () =>
    withUpstream(
      (req) =>
        new Request(req).url.endsWith(AASA_PATH)
          ? new Response('{"appclips":{"apps":[]}}', {
              status: 200,
              headers: { 'content-type': 'application/octet-stream' },
            })
          : new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } }),
      async () => {
        const hit = await get(AASA_PATH);
        expect(hit.status).toBe(200);
        expect(hit.headers.get('content-type')).toBe('application/json');
        expect(await hit.text()).toBe('{"appclips":{"apps":[]}}');
        const miss = await get('/.well-known/other');
        expect(miss.status).toBe(404);
        expect(miss.headers.get('content-type')).toBe('text/plain');
      },
    ));

  test('a 404 for the AASA keeps the upstream type: nothing is stamped on a miss', () =>
    withUpstream(
      () => new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } }),
      async () => {
        const miss = await get(AASA_PATH);
        expect(miss.status).toBe(404);
        expect(miss.headers.get('content-type')).toBe('text/plain');
      },
    ));

  test('/hyperagent-web-apps/… passes through', () =>
    withUpstream(upstreamEcho, async () => {
      expect(await (await get('/hyperagent-web-apps/games/fidice/')).text()).toBe(
        `${GH}/hyperagent-web-apps/games/fidice/`,
      );
    }));

  test('upstream trailing-slash redirect is rewritten back to this origin', () =>
    withUpstream(
      () =>
        new Response(null, {
          status: 301,
          headers: { Location: `${GH}/hyperagent-web-apps/games/gin-rummy/` },
        }),
      async () => {
        const res = await get('/gin-rummy');
        expect(res.status).toBe(301);
        expect(res.headers.get('Location')).toBe(`${ORIGIN}/gin-rummy/`);
      },
    ));

  test('the query string is forwarded to upstream', () =>
    withUpstream(upstreamEcho, async () => {
      expect(await (await get('/fidice/?room=abc&x=1')).text()).toBe(
        `${GH}/hyperagent-web-apps/games/fidice/?room=abc&x=1`,
      );
    }));

  test('without env the upstream is GitHub Pages', () =>
    withUpstream(upstreamEcho, async () => {
      expect(DEFAULT_UPSTREAM).toBe(GH);
      expect(await (await get('/', undefined)).text()).toBe(`${GH}/hyperagent-web-apps/`);
      expect(await (await get('/', {})).text()).toBe(`${GH}/hyperagent-web-apps/`);
    }));

  test('env.UPSTREAM replaces the upstream origin (tools/proxy-dev.ts fronting a dist server)', () =>
    withUpstream(upstreamEcho, async () => {
      const env = { UPSTREAM: 'http://127.0.0.1:4173' };
      expect(await (await get('/gin-rummy/', env)).text()).toBe(
        'http://127.0.0.1:4173/hyperagent-web-apps/games/gin-rummy/',
      );
      expect(await (await get('/shared/ice.js', env)).text()).toBe(
        'http://127.0.0.1:4173/hyperagent-web-apps/shared/ice.js',
      );
    }));

  test('a redirect from a custom upstream host is rewritten too', () =>
    withUpstream(
      () =>
        new Response(null, {
          status: 301,
          headers: { Location: 'http://127.0.0.1:4173/hyperagent-web-apps/games/fidice/' },
        }),
      async () => {
        const res = await get('/fidice', { UPSTREAM: 'http://127.0.0.1:4173' });
        expect(res.headers.get('Location')).toBe(`${ORIGIN}/fidice/`);
      },
    ));

  test('a relative upstream Location resolves against the fetched target', () =>
    withUpstream(
      () => new Response(null, { status: 302, headers: { Location: 'gin-rummy/' } }),
      async () => {
        const res = await get('/gin-rummy');
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe(`${ORIGIN}/gin-rummy/`);
      },
    ));

  test('an upstream Location outside games/ maps to the root form and keeps its query', () =>
    withUpstream(
      () =>
        new Response(null, {
          status: 301,
          headers: { Location: `${GH}/hyperagent-web-apps/shared/?a=1` },
        }),
      async () => {
        const res = await get('/shared');
        expect(res.headers.get('Location')).toBe(`${ORIGIN}/shared/?a=1`);
      },
    ));

  test('a Location on another host passes through unchanged', () =>
    withUpstream(
      () => new Response(null, { status: 302, headers: { Location: 'https://example.com/x?y=1' } }),
      async () => {
        const res = await get('/gin-rummy/');
        expect(res.headers.get('Location')).toBe('https://example.com/x?y=1');
      },
    ));

  test('status, statusText and other headers pass through', () =>
    withUpstream(
      () =>
        new Response('missing', {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'text/plain', 'x-upstream': 'yes' },
        }),
      async () => {
        const res = await get('/nope/');
        expect(res.status).toBe(404);
        expect(res.statusText).toBe('Not Found');
        expect(res.headers.get('content-type')).toBe('text/plain');
        expect(res.headers.get('x-upstream')).toBe('yes');
        expect(await res.text()).toBe('missing');
      },
    ));

  test('method and request headers are forwarded; GET carries no body and follows no redirects', () =>
    withUpstream(
      (req) => {
        expect(req.method).toBe('GET');
        expect(req.headers.get('x-test')).toBe('hello');
        expect(req.body).toBeNull();
        expect(req.redirect).toBe('manual');
        return new Response('ok');
      },
      async () => {
        const res = await worker.fetch(
          new Request(`${ORIGIN}/gin-rummy/`, { headers: { 'x-test': 'hello' } }),
        );
        expect(await res.text()).toBe('ok');
      },
    ));

  test('HEAD is forwarded as HEAD without a body', () =>
    withUpstream(
      (req) => {
        expect(req.method).toBe('HEAD');
        expect(req.body).toBeNull();
        return new Response(null, { status: 200, headers: { 'content-length': '12' } });
      },
      async () => {
        const res = await worker.fetch(new Request(`${ORIGIN}/fidice/`, { method: 'HEAD' }));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('12');
      },
    ));
});

// ---- Link previews (docs/design/link-previews.md §3) ----------------------------------------

/** A page as tools/shell-markup.ts composes it: one meta per line, property/name before content. */
const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta property="og:title" content="Sheshbesh" />
    <meta property="og:description" content="Backgammon the Sephardic way." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://games.sweedler.com/backgammon/" />
    <meta property="og:image" content="https://games.sweedler.com/backgammon/splash.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Sheshbesh" />
    <meta name="twitter:description" content="Backgammon the Sephardic way." />
    <title>Sheshbesh — backgammon</title>
  </head>
  <body>
    <div id="app">og:title is not a tag here</div>
  </body>
</html>
`;
const INVITE = 'https://games.sweedler.com/backgammon/?join=TNJQ';

/** PAGE with its five preview tags rewritten for TNJQ, spelled out. */
const PREVIEWED = PAGE.replace(
  '<meta property="og:title" content="Sheshbesh" />',
  '<meta property="og:title" content="Join Sheshbesh: code TNJQ" />',
)
  .replace(
    '<meta property="og:description" content="Backgammon the Sephardic way." />',
    `<meta property="og:description" content="You're invited to Sheshbesh. Open the link to sit down; the room code is TNJQ." />`,
  )
  .replace(
    '<meta property="og:url" content="https://games.sweedler.com/backgammon/" />',
    `<meta property="og:url" content="${INVITE}" />`,
  )
  .replace(
    '<meta name="twitter:title" content="Sheshbesh" />',
    '<meta name="twitter:title" content="Join Sheshbesh: code TNJQ" />',
  )
  .replace(
    '<meta name="twitter:description" content="Backgammon the Sephardic way." />',
    `<meta name="twitter:description" content="You're invited to Sheshbesh. Open the link to sit down; the room code is TNJQ." />`,
  );

const htmlUpstream: Upstream = () =>
  new Response(PAGE, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(PAGE.length),
      'content-encoding': 'identity',
      etag: '"page-1"',
    },
  });

describe('joinCode: the invite code in ?join=, when it has a room code shape', () => {
  test('is web/shared/lib/invite.ts JOIN_PARAM', () => {
    expect(JOIN_PARAM).toBe(INVITE_PARAM);
  });

  test.each([
    ['?join=TNJQ', 'TNJQ'],
    ['?join=tnjq', 'tnjq'],
    ['?join=AB3D9', 'AB3D9'],
    ['?peer=x&join=TNJQ&ice=y', 'TNJQ'],
  ])('%s carries %s', (query, code) => {
    expect(joinCode(new URL(ORIGIN + '/gin-rummy/' + query))).toBe(code);
  });

  test.each([
    '',
    '?',
    '?join=',
    '?join=ABC',
    '?join=ABCDEF',
    '?join=AB-D',
    '?join=A%20BC',
    '?room=TNJQ',
  ])('%s carries none', (query) => {
    expect(joinCode(new URL(ORIGIN + '/gin-rummy/' + query))).toBeUndefined();
  });

  test("every game's room codes fit the shape (web/shared/lib/roomCode.ts), six characters do not", () => {
    Object.values(ROOM_CODE).forEach(({ alphabet, length }) => {
      const first = alphabet[0] ?? '';
      const last = alphabet[alphabet.length - 1] ?? '';
      expect(joinCode(new URL(`${ORIGIN}/x/?join=${first.repeat(length)}`))).toBe(
        first.repeat(length),
      );
      expect(joinCode(new URL(`${ORIGIN}/x/?join=${last.repeat(length)}`))).toBe(
        last.repeat(length),
      );
      // The shape is one regex for every game (four or five), so six is the first length it refuses.
      expect(joinCode(new URL(`${ORIGIN}/x/?join=${first.repeat(6)}`))).toBeUndefined();
    });
  });
});

describe('joinPreview: the code in the Open Graph head', () => {
  test('rewrites the two titles, the two descriptions and og:url; nothing else moves', () => {
    expect(joinPreview(PAGE, 'TNJQ', INVITE)).toBe(PREVIEWED);
  });

  test('metaContent reads a property or a name; a tag the page lacks is undefined', () => {
    expect(metaContent(PAGE, 'og:title')).toBe('Sheshbesh');
    expect(metaContent(PAGE, 'twitter:card')).toBe('summary_large_image');
    expect(metaContent(PAGE, 'og:image:alt')).toBeUndefined();
    expect(metaContent(PREVIEWED, 'og:title')).toBe('Join Sheshbesh: code TNJQ');
  });

  test('the title stays the page name, the image the game splash', () => {
    const previewed = joinPreview(PAGE, 'TNJQ', INVITE);
    expect(previewed).toContain('<title>Sheshbesh — backgammon</title>');
    expect(metaContent(previewed, 'og:image')).toBe(
      'https://games.sweedler.com/backgammon/splash.png',
    );
  });

  test('a page without an og:title comes back untouched', () => {
    const bare = '<!doctype html><html><head><title>x</title></head><body></body></html>';
    expect(joinPreview(bare, 'TNJQ', INVITE)).toBe(bare);
  });

  test('a page with an og:title but no other preview tags gains none: only what it has is rewritten', () => {
    const one = '<head><meta property="og:title" content="Fidice" /></head>';
    expect(joinPreview(one, 'AB3D9', INVITE)).toBe(
      '<head><meta property="og:title" content="Join Fidice: code AB3D9" /></head>',
    );
  });

  test('attribute characters in the invite URL are escaped', () => {
    const previewed = joinPreview(PAGE, 'TNJQ', 'https://x.test/?a=1&b="<2>"');
    expect(previewed).toContain(
      '<meta property="og:url" content="https://x.test/?a=1&amp;b=&quot;&lt;2&gt;&quot;" />',
    );
  });

  test("gin's page, spelled without self-closing slashes, is rewritten the same way", () => {
    const gin =
      '<meta property="og:title" content="Gin Rummy">\n<meta name="twitter:title" content="Gin Rummy">';
    expect(joinPreview(gin, 'TQBF', INVITE)).toBe(
      '<meta property="og:title" content="Join Gin Rummy: code TQBF">\n<meta name="twitter:title" content="Join Gin Rummy: code TQBF">',
    );
  });

  test('every committed shell page has the five tags the rewrite names, and its og:title is the game', () => {
    SHELL_GAMES.forEach((game) => {
      const page = readFileSync(
        resolve(import.meta.dirname, '../../web/games', game, 'index.html'),
        'utf8',
      );
      const name = metaContent(page, 'og:title') ?? '';
      expect(name, game).not.toBe('');
      const previewed = joinPreview(page, 'TNJQ', INVITE);
      expect(metaContent(previewed, 'og:title')).toBe(`Join ${name}: code TNJQ`);
      expect(metaContent(previewed, 'twitter:title')).toBe(`Join ${name}: code TNJQ`);
      expect(metaContent(previewed, 'og:description')).toContain('TNJQ');
      expect(metaContent(previewed, 'twitter:description')).toContain('TNJQ');
      expect(metaContent(previewed, 'og:url')).toBe(INVITE);
      expect(metaContent(previewed, 'og:image')).toBe(
        `https://games.sweedler.com/${game}/splash.png`,
      );
    });
  });
});

describe('fetch handler: link previews', () => {
  test('a GET for a page with ?join=CODE gets the rewritten head; length and encoding go, the rest of the headers stay', () =>
    withUpstream(htmlUpstream, async () => {
      const res = await get('/backgammon/?join=TNJQ');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(PREVIEWED);
      expect(res.headers.get('content-length')).toBeNull();
      expect(res.headers.get('content-encoding')).toBeNull();
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('etag')).toBe('"page-1"');
    }));

  test('the invite in og:url is this origin, the requested path and the code alone (an alias keeps its name; the harness hooks are dropped)', () =>
    withUpstream(htmlUpstream, async () => {
      const alias = await (await get('/sheshbesh/?peer=abc&join=TNJQ&ice=x')).text();
      expect(metaContent(alias, 'og:url')).toBe(`${ORIGIN}/sheshbesh/?join=TNJQ`);
      expect(metaContent(alias, 'og:title')).toBe('Join Sheshbesh: code TNJQ');
    }));

  test('the query still reaches upstream whole', () =>
    withUpstream(
      (req) => {
        expect(new URL(req.url).search).toBe('?peer=abc&join=TNJQ');
        return htmlUpstream(req);
      },
      async () => {
        expect((await get('/backgammon/?peer=abc&join=TNJQ')).status).toBe(200);
      },
    ));

  test.each([
    ['no code', '/backgammon/'],
    ['a code of the wrong shape', '/backgammon/?join=TNJ'],
    ['another parameter', '/backgammon/?room=TNJQ'],
  ])('a page under %s streams through untouched, length and all', (_why, path) =>
    withUpstream(htmlUpstream, async () => {
      const res = await get(path);
      expect(await res.text()).toBe(PAGE);
      expect(res.headers.get('content-length')).toBe(String(PAGE.length));
      expect(res.headers.get('content-encoding')).toBe('identity');
    }),
  );

  test('a non-HTML response under ?join= is untouched (the page requests its script with the query intact)', () =>
    withUpstream(
      () =>
        new Response('export {};', {
          status: 200,
          headers: { 'content-type': 'text/javascript', 'content-length': '10' },
        }),
      async () => {
        const res = await get('/backgammon/app-abc.js?join=TNJQ');
        expect(await res.text()).toBe('export {};');
        expect(res.headers.get('content-length')).toBe('10');
      },
    ));

  test('an upstream error page under ?join= is untouched', () =>
    withUpstream(
      () =>
        new Response(PAGE, {
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '5' },
        }),
      async () => {
        const res = await get('/nope/?join=TNJQ');
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(PAGE);
        expect(res.headers.get('content-length')).toBe('5');
      },
    ));

  test('HEAD under ?join= passes through with its length: there is no body to rewrite', () =>
    withUpstream(
      () =>
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '77' },
        }),
      async () => {
        const res = await worker.fetch(
          new Request(`${ORIGIN}/backgammon/?join=TNJQ`, { method: 'HEAD' }),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('77');
      },
    ));
});

// ---- Landing links ---------------------------------------------------------------------------

describe('shortHref: a landing href to the short URL on this origin', () => {
  test.each([
    ['games/gin-rummy/', '/gin-rummy/'],
    ['games/fidice/', '/fidice/'],
    ['games/backgammon/', '/backgammon/'],
    ['games/briscola/', '/briscola/'],
    // The alias: the Worker serves /sheshbesh/ in place.
    ['games/sheshbesh/', '/sheshbesh/'],
    // The other spellings of the same folder.
    ['./games/gin-rummy/', '/gin-rummy/'],
    ['/games/gin-rummy/', '/gin-rummy/'],
    ['/hyperagent-web-apps/games/gin-rummy/', '/gin-rummy/'],
    // Without the slash (the upstream's slash redirect then lands on /<name>/: one hop, no /games/
    // in it), with a query, a fragment, a file.
    ['games/gin-rummy', '/gin-rummy'],
    ['games/gin-rummy/?join=TNJQ', '/gin-rummy/?join=TNJQ'],
    ['games/gin-rummy/#rules', '/gin-rummy/#rules'],
    ['games/backgammon/splash.png', '/backgammon/splash.png'],
    // games/ alone is the landing page itself, as /games/ redirects to /.
    ['games/', '/'],
  ])('%s -> %s', (href, short) => {
    expect(shortHref(href)).toBe(short);
  });

  test.each([
    'shared/favicon.svg',
    './shared/favicon.ico',
    '/shared/ice.js',
    'https://github.com/AriSweedler-at/hyperagent-web-apps',
    // An absolute URL names its origin on purpose.
    'https://arisweedler-at.github.io/hyperagent-web-apps/games/gin-rummy/',
    '#top',
    'mailto:ari@example.com',
    '',
    'games',
    'gamesx/gin-rummy/',
    'my-games/gin-rummy/',
    '../games/gin-rummy/',
  ])('%s is not under games/ and stays as it is', (href) => {
    expect(shortHref(href)).toBe(href);
  });

  test('every landing card is shortened to the path /games/<name>/ redirects to: the redirect, done ahead of the click', () => {
    LANDING_HREFS.forEach((href) => {
      const mapped = mapPath(`/${href}`);
      expect(mapped.kind, href).toBe('redirect');
      expect(shortHref(href), href).toBe(mapped.path);
    });
    expect(LANDING_HREFS.map(shortHref)).toEqual(LANDING_PAGES.map((page) => `/${page}/`));
  });
});

describe('shortenLandingLinks: the committed landing page (web/index.html)', () => {
  const landing = readFileSync(resolve(import.meta.dirname, '../../web/index.html'), 'utf8');
  const hrefsIn = (html: string): ReadonlyArray<string> =>
    [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '');

  test('rewrites exactly the card hrefs, `games/` to `/`; every other byte stays', () => {
    expect(shortenLandingLinks(landing)).toBe(landing.replaceAll('href="games/', 'href="/'));
    expect(shortenLandingLinks(landing)).not.toBe(landing);
  });

  test('the cards then point at the short URLs in registry order; the icons and the source link are untouched', () => {
    const before = hrefsIn(landing);
    const after = hrefsIn(shortenLandingLinks(landing));
    // The cards (the games, then the solo pages), then the landing page's tools line (tools/games.ts TOOLS: UI Sandbox).
    expect(after.filter((href) => href.startsWith('/'))).toEqual([
      ...LANDING_PAGES.map((page) => `/${page}/`),
      ...TOOL_NAMES.map((tool) => `/${tool}/`),
    ]);
    expect(after.filter((href) => !href.startsWith('/'))).toEqual(
      before.filter((href) => !href.startsWith('games/')),
    );
  });
});

/** A landing page as web/index.html spells it: relative cards, the alias, the icon, an outside link, and the other spellings. */
const LANDING_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<link rel="icon" href="./shared/favicon.svg" type="image/svg+xml">
</head>
<body>
<a class="card" href="games/gin-rummy/">Gin Rummy</a>
<a class="card" href="games/fidice/">Fidice</a>
<a class="card" href="games/backgammon/">Sheshbesh</a>
<a class="card" href="games/briscola/">Briscola</a>
<a href="games/sheshbesh/">the alias</a>
<a href="/games/gin-rummy">rooted, no slash</a>
<a href="/hyperagent-web-apps/games/gin-rummy/?join=TNJQ">the long form</a>
<a href="shared/README.md">not a game</a>
<a href="https://github.com/AriSweedler-at/hyperagent-web-apps">source</a>
</body>
</html>
`;
/** LANDING_PAGE as this origin serves it, spelled out. */
const SHORTENED = `<!DOCTYPE html>
<html lang="en">
<head>
<link rel="icon" href="./shared/favicon.svg" type="image/svg+xml">
</head>
<body>
<a class="card" href="/gin-rummy/">Gin Rummy</a>
<a class="card" href="/fidice/">Fidice</a>
<a class="card" href="/backgammon/">Sheshbesh</a>
<a class="card" href="/briscola/">Briscola</a>
<a href="/sheshbesh/">the alias</a>
<a href="/gin-rummy">rooted, no slash</a>
<a href="/gin-rummy/?join=TNJQ">the long form</a>
<a href="shared/README.md">not a game</a>
<a href="https://github.com/AriSweedler-at/hyperagent-web-apps">source</a>
</body>
</html>
`;
/** A game page's own links: relative to it, and none of the Worker's business. */
const GAME_PAGE = '<a href="../">back to the games</a> <a href="games/odd/">relative, odd</a>';

const pageUpstream =
  (html: string): Upstream =>
  () =>
    new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(html.length),
        'content-encoding': 'identity',
        etag: '"page-2"',
      },
    });

describe('fetch handler: landing links', () => {
  test('GET / serves the landing page with its links short; length and encoding go, the rest of the headers stay', () =>
    withUpstream(pageUpstream(LANDING_PAGE), async () => {
      const res = await get('/');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(SHORTENED);
      expect(res.headers.get('content-length')).toBeNull();
      expect(res.headers.get('content-encoding')).toBeNull();
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('etag')).toBe('"page-2"');
    }));

  test('the long form of the landing page, /hyperagent-web-apps/, is rewritten the same way', () =>
    withUpstream(pageUpstream(LANDING_PAGE), async () => {
      expect(await (await get('/hyperagent-web-apps/')).text()).toBe(SHORTENED);
    }));

  test('the landing page is fetched from upstream as before: the rewrite is on the way back', () =>
    withUpstream(
      (req) => {
        expect(req.url).toBe(`${GH}/hyperagent-web-apps/`);
        return pageUpstream(LANDING_PAGE)(req);
      },
      async () => {
        expect((await get('/')).status).toBe(200);
      },
    ));

  test.each(['/backgammon/', '/sheshbesh/', '/gin-rummy/'])(
    'a game page at %s is not touched: its relative links are its own, length and all',
    (path) =>
      withUpstream(pageUpstream(GAME_PAGE), async () => {
        const res = await get(path);
        expect(await res.text()).toBe(GAME_PAGE);
        expect(res.headers.get('content-length')).toBe(String(GAME_PAGE.length));
        expect(res.headers.get('content-encoding')).toBe('identity');
      }),
  );

  test.each([
    ['/games/briscola/', '/briscola/'],
    ['/games/gin-rummy', '/gin-rummy'],
    ['/games/sheshbesh/', '/sheshbesh/'],
  ])('%s still redirects to %s, for the links already out there', (path, short) =>
    withUpstream(noUpstream, async () => {
      const res = await get(path);
      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(`${ORIGIN}${short}`);
    }),
  );

  test('HEAD / passes through with its length: there is no body to rewrite', () =>
    withUpstream(
      () =>
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '77' },
        }),
      async () => {
        const res = await worker.fetch(new Request(`${ORIGIN}/`, { method: 'HEAD' }));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('77');
      },
    ));

  test('an upstream error for / is untouched', () =>
    withUpstream(
      () =>
        new Response(LANDING_PAGE, {
          status: 503,
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '9' },
        }),
      async () => {
        const res = await get('/');
        expect(res.status).toBe(503);
        expect(await res.text()).toBe(LANDING_PAGE);
        expect(res.headers.get('content-length')).toBe('9');
      },
    ));
});

describe('the island scoreboard routes ride the Worker (rps-push.ts; its own tests cover the routes)', () => {
  /** A Map-backed RPS_PAIRS binding, enough for the routing rows. */
  const memoryStore = (): NonNullable<Env['RPS_PAIRS']> => {
    const rows = new Map<string, string>();
    return {
      get: (key) => Promise.resolve(rows.get(key) ?? null),
      put: (key, value) => {
        rows.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        rows.delete(key);
        return Promise.resolve();
      },
    };
  };
  const configured: Env = {
    RPS_PAIRS: memoryStore(),
    APNS_TEAM_ID: 'TEAM123456',
    APNS_KEY_ID: 'KEY1234567',
    APNS_AUTH_KEY: 'unused: no push is sent by these rows',
  };

  test('/api/rps/* never reaches the upstream: 503 without the bindings, whatever the method', () =>
    withUpstream(noUpstream, async () => {
      const pair = await worker.fetch(
        new Request(`${ORIGIN}/api/rps/pair`, { method: 'POST', body: '{}' }),
      );
      expect(pair.status).toBe(503);
      expect(await pair.json()).toEqual({ error: 'island pushes not configured' });
      expect(
        (await get('/api/rps/pair/abcd1234', { UPSTREAM: 'http://127.0.0.1:4173' })).status,
      ).toBe(503);
      expect((await get('/api/rps/mood')).status).toBe(503);
    }));

  test('with the bindings the routes answer: a pair is taken and paired flips; a mood for an unknown session is 404', () =>
    withUpstream(noUpstream, async () => {
      expect(await (await get('/api/rps/pair/abcd1234', configured)).json()).toEqual({
        paired: false,
      });
      const pair = await worker.fetch(
        new Request(`${ORIGIN}/api/rps/pair`, {
          method: 'POST',
          body: JSON.stringify({
            session: 'abcd1234',
            token: 'a'.repeat(64),
            bundle: 'com.sweedler.games.dice.Clip',
          }),
        }),
        configured,
      );
      expect(pair.status).toBe(204);
      const paired = await get('/api/rps/pair/abcd1234', configured);
      expect(paired.status).toBe(200);
      expect(await paired.json()).toEqual({ paired: true });
      const mood = await worker.fetch(
        new Request(`${ORIGIN}/api/rps/mood`, {
          method: 'POST',
          body: JSON.stringify({
            session: 'zzzz9999',
            counter: 0,
            prestige: 0,
            band: 'neutral',
            at: 1,
          }),
        }),
        configured,
      );
      expect(mood.status).toBe(404);
    }));

  test('the routes are same-origin: no CORS header; the proxy paths around them are untouched', () =>
    withUpstream(upstreamEcho, async () => {
      const paired = await get('/api/rps/pair/abcd1234', configured);
      expect(paired.headers.get('access-control-allow-origin')).toBeNull();
      // Only the /api/rps/ prefix is the Worker's: a neighbour is a game path like any other.
      expect(await (await get('/api/rpsx/pair')).text()).toBe(
        `${GH}/hyperagent-web-apps/games/api/rpsx/pair`,
      );
      expect(await (await get('/api/rps')).text()).toBe(`${GH}/hyperagent-web-apps/games/api/rps`);
    }));
});
