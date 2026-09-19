// Captures what the legacy gin page writes to localStorage (docs/MIGRATION.md step 11) into
// test/fixtures/legacy/gin-storage/<key>.<variant>.json, one small file per key and variant,
// `raw` being the exact string under the key. The page itself is driven: legacy/gin-rummy/index.html
// and legacy/shared/ice.js are published through tools/serve-dist.ts aliases (no build needed),
// PeerJS comes from node_modules through the e2e offline route, a local PeerServer (the `peer`
// package) answers the broker socket for the host save, and headless Chromium plays through the
// DOM the way e2e/fixtures/gin.ts does: name, tabs, play mode, a pass-and-play game to a mid-hand
// save, the sound toggle, the scorer with three players and two hands. Two saves cannot come from
// the DOM alone: the host's mid-hand save needs a connected guest, so the host branch is reached
// through the page's own `window.__gin` test hook (the game and the act() call are the page's), and
// the guest's save is only written when its data channel opens, which needs a second peer; that
// one is derived from `persist()` and marked so. Run (Chromium from `npx playwright install`):
//   node --experimental-strip-types tools/legacy/capture-gin-storage.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';

import { chromium, type Page } from '@playwright/test';
import { PeerServer } from 'peer';

import { routeOffline } from '../../e2e/fixtures/offline.ts';
import { seedScript } from '../../e2e/fixtures/seed.ts';
import { PAGES_BASE_PATH } from '../../e2e/fixtures/site.ts';
import { startServer } from '../serve-dist.ts';
import { FIXTURE_DIR, REPO_ROOT, isMain } from './extract.ts';

export const STORAGE_DIR = `${FIXTURE_DIR}/gin-storage`;
const HOST = '127.0.0.1';
/** The Pages mount point, spelled once in e2e/fixtures/site.ts. */
const BASE = PAGES_BASE_PATH;
const SEED = 11;
const STEP_TIMEOUT = 15_000;

export type Capture = Readonly<{
  key: string;
  variant: string;
  /** How the value came to be: what the page did before the dump, or that it is derived. */
  captured: string;
  raw: string;
}>;

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

/** Every ginRummy* key of the page's localStorage, raw (a string expression: no DOM types here). */
const dump = (page: Page): Promise<Record<string, string>> =>
  page.evaluate<Record<string, string>>(
    `Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('ginRummy')).map((k) => [k, localStorage.getItem(k)]))`,
  );

const take = async (
  page: Page,
  key: string,
  variant: string,
  captured: string,
): Promise<Capture> => {
  const raw = (await dump(page))[key];
  if (raw === undefined) throw new Error(`${key} not in localStorage after: ${captured}`);
  return { key, variant, captured, raw };
};

/** Select the first discardable card and discard it, as e2e/fixtures/gin.ts does. */
const discardFirstFree = async (page: Page): Promise<void> => {
  await page.locator('#hand .card:not(.locked)').first().click();
  await page.locator('#actions [data-act="discard"]').click();
};

const passCurtain = async (page: Page): Promise<void> => {
  await page.locator('#curtainBtn').click();
};

