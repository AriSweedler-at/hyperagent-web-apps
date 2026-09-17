// The real Transport (web/shared/edge/transport.ts over PeerJS 1.5.4) against a local PeerServer
// (docs/MIGRATION.md step 5): host opens, guest connects, one frame each way, close. It runs the
// same `runContract` scenario as transport.fake.test.ts and must produce the same log, which is
// what makes the fake a faithful stand-in. Everything is started here: a PeerServer (`peer`) and a
// Vite dev server on free ports, then Chromium (Playwright) on test/integration/harness.html.
//
// WebRTC does not exist in node, hence the browser. Two peers in one page connect over the
// machine's own addresses, which a Cloudflare WARP-style tunnel blocks; when signalling worked
// but no data channel opened in time, the test skips with a note instead of failing, and
// E2E_NO_LOOPBACK=1 skips it up front. CI runners have plain loopback and run it for real.
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';

import { chromium, type Browser } from '@playwright/test';
import { PeerServer } from 'peer';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { REPO_ROOT } from '../../tools/legacy/extract.ts';
import { EXPECTED_CONTRACT_LOG } from '../../web/shared/edge/transport.contract.log.ts';
import { arrayOf, boolean, nullable, object, string } from '../../web/shared/lib/json.ts';

const HOST = '127.0.0.1';
/** How long the data channels get to open; signalling itself takes well under a second. */
const CONTRACT_TIMEOUT_MS = 15_000;
const NO_LOOPBACK =
  process.env['E2E_NO_LOOPBACK'] !== undefined && process.env['E2E_NO_LOOPBACK'] !== '';

const report = object({
  log: arrayOf(string),
  timedOut: boolean,
  expected: arrayOf(string),
  error: nullable(string),
});

const freePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolvePort(port);
      });
    });
  });

type Closeable = Readonly<{ close: () => Promise<void> }>;

const startPeerServer = (port: number): Promise<Closeable> =>
  new Promise((resolveServer) => {
    PeerServer({ host: HOST, port, path: '/' }, (httpServer) => {
      resolveServer({
        close: () =>
          new Promise((done) => {
            httpServer.close(() => {
              done();
            });
          }),
      });
    });
  });

const startVite = async (port: number): Promise<ViteDevServer> => {
  const server = await createViteServer({
    configFile: false,
    root: resolve(REPO_ROOT, 'test/integration'),
    logLevel: 'silent',
    server: { host: HOST, port, strictPort: true, fs: { allow: [REPO_ROOT] } },
  });
  await server.listen();
  return server;
};

describe('transport over a local PeerServer in Chromium', () => {
  let peerServer: Closeable | null = null;
  let vite: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let harnessUrl = '';
  let peerPort = 0;

  beforeAll(async () => {
    if (NO_LOOPBACK) return;
    const [vitePort, pPort] = await Promise.all([freePort(), freePort()]);
    peerPort = pPort;
    [peerServer, vite] = await Promise.all([startPeerServer(peerPort), startVite(vitePort)]);
    harnessUrl = `http://${HOST}:${String(vitePort)}/harness.html`;
    browser = await chromium.launch({
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--no-first-run'],
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await peerServer?.close();
  });

  test('host opens, guest connects, frames both ways, close: same log as the fake', async (context) => {
    if (NO_LOOPBACK) {
      context.skip('E2E_NO_LOOPBACK is set: loopback WebRTC is unavailable on this machine');
      return;
    }
    if (browser === null) throw new Error('browser did not start');
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(harnessUrl);
    const args = {
      hostId: `ginrummy-ari-IT${String(Date.now() % 10_000)}`,
      search: `?peer=${HOST}:${String(peerPort)}`,
      timeoutMs: CONTRACT_TIMEOUT_MS,
    };
    const raw: unknown = await page.evaluate(`__transport.run(${JSON.stringify(args)})`);
    await page.close();
    const decoded = report(raw);
    if (!decoded.ok)
      throw new Error(`harness returned an unexpected shape: ${JSON.stringify(raw)}`);
    const { log, timedOut, expected, error } = decoded.value;
    expect(pageErrors).toEqual([]);
    expect(error).toBeNull();
    expect(expected).toEqual(EXPECTED_CONTRACT_LOG);
    if (timedOut) {
      const signalled = log.includes('host:open') && log.includes('guest:open');
      if (signalled && !log.includes('connected')) {
        context.skip(
          `loopback WebRTC unavailable: both peers registered with the PeerServer but no data channel opened in ${String(CONTRACT_TIMEOUT_MS)} ms (a Cloudflare WARP-style tunnel blocks packets to the machine's own address; CI runs this for real). Log: ${JSON.stringify(log)}`,
        );
        return;
      }
      throw new Error(
        `transport contract timed out before signalling completed: ${JSON.stringify(log)}`,
      );
    }
    expect(log).toEqual(EXPECTED_CONTRACT_LOG);
  }, 60_000);
});
