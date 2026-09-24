// Drives the Gin Rummy table through its DOM (the legacy ids, kept by web/games/gin-rummy/index.html).
// The shell around it (the room, the join, the curtain's reveal, the pass-and-play start) is
// e2e/fixtures/shell.ts, driven once for both shell games; `ginReveal` and `ginStartLocal` stay
// exported here so the gin specs keep their names. Nothing here reads `window.__gin`: whose turn
// it is, what may be tapped and what was discarded are all read from the same elements a player sees.
import { expect, type Page } from '@playwright/test';

import type { Viewport } from './geometry.ts';
import { DEFAULT_NAMES, reveal, startLocal, type Names } from './shell.ts';
import { WEBRTC_TIMEOUT } from './timeouts.ts';

/** The host deals; both tables appear. */
export const ginHostDeals = async (host: Page, guest: Page): Promise<void> => {
  await expect(host.locator('#startGameBtn')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
  await host.locator('#startGameBtn').click();
  await expect(host.locator('#tableScreen')).toBeVisible();
  await expect(guest.locator('#tableScreen')).toBeVisible();
};

export type TableView = Readonly<{
  discardTop: string | null;
  handSize: number;
  oppCount: string;
  stockLabel: string;
  hand: string;
}>;

/** What the table shows: piles, hand sizes and hand number, as a player reads them. */
export const readTable = async (page: Page): Promise<TableView> => ({
  discardTop: await page.locator('#discardPile .card').getAttribute('data-card'),
  handSize: await page.locator('#hand .card').count(),
  oppCount: await page.locator('#oppCards .opp-count').innerText(),
  // textContent, not innerText: .pile-label is uppercased by CSS and innerText returns the
  // rendered case on Linux Chromium ("STOCK · 31"), while the page writes "Stock · 31".
  stockLabel: ((await page.locator('#stockPile .pile-label').textContent()) ?? '').trim(),
  hand: await page.locator('#roundBadge').innerText(),
});

export const isMyTurn = async (page: Page): Promise<boolean> =>
  (await page.locator('#statusMain').innerText()) === 'Your turn';

/** Hand the phone over: the pass-and-play curtain is up, the seat behind it taps to reveal (the shell's). */
export const ginReveal = reveal;

/**
 * Start pass-and-play (the shell's `startLocal`: Ann and Bob unless `names` says otherwise, at
 * `viewport` on the page at `url`) and reveal the first seat: the upcard decision.
 */
export const ginStartLocal = async (
  page: Page,
  url: string,
  viewport: Viewport,
  names: Names = DEFAULT_NAMES,
): Promise<void> => {
  await startLocal(page, url, viewport, names);
  await ginReveal(page);
  await expect(page.locator('#statusSub')).toHaveText('Take the upcard or pass');
};

export const ginPassUpcard = async (page: Page): Promise<void> => {
  const pass = page.locator('#actions [data-act="passUpcard"]');
  await expect(pass).toBeVisible();
  await pass.click();
};

/**
 * Accept the drawn card from the ghost slot (docs/design/gin-draw-ghost-slot.md: the owner's
 * second tap puts it into the hand): the ghost cell goes and the hand holds eleven cards.
 */
export const ginAcceptDraw = async (page: Page): Promise<void> => {
  const ghost = page.locator('#hand .slot.ghost .card');
  await expect(ghost).toHaveCount(1);
  await ghost.click();
  await expect(page.locator('#hand .slot.ghost')).toHaveCount(0);
  await expect(page.locator('#hand .card')).toHaveCount(11);
};

/** Select the first card that may be discarded and discard it; returns the card id. */
export const ginDiscardFirstFree = async (page: Page): Promise<string> => {
  await expect(page.locator('#hand')).toHaveClass(/active/);
  await expect(page.locator('#hand .card')).toHaveCount(11);
  const id = await page.locator('#hand .card:not(.locked)').first().getAttribute('data-card');
  if (id === null) throw new Error('the hand shows a card without data-card');
  const card = page.locator(`#hand .card[data-card="${id}"]`);
  await card.click();
  await expect(card).toHaveClass(/selected/);
  const discard = page.locator('#actions [data-act="discard"]');
  await expect(discard).toBeEnabled();
  await discard.click();
  await expect(page.locator('#hand .card')).toHaveCount(10);
  return id;
};

/** Take the upcard: it lands in the ghost slot, locked, until it is accepted. */
export const ginTakeUpcard = async (page: Page): Promise<void> => {
  const take = page.locator('#actions [data-act="takeUpcard"]');
  await expect(take).toBeVisible();
  await take.click();
  await expect(page.locator('#hand .slot.ghost.shown .card.locked')).toHaveCount(1);
};

export type HandGeometry = Readonly<{
  sizes: ReadonlyArray<string>;
  tops: ReadonlyArray<number>;
  /** The rounded tops of each `.group`'s slots, in DOM order. */
  groups: ReadonlyArray<ReadonlyArray<number>>;
  dataRows: string | null;
  handFits: boolean;
}>;
const HAND_GEOMETRY = `(() => {
  const rect = (el) => el.getBoundingClientRect();
  const tenth = (n) => Math.round(n * 10) / 10;
  const slots = Array.from(document.querySelectorAll('#hand .slot')).map(rect);
  const hand = document.getElementById('hand');
  return {
    sizes: Array.from(new Set(slots.map((r) => tenth(r.width) + 'x' + tenth(r.height)))),
    tops: slots.map((r) => Math.round(r.top)),
    groups: Array.from(document.querySelectorAll('#hand .group')).map((g) => Array.from(g.querySelectorAll('.slot')).map((s) => Math.round(rect(s).top))),
    dataRows: hand.getAttribute('data-rows'),
    handFits: hand.scrollHeight <= hand.clientHeight + 1,
  };
})()`;

/**
 * The hand grid as docs/design/gin-arrangement-and-discards.md §6 lays it out: eleven cells of
 * one size, a meld never split across rows (a run of seven or more wraps inside its own cell on a
 * phone, into as few rows as it needs), no row wider than `columns`, one row on the laptop, and
 * on a phone the two or three rows `#hand[data-rows]` announces. Returns the row count.
 */
/** `cells`: eleven, less one per card the defender laid off onto the knocker's melds (§7b). */
export const expectHandRows = async (page: Page, columns: 6 | 11, cells = 11): Promise<number> => {
  const g = await page.evaluate<HandGeometry>(HAND_GEOMETRY);
  expect(g.tops, `${String(cells)} cells`).toHaveLength(cells);
  expect(g.sizes, 'one cell size').toHaveLength(1);
  expect(g.handFits, '#hand scrolls').toBe(true);
  g.groups.forEach((tops, i) => {
    expect(new Set(tops).size, `group ${String(i)} spans rows`).toBe(
      Math.ceil(tops.length / columns),
    );
  });
  const perRow = g.tops.reduce<ReadonlyMap<number, number>>(
    (m, t) => new Map([...m, [t, (m.get(t) ?? 0) + 1] as const]),
    new Map<number, number>(),
  );
  perRow.forEach((n, top) => {
    expect(n, `the row at ${String(top)} holds ${String(n)} cells`).toBeLessThanOrEqual(columns);
  });
  const rows = perRow.size;
  if (columns === 11) expect(rows, 'one row on the laptop').toBe(1);
  else {
    expect([2, 3], 'phone rows').toContain(rows);
    expect(g.dataRows, 'data-rows').toBe(String(rows));
  }
  return rows;
};

/** Hold the pointer on a card past the long-press timer: a meld with it by hand, or that meld dissolved. */
export const ginLongPress = async (page: Page, cardId: string): Promise<void> => {
  const card = page.locator(`#hand .card[data-card="${cardId}"]`);
  const box = await card.boundingBox();
  if (box === null) throw new Error(`card ${cardId} has no box`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
};

/**
 * One legal turn from the draw phase: draw from the stock, accept the card from the ghost slot
 * (the owner's two-tap flow), then discard. Returns the discarded id.
 */
export const ginDrawAndDiscard = async (page: Page): Promise<string> => {
  const stock = page.locator('#stockPile');
  await expect(stock).toHaveClass(/tappable/);
  await stock.click();
  await expect(page.locator('#hand .slot.ghost.shown .card.fresh')).toHaveCount(1);
  await ginAcceptDraw(page);
  return ginDiscardFirstFree(page);
};

/** One legal first turn: take the upcard (it stays locked), accept it, then discard another card. */
export const ginTakeUpcardAndDiscard = async (page: Page): Promise<string> => {
  await ginTakeUpcard(page);
  await ginAcceptDraw(page);
  return ginDiscardFirstFree(page);
};