export const capture = async (pageUrl: string): Promise<ReadonlyArray<Capture>> => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  context.setDefaultTimeout(STEP_TIMEOUT);
  await context.addInitScript({ content: seedScript(SEED) });
  await routeOffline(context);
  const page = await context.newPage();
  // leaveGame() and the scorer's leave() ask through confirm(); Playwright would dismiss (cancel).
  page.on('dialog', (dialog) => {
    dialog.accept().catch(() => undefined);
  });
  const out: Capture[] = [];
  try {
    await page.goto(pageUrl);
    await page.locator('#homeScreen').waitFor();

    // Name: written on every keystroke of the online form (rememberName), sliced to 20.
    await page.locator('#nameInput').fill('Ann');
    out.push(await take(page, 'ginRummy_name', 'typed', 'typed "Ann" into #nameInput'));

    // Home tab: each tab click persists; the page starts on "play".
    await page.locator('#tabRulesBtn').click();
    out.push(await take(page, 'ginRummy_homeTab', 'rules', 'clicked the Rules tab'));
    await page.locator('#tabScoreBtn').click();
    out.push(await take(page, 'ginRummy_homeTab', 'score', 'clicked the Score tab'));
    await page.locator('#tabPlayBtn').click();
    out.push(await take(page, 'ginRummy_homeTab', 'play', 'clicked the Play tab'));

    // Play mode switch.
    await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
    out.push(await take(page, 'ginRummy_playMode', 'local', 'chose Pass & play'));
    await page.locator('#playModeSwitch .mode-btn[data-mode="online"]').click();
    out.push(await take(page, 'ginRummy_playMode', 'online', 'chose Online'));

    // Scorer: three players, a knock hand and a gin hand.
    await page.locator('#tabScoreBtn').click();
    const names = page.locator('#scPlayers input');
    await names.nth(0).fill('Ann');
    await names.nth(1).fill('Bob');
    await page.locator('#scAddPlayerBtn').click();
    await names.nth(2).fill('Cy');
    await page.locator('#scTargetInput').fill('150');
    await page.locator('#scStartBtn').click();
    await page.locator('#scGameScreen').waitFor();
    out.push(
      await take(page, 'ginRummy_scorerNames', 'three', 'started scoring for Ann, Bob and Cy'),
    );
    out.push(
      await take(page, 'ginRummyScorerState_v2', 'fresh', 'started scoring to 150, no hands yet'),
    );
    const cards = page.locator('#scBoard .player-card');
    await cards.nth(0).locator('.chip[data-k="knock"]').click();
    await cards.nth(0).locator('input.dw').fill('5');
    await cards.nth(1).locator('input.dw').fill('20');
    await cards.nth(2).locator('input.dw').fill('3');
    await page.locator('#scSubmitBtn').click();
    await page.locator('#scResContinue').click();
    await cards.nth(1).locator('.chip[data-k="gin"]').click();
    await cards.nth(0).locator('input.dw').fill('12');
    await cards.nth(2).locator('input.dw').fill('40');
    await page.locator('#scSubmitBtn').click();
    await page.locator('#scResContinue').click();
    out.push(
      await take(
        page,
        'ginRummyScorerState_v2',
        'twoHands',
        'Ann knocked with 5 (Bob 20, Cy 3: Cy undercuts), then Bob went gin (Ann 12, Cy 40)',
      ),
    );
    await page.locator('#scLeaveBtn').click();

    // Pass and play: start, then play until a mid-hand save with a pending draw and one without.
    await page.locator('#homeScreen').waitFor();
    await page.locator('#tabPlayBtn').click();
    await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
    await page.locator('#p1NameInput').fill('Ann');
    await page.locator('#p2NameInput').fill('Bob');
    await page.locator('#localBtn').click();
    await page.locator('#curtainOverlay').waitFor();
    out.push(await take(page, 'ginRummyMP_v1', 'local.dealt', 'started pass & play Ann vs Bob'));
    await passCurtain(page);
    await page.locator('#actions [data-act="passUpcard"]').click();
    await passCurtain(page);
    await page.locator('#actions [data-act="takeUpcard"]').click();
    await discardFirstFree(page);
    await passCurtain(page);
    await page.locator('#stockPile').click();
    out.push(
      await take(
        page,
        'ginRummyMP_v1',
        'local.pendingDraw',
        'non-dealer passed, dealer took the upcard and discarded, non-dealer drew from the stock (discard pending)',
      ),
    );
    await discardFirstFree(page);
    await passCurtain(page);
    await page.locator('#stockPile').click();
    await discardFirstFree(page);
    out.push(await take(page, 'ginRummyMP_v1', 'local.midHand', 'three turns played, curtain up'));

    // Sound: the toggle lives on the table screen (behind the curtain until the next player taps).
    await passCurtain(page);
    await page.locator('#soundBtn').click();
    out.push(await take(page, 'ginRummy_sound', 'off', 'tapped the sound button once'));
    await page.locator('#soundBtn').click();
    out.push(await take(page, 'ginRummy_sound', 'on', 'tapped the sound button again'));
    await page.locator('#leaveBtn').click();
    await page.locator('#homeScreen').waitFor();

    // Host, lobby: startHost() persists when the broker confirms the room (a real PeerServer).
    await page.locator('#playModeSwitch .mode-btn[data-mode="online"]').click();
    await page.locator('#targetInput').fill('75');
    await page.locator('#hostBtn').click();
    await page
      .locator('#hostWaitStatus')
      .filter({ hasText: 'Waiting for your opponent' })
      .waitFor();
    out.push(
      await take(
        page,
        'ginRummyMP_v1',
        'host.lobby',
        'hosted a room to 75 through a local PeerServer; no guest yet',
      ),
    );
    // Host, mid-hand: needs a connected guest, so the page's own hook stands in for the join
    // (oppName/oppConnected as onGuestMsg sets them, createGame as hostStartGame calls it) and
    // act() runs the page's dispatch -> broadcast -> persist path.
    await page.evaluate(`(() => {
      const app = window.__gin.app;
      app.oppName = 'Jeff';
      app.oppConnected = true;
      app.game = GinEngine.createGame({
        players: [{ id: 'host', name: app.myName }, { id: 'guest', name: 'Jeff' }],
        target: app.target,
        dealer: 1,
      });
      window.__gin.act({ type: 'passUpcard' });
      GinEngine.applyAction(app.game, 1, { type: 'passUpcard' });
      window.__gin.act({ type: 'drawStock' });
    })()`);
    out.push(
      await take(
        page,
        'ginRummyMP_v1',
        'host.midHand',
        'host game via window.__gin: both passed the upcard, host drew from the stock',
      ),
    );
    await page.locator('#leaveBtn').click();
    await page.locator('#homeScreen').waitFor();

    // Guest: persist() writes { role: 'guest', code, myName } when the data channel opens.
    const guestSave = JSON.stringify({ role: 'guest', code: 'KQZM', myName: 'Jeff' });
    out.push({
      key: 'ginRummyMP_v1',
      variant: 'guest.derived',
      captured:
        "derived from persist()'s guest branch (legacy/gin-rummy/index.html): written only when the guest's data channel opens, which needs a second peer",
      raw: guestSave,
    });
    return out;
  } finally {
    await context.close();
    await browser.close();
  }
};

