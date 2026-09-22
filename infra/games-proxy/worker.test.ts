import { describe, expect, test, vi } from 'vitest';

import worker, { DEFAULT_UPSTREAM, type Env, mapPath, unmapPath } from './worker.ts';

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
  ])('%s is fetched from upstream %s', (pathname, upstreamPath) => {
    expect(mapPath(pathname)).toEqual({ kind: 'fetch', path: upstreamPath });
  });

  test.each([
    ['/games/gin-rummy/', '/gin-rummy/'],
    ['/games/gin-rummy', '/gin-rummy'],
    ['/games/fidice/app.js', '/fidice/app.js'],
    ['/games/', '/'],
  ])('%s redirects to %s on this origin', (pathname, shortPath) => {
    expect(mapPath(pathname)).toEqual({ kind: 'redirect', path: shortPath });
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

  test('/shared/ice.js reaches the shared directory, not games/shared', () =>
    withUpstream(upstreamEcho, async () => {
      expect(await (await get('/shared/ice.js')).text()).toBe(
        `${GH}/hyperagent-web-apps/shared/ice.js`,
      );
    }));

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
