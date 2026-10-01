// The reaction game on a phone (docs/design/rps-island.md §3): five rounds driven by the page's
// clock (`page.clock`: the scroll, the window and the reaction time are all timers and
// `performance.now()` readings, so a round is played to the millisecond), rigged through the
// documented hook `window.__rps.rig` so the computer's hand is known. A win at +4 with four fast
// wins saved offers Tech up (§2), Tech up is taken, then a tie, a loss and a timeout (neither moves
// the window: a loss only costs a point, §2); after each the counter, the band and the saved
// `rps_progress` are what the vectors say (§6). Twice: an iPhone
// (390 × 844) and an Android phone (360 × 800), both touch contexts, so the three hands are
// thumb-height and inside the screen on either; on `pages` alone, since they are about the page.
// Then the island row (§11), which is about the origin: on `proxy` (games.sweedler.com emulated,
// the real Worker over the harness's stubs) an iPhone with a Dynamic Island sees the button, pairs
// through a POST the clip would make, plays a round and the stub APNs takes the push; an Android
// phone there sees no row; on `pages` (no Worker) the same iPhone sees none either.
import type { Browser, BrowserContext, Page } from '@playwright/test';

import { PAGE_TITLES } from '../tools/games.ts';
import { startProxy, type ApnsPush } from '../tools/proxy-dev.ts';
import {
  APP_STORE_ID,
  CLIP_BUNDLE_ID,
  CLIP_ORIGIN,
  SMART_APP_BANNER_META,
} from '../web/shared/lib/appClip.ts';
import { deviceById, emulationFor } from '../web/shared/lib/devices.ts';
import { ALLOWED_FAILURES } from './fixtures/offline.ts';
import { LOCAL_HOST, PAGES_ORIGIN, baseUrl, pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';
import { watchPage } from './fixtures/watch.ts';

type Hand = 'rock' | 'paper' | 'scissors';
const GLYPH: Readonly<Record<Hand, string>> = { rock: '✊', paper: '✋', scissors: '✌️' };

/** The page's key and its versioned shape (web/games/rps/src/engine/codec.ts). */
const KEY = 'rps_progress';
type Stored = Readonly<{
  v: 2;
  counter: number;
  windowMs: number;
  prestige: number;
  recentWins: ReadonlyArray<number>;
  best: number | null;
}>;
/** +4 with four fast wins saved: the next fast win is the fifth, at +5, and Tech up is offered. */
const SEEDED: Stored = {
  v: 2,
  counter: 4,
  windowMs: 2500,
  prestige: 0,
  recentWins: [300, 310, 320, 330],
  best: 300,
};

/** The saved progress as the page wrote it, or null before the first save. */
const stored = async (page: Page): Promise<Stored | null> =>
  page.evaluate<Stored | null>(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);

/** A saved progress in place before the page boots (the specs run without the DOM lib: scripts are text). */
const seedStorage = async (page: Page, value: Stored): Promise<void> => {
  await page.addInitScript({
    content: `localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(value))});`,
  });
};

const SCROLL_MS = 800;

/**
 * One round: rig the computer's hand and the scroll's length, Go, run the scroll out (the resolve
 * fires at its end), wait `reactionMs` on the page's clock, then tap `player` (or let the window
 * run out when `player` is null). The page reads its reaction off `performance.now()`, which the
 * installed clock does not hold still, so the shown reaction is `reactionMs` plus the real time the
 * tap took: the specs bound it (at least `reactionMs`, under the window) and read the exact value
 * back for the saved wins.
 */
const round = async (
  page: Page,
  computer: Hand,
  player: Hand | null,
  reactionMs: number,
): Promise<void> => {
  await page.evaluate(`window.__rps.rig(${JSON.stringify({ computer, scrollMs: SCROLL_MS })})`);
  await page.locator('#goBtn').click();
  await expect(page.locator('#goBtn')).toBeHidden();
  await page.clock.runFor(SCROLL_MS);
  await expect(page.locator('#computerHand')).toHaveText(GLYPH[computer]);
  await expect(page.locator('#computerHand')).toHaveClass(/armed/);
  await expect(page.locator('#rockBtn')).toBeEnabled();
  await page.clock.runFor(reactionMs);
  if (player !== null) await page.locator(`#${player}Btn`).click();
};

/** The reaction the page shows, in ms, bounded below by what the clock ran and above by the window. */
const shownReaction = async (page: Page, atLeast: number, windowMs: number): Promise<number> => {
  await expect(page.locator('#reaction')).toHaveText(/^\d+ ms$/);
  const ms = Number(/^(\d+) ms$/.exec((await page.locator('#reaction').textContent()) ?? '')?.[1]);
  expect(ms).toBeGreaterThanOrEqual(atLeast);
  expect(ms).toBeLessThanOrEqual(windowMs);
  return ms;
};

const expectScore = async (
  page: Page,
  counter: string,
  mood: string,
  set: string,
): Promise<void> => {
  await expect(page.locator('#counter')).toHaveText(counter);
  await expect(page.locator('#app')).toHaveAttribute('data-mood', mood);
  await expect(page.locator('#counterFace')).toHaveAttribute('data-set', set);
  await expect(page.locator('#buddy')).toHaveAttribute('data-set', set);
};

const VIEWPORTS: ReadonlyArray<readonly [string, number, number]> = [
  ['an iPhone (390 × 844)', 390, 844],
  ['an Android phone (360 × 800)', 360, 800],
];

VIEWPORTS.forEach(([name, width, height]) => {
  test(`five rounds on ${name}: win into Tech up, tech up, tie, loss, timeout`, async ({
    phone,
    project,
  }) => {
    test.skip(project !== 'pages', 'about the page, not the origin');
    const { page } = phone;
    await page.setViewportSize({ width, height });
    await seedStorage(page, SEEDED);
    // The clock is installed before the page and paused once it has booted: from here time moves
    // only by `runFor`, so the scroll, the window and the auto-next fire when the spec says.
    await page.clock.install({ time: new Date('2026-09-29T12:00:00Z') });
    await page.goto(pagePath(project, 'rps'));
    await expect(page).toHaveTitle(PAGE_TITLES.rps);
    await expect.poll(() => page.evaluate<string>('typeof window.__rps')).toBe('object');
    await page.clock.pauseAt(new Date('2026-09-29T12:00:05Z'));

    // The saved progress paints: +4, happy, the buddy on its happy loop, the island slot empty.
    await expectScore(page, '+4', 'happy', 'happy');
    await expect(page.locator('#windowMs')).toHaveText('Window 2500 ms');
    await expect(page.locator('#islandSlot')).toBeEmpty();
    // Thumb-reachable: every hand is a 44 px+ target inside the screen, and the buttons too.
    const boxes = await Promise.all(
      ['#rockBtn', '#paperBtn', '#scissorsBtn', '#goBtn'].map((id) =>
        page.locator(id).boundingBox(),
      ),
    );
    boxes.forEach((box) => {
      expect(box).not.toBeNull();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    });
    // One fixed screen (rps-island.md §10 "The layout"): the page put itself in the upright bucket
    // (main.ts writes `data-layout`, docs/design/layout-buckets.md) and nothing scrolls, neither
    // the document nor `#app` inside it.
    await expect(page.locator('body')).toHaveAttribute('data-layout', 'phone-upright');
    expect(
      await page.evaluate<boolean>(
        `document.documentElement.scrollHeight <= innerHeight &&
         document.getElementById('app').scrollHeight <= document.getElementById('app').clientHeight`,
      ),
    ).toBe(true);

    // 1. A win at 350 ms: +5, very happy, the fifth fast win, Tech up on offer (so no auto next).
    await round(page, 'scissors', 'rock', 350);
    await expect(page.locator('#verdict')).toHaveText('You win');
    const win = await shownReaction(page, 350, 2500);
    await expectScore(page, '+5', 'veryHappy', 'very-happy');
    await expect(page.locator('#techUpBtn')).toBeVisible();
    await expect(page.locator('#techUpCost')).toHaveText('2500 → 1875 ms');
    await expect(page.locator('#stopBtn')).toBeHidden();
    expect(await stored(page)).toEqual({
      ...SEEDED,
      counter: 5,
      recentWins: [300, 310, 320, 330, win],
    });
    // Nothing starts by itself while the offer stands.
    await page.clock.runFor(2000);
    await expect(page.locator('#goBtn')).toBeVisible();
    await expect(page.locator('#techUpBtn')).toBeVisible();

    // 2. Tech up: window 1875, counter 0, prestige 1, the wins cleared, the best kept.
    await page.locator('#techUpBtn').click();
    await expectScore(page, '0', 'neutral', 'neutral');
    await expect(page.locator('#windowMs')).toHaveText('Window 1875 ms');
    await expect(page.locator('#prestige')).toHaveText('Prestige 1');
    await expect(page.locator('#best')).toHaveText('Best 300 ms');
    await expect(page.locator('#techUpBtn')).toBeHidden();
    expect(await stored(page)).toEqual({
      v: 2,
      counter: 0,
      windowMs: 1875,
      prestige: 1,
      recentWins: [],
      best: 300,
    });

    // 3. A tie: nothing moves, and the next round is pending (Stop shows).
    await round(page, 'paper', 'paper', 200);
    await expect(page.locator('#verdict')).toHaveText('Tie');
    await shownReaction(page, 200, 1875);
    await expectScore(page, '0', 'neutral', 'neutral');
    await expect(page.locator('#stopBtn')).toBeVisible();
    expect((await stored(page))?.counter).toBe(0);
    expect((await stored(page))?.windowMs).toBe(1875);

    // 4. A loss at 300 ms: −1, still neutral, the window stays 1875 (a loss never slows the game).
    await round(page, 'rock', 'scissors', 300);
    await expect(page.locator('#verdict')).toHaveText('You lose');
    await shownReaction(page, 300, 1875);
    await expectScore(page, '−1', 'neutral', 'neutral');
    await expect(page.locator('#windowMs')).toHaveText('Window 1875 ms');
    await expect(page.locator('#status')).toHaveText('Fall to −5 and you drop a level.');
    expect(await stored(page)).toMatchObject({ counter: -1, windowMs: 1875, prestige: 1 });

    // 5. A timeout: no tap within 1875 ms is a loss, −2 and sad, the window still 1875; the hands disarm.
    await round(page, 'rock', null, 1876);
    await expect(page.locator('#verdict')).toHaveText('Too slow');
    await expect(page.locator('#reaction')).toHaveText('No tap within 1875 ms');
    await expectScore(page, '−2', 'sad', 'sad');
    await expect(page.locator('#windowMs')).toHaveText('Window 1875 ms');
    await expect(page.locator('#rockBtn')).toBeDisabled();
    expect(await stored(page)).toEqual({
      v: 2,
      counter: -2,
      windowMs: 1875,
      prestige: 1,
      recentWins: [],
      best: 300,
    });

    // The next round starts by itself 1.4 s after a verdict; Stop holds it.
    await page.locator('#stopBtn').click();
    await page.clock.runFor(3000);
    await expect(page.locator('#goBtn')).toBeVisible();
    await expect(page.locator('#computerHand')).not.toHaveClass(/scrolling/);
  });
});

test('Reset progress asks first, then starts over', async ({ phone, project }) => {
  test.skip(project !== 'pages', 'about the page, not the origin');
  const { page } = phone;
  await seedStorage(page, { ...SEEDED, counter: -5, windowMs: 251, prestige: 8 });
  await page.goto(pagePath(project, 'rps'));
  await expectScore(page, '−5', 'verySad', 'very-sad');
  await expect(page.locator('#status')).toHaveText('As fast as it gets: 251 ms.');
  // Dismissed: nothing changes.
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.locator('#resetBtn').click();
  await expectScore(page, '−5', 'verySad', 'very-sad');
  // Accepted: the start, saved.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('#resetBtn').click();
  await expectScore(page, '0', 'neutral', 'neutral');
  await expect(page.locator('#windowMs')).toHaveText('Window 2500 ms');
  await expect(page.locator('#prestige')).toHaveText('No prestige yet');
  await expect(page.locator('#best')).toHaveText('No best yet');
  expect(await stored(page)).toEqual({
    v: 2,
    counter: 0,
    windowMs: 2500,
    prestige: 0,
    recentWins: [],
    best: null,
  });
});

// ---- The island row (docs/design/rps-island.md §11) ----------------------------------------------

/** The catalogue class with a Dynamic Island the spec stands on: iPhone 14 Pro, 15, 15 Pro, 16 (393 × 852). */
const ISLAND_IPHONE = 'iphone-393x852';
/** The 360-wide Android class (Galaxy S23): a hole in the glass, never a row. */
const ANDROID = 'android-360x780-galaxy';
/** What the clip would post: a 64-hex activity push token. */
const FAKE_TOKEN = 'ab'.repeat(32);
const SESSION_SHAPE = /^[a-z0-9]{8}$/;

/** A context standing on a catalogue device upright in a tab with the bar up (as e2e/ui-sandbox.spec.ts does). */
const deviceContext = (browser: Browser, id: string, baseURL: string): Promise<BrowserContext> => {
  const device = deviceById(id);
  if (device === null) throw new Error(`no catalogue row ${id}`);
  const e = emulationFor(device, 'portrait', 'browser', 'shown');
  return browser.newContext({
    baseURL,
    viewport: e.viewport,
    screen: e.screen,
    deviceScaleFactor: e.dpr,
    isMobile: true,
    hasTouch: true,
  });
};

const slot = (page: Page) => page.locator('#islandSlot');
const banner = (page: Page) => page.locator(`meta[name="${SMART_APP_BANNER_META}"]`);
const islandKind = (page: Page): Promise<string> =>
  page.evaluate<string>('window.__rps.island().kind');
const sessionStored = (page: Page): Promise<string | null> =>
  page.evaluate<string | null>('sessionStorage.getItem("rps_session")');
/** The session in the send link's href. */
const sessionOfLink = async (page: Page): Promise<string> => {
  const href = (await slot(page).locator('a[data-island="send"]').getAttribute('href')) ?? '';
  return new URL(href).searchParams.get('session') ?? '';
};
/** Every push the stub APNs took (tools/proxy-dev.ts `startApnsStub`), oldest first. */
const pushes = async (apns: string): Promise<ReadonlyArray<ApnsPush>> =>
  (await (await fetch(`${apns}/pushes`)).json()) as ReadonlyArray<ApnsPush>;
type ContentState = Readonly<{ counter: number; prestige: number; band: string; at: number }>;
type Box = Readonly<{ x: number; y: number; width: number; height: number }>;
/** The paired screen in one read: the viewport, whether anything scrolls, the two foot links' boxes. */
type PairedScreen = Readonly<{
  width: number;
  height: number;
  scrolls: boolean;
  home: Box;
  reset: Box;
}>;
const contentState = (push: ApnsPush | undefined): ContentState =>
  (JSON.parse(push?.body ?? '{}') as Readonly<{ aps: Readonly<{ 'content-state': ContentState }> }>)
    .aps['content-state'];

test.describe('the island row', () => {
  test('an island iPhone on games.sweedler.com: the button, the pairing, the round pushed to the island, the buddy sent home', async ({
    browser,
    project,
  }) => {
    test.skip(project !== 'proxy', "the Worker is the proxy origin's");
    // A proxy of this spec's own (the same Worker and stubs as the harness's), so the stub APNs's
    // address is known here; the page is served from it.
    const proxy = await startProxy({ host: LOCAL_HOST, port: 0, upstream: PAGES_ORIGIN });
    const context = await deviceContext(browser, ISLAND_IPHONE, `${proxy.url}/`);
    try {
      // The clip's URL is the live host's; here it lands on a stub so the tap never leaves the machine.
      await context.route(`${CLIP_ORIGIN}/**`, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<title>clip</title>' }),
      );
      const page = await context.newPage();
      const watched = watchPage(page, ALLOWED_FAILURES);
      await seedStorage(page, SEEDED);
      await page.clock.install({ time: new Date('2026-09-29T12:00:00Z') });
      await page.goto(pagePath('proxy', 'rps'));
      await expect.poll(() => page.evaluate<string>('typeof window.__rps')).toBe('object');
      await page.clock.pauseAt(new Date('2026-09-29T12:00:05Z'));

      // The probe found the Worker: the button, a plain link to the clip carrying the session,
      // the session in sessionStorage, and the Smart App Banner naming the clip and that URL.
      const send = slot(page).locator('a[data-island="send"]');
      await expect(send).toHaveText('Send buddy to your island');
      await expect(send).toHaveAttribute('target', '_blank');
      const session = await sessionOfLink(page);
      expect(session).toMatch(SESSION_SHAPE);
      const href = `${CLIP_ORIGIN}/clip/rps?session=${session}`;
      await expect(send).toHaveAttribute('href', href);
      expect(await sessionStored(page)).toBe(session);
      await expect(banner(page)).toHaveAttribute(
        'content',
        `app-id=${APP_STORE_ID}, app-clip-bundle-id=${CLIP_BUNDLE_ID}, app-clip-display=card, app-argument=${href}`,
      );

      // The tap opens the clip in a new tab; the row says the buddy is on its way and polls.
      const [popup] = await Promise.all([context.waitForEvent('page'), send.click()]);
      await popup.close();
      await expect(slot(page)).toContainText('Buddy is on its way…');
      expect(await islandKind(page)).toBe('waiting');
      expect(await pushes(proxy.apns)).toEqual([]);

      // The clip pairs: its POST with the activity's token. The page's next poll, 3 s later on
      // its clock, sees it; paired, the page syncs the island with the saved +4 at once.
      const paired = await fetch(`${proxy.url}/api/rps/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session, token: FAKE_TOKEN, bundle: CLIP_BUNDLE_ID }),
      });
      expect(paired.status).toBe(204);
      await page.clock.runFor(3000);
      await expect(slot(page)).toContainText('Buddy is in your island');
      await expect.poll(async () => (await pushes(proxy.apns)).length).toBe(1);
      const sync = (await pushes(proxy.apns))[0];
      expect(sync?.token).toBe(FAKE_TOKEN);
      expect(sync?.headers['apns-topic']).toBe(`${CLIP_BUNDLE_ID}.push-type.liveactivity`);
      expect(sync?.headers['apns-push-type']).toBe('liveactivity');
      expect(contentState(sync)).toMatchObject({ counter: 4, prestige: 0, band: 'happy' });

      // The Worker spaces pushes 2 s apart on its own clock (rps-push.ts PUSH_INTERVAL_MS): wait it
      // out, then a win at 350 ms: +5, very happy, the mood posted and pushed to the island.
      await page.waitForTimeout(2_100);
      await round(page, 'scissors', 'rock', 350);
      await expect(page.locator('#verdict')).toHaveText('You win');
      await expectScore(page, '+5', 'veryHappy', 'very-happy');
      await expect.poll(async () => (await pushes(proxy.apns)).length).toBe(2);
      const push = (await pushes(proxy.apns))[1];
      expect(push?.token).toBe(FAKE_TOKEN);
      const state = contentState(push);
      expect(state).toMatchObject({ counter: 5, prestige: 0, band: 'veryHappy' });
      // `at` is the page's clock at the save, in seconds.
      const pageNow = await page.evaluate<number>('Date.now()');
      expect(Math.abs(state.at - Math.floor(pageNow / 1000))).toBeLessThanOrEqual(1);

      // The paired row in the fixed screen (rps-island.md §10 "The layout": the foot holds it). This
      // is the tab's 393 × 672 room with Tech up on offer and its hint under the buttons, the tallest
      // paired screen: Send buddy home and Reset progress share the foot's line, each inside the
      // viewport, the two apart, and nothing scrolls. (CI's wider fallback font once wrapped the
      // column past the room; the foot's track collapsed and Reset progress, drawn up over the row,
      // took every tap meant for Send buddy home until the test timed out.) One read of the page
      // once the post has landed: the row is repainted on every island event, so a box read across
      // the reply could hold a detached element.
      await expect.poll(() => page.evaluate<boolean>('window.__rps.island().inflight')).toBe(false);
      const screen = await page.evaluate<PairedScreen>(`(() => {
        const box = (sel) => {
          const r = document.querySelector(sel).getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const app = document.getElementById('app');
        return {
          width: innerWidth,
          height: innerHeight,
          scrolls: document.documentElement.scrollHeight > innerHeight || app.scrollHeight > app.clientHeight,
          home: box('#islandSlot [data-island="home"]'),
          reset: box('#resetBtn'),
        };
      })()`);
      const inside = (b: Box): boolean =>
        b.x >= 0 && b.y >= 0 && b.x + b.width <= screen.width && b.y + b.height <= screen.height;
      const apart = (a: Box, b: Box): boolean =>
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y;
      expect(screen.width, 'the tab room').toBe(393);
      expect(inside(screen.home), `Send buddy home inside ${JSON.stringify(screen)}`).toBe(true);
      expect(inside(screen.reset), `Reset progress inside ${JSON.stringify(screen)}`).toBe(true);
      expect(apart(screen.home, screen.reset), `the two apart ${JSON.stringify(screen)}`).toBe(
        true,
      );
      expect(screen.scrolls, 'the paired screen scrolls').toBe(false);

      // Send buddy home: the button again on a fresh session (remembered), the old one unreachable.
      await slot(page).locator('[data-island="home"]').click();
      await expect(slot(page).locator('a[data-island="send"]')).toHaveText(
        'Send buddy to your island',
      );
      const fresh = await sessionOfLink(page);
      expect(fresh).toMatch(SESSION_SHAPE);
      expect(fresh).not.toBe(session);
      expect(await sessionStored(page)).toBe(fresh);
      expect(await islandKind(page)).toBe('idle');
      expect(watched.errors(), 'uncaught exceptions').toEqual([]);
    } finally {
      await context.close();
      await proxy.close();
    }
  });

  test('an Android phone on games.sweedler.com: no row, no banner', async ({
    browser,
    project,
  }) => {
    test.skip(project !== 'proxy', "the Worker is the proxy origin's");
    const context = await deviceContext(browser, ANDROID, baseUrl('proxy'));
    try {
      const page = await context.newPage();
      await page.goto(pagePath('proxy', 'rps'));
      await expect.poll(() => page.evaluate<string>('typeof window.__rps')).toBe('object');
      expect(await islandKind(page)).toBe('off');
      await expect(slot(page)).toBeEmpty();
      await expect(banner(page)).toHaveCount(0);
      expect(await sessionStored(page)).toBeNull();
    } finally {
      await context.close();
    }
  });

  test('an island iPhone on GitHub Pages: no Worker, so no row and the banner taken back', async ({
    browser,
    project,
  }) => {
    test.skip(project !== 'pages', 'the origin without a Worker');
    const context = await deviceContext(browser, ISLAND_IPHONE, baseUrl('pages'));
    try {
      const page = await context.newPage();
      await page.goto(pagePath('pages', 'rps'));
      await expect.poll(() => page.evaluate<string>('typeof window.__rps')).toBe('object');
      await expect.poll(() => islandKind(page)).toBe('off');
      await expect(slot(page)).toBeEmpty();
      await expect(banner(page)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