export const captureFile = (c: Capture): string =>
  resolve(REPO_ROOT, STORAGE_DIR, `${c.key}.${c.variant}.json`);

if (isMain(import.meta.url)) {
  const [servePort, peerPort] = await Promise.all([freePort(), freePort()]);
  const server = await startServer({
    root: resolve(REPO_ROOT, 'legacy'),
    base: BASE,
    host: HOST,
    port: servePort,
    aliases: {
      'games/gin-rummy/index.html': resolve(REPO_ROOT, 'legacy/gin-rummy/index.html'),
      'shared/ice.js': resolve(REPO_ROOT, 'legacy/shared/ice.js'),
      'e2e-ice.json': resolve(REPO_ROOT, 'e2e/fixtures/e2e-ice.json'),
    },
  });
  const peers = await startPeerServer(peerPort);
  try {
    const query = new URLSearchParams({
      peer: `${HOST}:${String(peerPort)}`,
      ice: `${server.url}${BASE}e2e-ice.json`,
    });
    const captures = await capture(
      `${server.url}${BASE}games/gin-rummy/index.html?${query.toString()}`,
    );
    mkdirSync(resolve(REPO_ROOT, STORAGE_DIR), { recursive: true });
    captures.forEach((c) => {
      writeFileSync(captureFile(c), `${JSON.stringify(c, null, 2)}\n`);
      console.log(`${STORAGE_DIR}/${c.key}.${c.variant}.json: ${String(c.raw.length)} chars`);
    });
  } finally {
    await peers.close();
    await server.close();
  }
}
