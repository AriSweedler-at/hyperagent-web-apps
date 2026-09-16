import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const withUpstream = async (handler, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const upstreamEcho = async (req) => new Response(req.url, { status: 200 });
const get = (path) => worker.fetch(new Request('https://games.sweedler.com' + path));

test('/ serves the Pages site root', () => withUpstream(upstreamEcho, async () => {
  assert.equal(await (await get('/')).text(), 'https://arisweedler-at.github.io/hyperagent-web-apps/');
}));

test('/XXX/ serves games/XXX/', () => withUpstream(upstreamEcho, async () => {
  assert.equal(await (await get('/gin-rummy/')).text(), 'https://arisweedler-at.github.io/hyperagent-web-apps/games/gin-rummy/');
}));

test('/games/XXX/ redirects to the short URL without calling upstream', () => withUpstream(async () => { throw new Error('no upstream call expected'); }, async () => {
  const res = await get('/games/gin-rummy/?v=1');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), 'https://games.sweedler.com/gin-rummy/?v=1');
}));

test('/shared/ice.js reaches the shared directory, not games/shared', () => withUpstream(upstreamEcho, async () => {
  assert.equal(await (await get('/shared/ice.js')).text(), 'https://arisweedler-at.github.io/hyperagent-web-apps/shared/ice.js');
}));

test('/hyperagent-web-apps/… passes through', () => withUpstream(upstreamEcho, async () => {
  assert.equal(await (await get('/hyperagent-web-apps/games/fidice/')).text(), 'https://arisweedler-at.github.io/hyperagent-web-apps/games/fidice/');
}));

test('upstream trailing-slash redirect is rewritten back to this origin', () => withUpstream(
  async () => new Response(null, { status: 301, headers: { Location: 'https://arisweedler-at.github.io/hyperagent-web-apps/games/gin-rummy/' } }),
  async () => {
    const res = await get('/gin-rummy');
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('Location'), 'https://games.sweedler.com/gin-rummy/');
  }));
