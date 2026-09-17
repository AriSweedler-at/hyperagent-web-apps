// tools/serve-dist.ts is the `pages` origin of the browser harness (docs/ARCHITECTURE.md "Two
// origins"); its routing is pure and pinned here, and one real listener proves the wire behaviour
// GitHub Pages has: directory index, slash redirect, 404 outside the mount, CORS on every response.
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { ICE_FIXTURE, PAGES_BASE_PATH } from '../../e2e/fixtures/site.ts';
import {
  contentTypeFor,
  parseServeArgs,
  routeFor,
  serveFor,
  startServer,
  type Running,
  type ServeOptions,
} from '../../tools/serve-dist.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const BASE = PAGES_BASE_PATH;
const ALIASES = { 'e2e-ice.json': 'e2e/fixtures/e2e-ice.json' } as const;
const options: ServeOptions = {
  root: REPO_ROOT,
  base: BASE,
  host: '127.0.0.1',
  port: 0,
  aliases: ALIASES,
};

describe('routeFor', () => {
  test('the mount point without its slash redirects to it', () => {
    expect(routeFor(BASE.slice(0, -1), BASE, {})).toEqual({ kind: 'redirect', location: BASE });
  });
  test('anything outside the mount is not found', () => {
    expect(routeFor('/', BASE, {})).toEqual({ kind: 'notFound' });
    expect(routeFor('/games/fidice/', BASE, {})).toEqual({ kind: 'notFound' });
  });
  test('the mount root is the directory itself with a trailing slash', () => {
    expect(routeFor(BASE, BASE, {})).toEqual({ kind: 'path', relPath: '.', trailingSlash: true });
  });
  test('directory and file paths keep whether they ended in a slash', () => {
    expect(routeFor(`${BASE}games/fidice/`, BASE, {})).toEqual({
      kind: 'path',
      relPath: 'games/fidice/',
      trailingSlash: true,
    });
    expect(routeFor(`${BASE}games/fidice`, BASE, {})).toEqual({
      kind: 'path',
      relPath: 'games/fidice',
      trailingSlash: false,
    });
    expect(routeFor(`${BASE}shared/ice.js`, BASE, {})).toEqual({
      kind: 'path',
      relPath: 'shared/ice.js',
      trailingSlash: false,
    });
  });
  test('an alias publishes a file under another path', () => {
    expect(routeFor(`${BASE}e2e-ice.json`, BASE, ALIASES)).toEqual({
      kind: 'path',
      relPath: 'e2e/fixtures/e2e-ice.json',
      trailingSlash: false,
    });
  });
  test('percent-encoding is decoded before matching', () => {
    expect(routeFor(`${BASE}games/gin%2Drummy/`, BASE, {})).toEqual({
      kind: 'path',
      relPath: 'games/gin-rummy/',
      trailingSlash: true,
    });
  });
  test('parent segments, encoded or not, and malformed escapes are refused', () => {
    expect(routeFor(`${BASE}../package.json`, BASE, {})).toEqual({ kind: 'notFound' });
    expect(routeFor(`${BASE}%2e%2e/package.json`, BASE, {})).toEqual({ kind: 'notFound' });
    expect(routeFor(`${BASE}games/%E0%A4%A`, BASE, {})).toEqual({ kind: 'notFound' });
    expect(routeFor(`${BASE}a%00b`, BASE, {})).toEqual({ kind: 'notFound' });
  });
});

describe('serveFor', () => {
  test('a directory with a slash serves its index.html', async () => {
    const served = await serveFor(
      options,
      `${BASE}games/gin-rummy/`,
      routeFor(`${BASE}games/gin-rummy/`, BASE, {}),
    );
    expect(served).toEqual({
      kind: 'file',
      path: resolve(REPO_ROOT, 'games/gin-rummy/index.html'),
    });
  });
  test('a directory without a slash redirects to the slash form', async () => {
    const served = await serveFor(
      options,
      `${BASE}games/gin-rummy`,
      routeFor(`${BASE}games/gin-rummy`, BASE, {}),
    );
    expect(served).toEqual({ kind: 'redirect', location: `${BASE}games/gin-rummy/` });
  });
  test('the mount root serves the landing page', async () => {
    expect(await serveFor(options, BASE, routeFor(BASE, BASE, {}))).toEqual({
      kind: 'file',
      path: resolve(REPO_ROOT, 'index.html'),
    });
  });
  test('a plain file is served as is', async () => {
    expect(
      await serveFor(options, `${BASE}shared/ice.js`, routeFor(`${BASE}shared/ice.js`, BASE, {})),
    ).toEqual({ kind: 'file', path: resolve(REPO_ROOT, 'shared/ice.js') });
  });
  test('an alias resolves to its target file', async () => {
    expect(
      await serveFor(
        options,
        `${BASE}e2e-ice.json`,
        routeFor(`${BASE}e2e-ice.json`, BASE, ALIASES),
      ),
    ).toEqual({ kind: 'file', path: resolve(REPO_ROOT, 'e2e/fixtures/e2e-ice.json') });
  });
  test('a missing file, or a directory without index.html, is not found', async () => {
    expect(await serveFor(options, `${BASE}nope.js`, routeFor(`${BASE}nope.js`, BASE, {}))).toEqual(
      { kind: 'notFound' },
    );
    expect(await serveFor(options, `${BASE}shared/`, routeFor(`${BASE}shared/`, BASE, {}))).toEqual(
      { kind: 'notFound' },
    );
  });
  test('redirect and not-found routes pass through untouched', async () => {
    expect(await serveFor(options, '/', { kind: 'notFound' })).toEqual({ kind: 'notFound' });
    expect(await serveFor(options, '/x', { kind: 'redirect', location: BASE })).toEqual({
      kind: 'redirect',
      location: BASE,
    });
  });
});

