// tools/proxy-dev.ts is the `proxy` origin of the browser harness: the real Worker handler from
// infra/games-proxy/worker.ts fronting tools/serve-dist.ts. These tests run the two together and
// pin the behaviours the specs rely on: short URLs, the /games/ redirect, upstream redirects
// rewritten to this origin, /shared/ mapping, passthrough and byte-identical page bodies.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PAGES_BASE_PATH } from '../../e2e/fixtures/site.ts';
import { parseProxyArgs, startProxy, type Running as RunningProxy } from '../../tools/proxy-dev.ts';
import { startServer, type Running as RunningPages } from '../../tools/serve-dist.ts';
import { stageSite } from './site-fixture.ts';

// A dist-shaped directory built from the verbatim legacy files, so no build is needed here.
const site = stageSite();

describe('parseProxyArgs', () => {
  test('requires --upstream and keeps only its origin', () => {
    expect(() => parseProxyArgs([])).toThrow(/--upstream is required/);
    expect(parseProxyArgs(['--upstream', 'http://127.0.0.1:4173/some/path'])).toEqual({
      host: '127.0.0.1',
      port: 8787,
      upstream: 'http://127.0.0.1:4173',
    });
  });
  test('rejects a bad port or an unparseable upstream', () => {
    expect(() => parseProxyArgs(['--upstream', 'http://127.0.0.1:4173', '--port', 'x'])).toThrow(
      /--port/,
    );
    expect(() => parseProxyArgs(['--upstream', 'not a url'])).toThrow();
  });
});

describe('proxy in front of serve-dist', () => {
  let pages: RunningPages;
  let proxy: RunningProxy;
  beforeAll(async () => {
    pages = await startServer({
      root: site.root,
      base: PAGES_BASE_PATH,
      host: '127.0.0.1',
      port: 0,
      aliases: {},
    });
    proxy = await startProxy({ host: '127.0.0.1', port: 0, upstream: pages.url });
  });
  afterAll(async () => {
    await proxy.close();
    await pages.close();
    site.remove();
  });

  test('short game URLs serve the game pages', async () => {
    const gin = await fetch(`${proxy.url}/gin-rummy/`);
    expect(gin.status).toBe(200);
    expect(gin.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await gin.text()).toContain('<title>Gin Rummy</title>');
    const fidice = await fetch(`${proxy.url}/fidice/`);
    expect(fidice.status).toBe(200);
    expect(await fidice.text()).toContain('<title>Fidice');
  });
  test('the root serves the landing page', async () => {
    const response = await fetch(`${proxy.url}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>Ari's web apps</title>");
  });
  test('/games/XXX redirects to the short URL on this origin, keeping the query', async () => {
    const response = await fetch(`${proxy.url}/games/gin-rummy/?peer=x`, { redirect: 'manual' });
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(`${proxy.url}/gin-rummy/?peer=x`);
  });
  test('an upstream slash redirect is rewritten to this origin', async () => {
    const response = await fetch(`${proxy.url}/gin-rummy`, { redirect: 'manual' });
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(`${proxy.url}/gin-rummy/`);
  });
  test('shared assets map into the site', async () => {
    const response = await fetch(`${proxy.url}/shared/ice.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await response.text()).toContain('window.HyperIce');
  });
  test('full site paths pass through unchanged', async () => {
    const response = await fetch(`${proxy.url}${PAGES_BASE_PATH}games/fidice/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Fidice');
  });
  test('unknown short paths are 404 from upstream', async () => {
    expect((await fetch(`${proxy.url}/nope/`)).status).toBe(404);
  });
  test('the body through the proxy is byte-identical to the pages origin', async () => {
    const viaProxy = await (await fetch(`${proxy.url}/gin-rummy/`)).arrayBuffer();
    const viaPages = await (
      await fetch(`${pages.url}${PAGES_BASE_PATH}games/gin-rummy/`)
    ).arrayBuffer();
    expect(Buffer.from(viaProxy).equals(Buffer.from(viaPages))).toBe(true);
    expect(viaProxy.byteLength).toBeGreaterThan(100_000);
  });
  test('HEAD returns headers and no body', async () => {
    const response = await fetch(`${proxy.url}/fidice/`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });
});