describe('contentTypeFor', () => {
  test.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['ice.js', 'text/javascript; charset=utf-8'],
    ['e2e-ice.json', 'application/json; charset=utf-8'],
    ['theme.CSS', 'text/css; charset=utf-8'],
    ['x.woff2', 'font/woff2'],
    ['unknown.bin', 'application/octet-stream'],
    ['noext', 'application/octet-stream'],
  ])('%s -> %s', (path, type) => {
    expect(contentTypeFor(path)).toBe(type);
  });
});

describe('parseServeArgs', () => {
  test('requires --base and applies the defaults', () => {
    expect(() => parseServeArgs([])).toThrow(/--base is required/);
    const parsed = parseServeArgs(['--base', BASE]);
    expect(parsed).toEqual({
      root: resolve('.'),
      base: BASE,
      host: '127.0.0.1',
      port: 4173,
      aliases: {},
    });
  });
  test('normalises the base to leading and trailing slashes', () => {
    expect(parseServeArgs(['--base', 'site']).base).toBe('/site/');
    expect(parseServeArgs(['--base', '/site']).base).toBe('/site/');
  });
  test('parses aliases, port, host and root', () => {
    const parsed = parseServeArgs([
      '--base',
      BASE,
      '--alias',
      'a.json=x/a.json',
      '--alias',
      'b=y',
      '--port',
      '0',
      '--host',
      '0.0.0.0',
      '--root',
      'games',
    ]);
    expect(parsed.aliases).toEqual({ 'a.json': 'x/a.json', b: 'y' });
    expect(parsed.port).toBe(0);
    expect(parsed.host).toBe('0.0.0.0');
    expect(parsed.root).toBe(resolve('games'));
  });
  test('rejects a bad port, a bad alias and an unknown flag', () => {
    expect(() => parseServeArgs(['--base', BASE, '--port', 'x'])).toThrow(/--port/);
    expect(() => parseServeArgs(['--base', BASE, '--port', '70000'])).toThrow(/--port/);
    expect(() => parseServeArgs(['--base', BASE, '--alias', 'nope'])).toThrow(/--alias/);
    expect(() => parseServeArgs(['--base', BASE, '--alias', '=x'])).toThrow(/--alias/);
    expect(() => parseServeArgs(['--base', BASE, '--bogus'])).toThrow();
  });
});

describe('listening server', () => {
  let running: Running;
  beforeAll(async () => {
    running = await startServer(options);
  });
  afterAll(async () => {
    await running.close();
  });

  test('serves a game page with the GitHub Pages headers', async () => {
    const response = await fetch(`${running.url}${BASE}games/gin-rummy/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('<title>Gin Rummy</title>');
  });
  test('redirects a directory without its slash, keeping the query', async () => {
    const response = await fetch(`${running.url}${BASE}games/fidice?peer=x`, {
      redirect: 'manual',
    });
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(`${BASE}games/fidice/?peer=x`);
  });
  test('redirects the bare mount point', async () => {
    const response = await fetch(`${running.url}${BASE.slice(0, -1)}`, { redirect: 'manual' });
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(BASE);
  });
  test('serves the ICE alias as JSON', async () => {
    const response = await fetch(`${running.url}${BASE}e2e-ice.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual(ICE_FIXTURE);
  });
  test('HEAD carries the length and no body', async () => {
    const response = await fetch(`${running.url}${BASE}shared/ice.js`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(Number(response.headers.get('content-length'))).toBeGreaterThan(1000);
    expect(await response.text()).toBe('');
  });
  test('404 outside the mount and for missing files; 405 for other methods', async () => {
    expect((await fetch(`${running.url}/`)).status).toBe(404);
    expect((await fetch(`${running.url}${BASE}missing.js`)).status).toBe(404);
    expect((await fetch(`${running.url}${BASE}../package.json`)).status).toBe(404);
    const post = await fetch(`${running.url}${BASE}`, { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });
});
