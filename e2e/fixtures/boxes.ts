// Bounding boxes as the geometry specs compare them (docs/design/gin-draw-ghost-slot.md §8,
// docs/design/gin-arrangement-and-discards.md §11): a card or a cell is where it was to half a
// pixel, and a drawn card sits inside the ghost cell. gin-draw, gin-discard and gin-geometry share
// these so the owner's "no cards would move" sentence is one assertion.
import { expect, type Page } from '@playwright/test';

export type Box = Readonly<{ x: number; y: number; w: number; h: number }>;
export type Boxes = Readonly<Record<string, Box>>;

// The box of the first element `selector` finds, or null.
export const boxOf = (selector: string): string =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el === null) return null;
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;

// `data-card -> box` of the held cards (the ghost cell's card excluded).
const HELD_BOXES = `Object.fromEntries(Array.from(document.querySelectorAll('#hand .slot:not(.ghost) .card')).map((c) => {
  const r = c.getBoundingClientRect();
  return [c.getAttribute('data-card'), { x: r.x, y: r.y, w: r.width, h: r.height }];
}))`;
// `data-card -> slot box` of every slot holding a card: the cell, not the card (a selection lifts the card).
const SLOT_BOXES = `Object.fromEntries(Array.from(document.querySelectorAll('#hand .slot')).flatMap((s) => {
  const c = s.querySelector('.card');
  if (c === null) return [];
  const r = s.getBoundingClientRect();
  return [[c.getAttribute('data-card'), { x: r.x, y: r.y, w: r.width, h: r.height }]];
}))`;

export const heldBoxes = (page: Page): Promise<Boxes> => page.evaluate<Boxes>(HELD_BOXES);
export const slotBoxes = (page: Page): Promise<Boxes> => page.evaluate<Boxes>(SLOT_BOXES);
export const ghostBox = (page: Page): Promise<Box | null> =>
  page.evaluate<Box | null>(boxOf('#hand .slot.ghost'));

// `boxes` without the card `id`.
export const omit = (boxes: Boxes, id: string | null): Boxes =>
  Object.fromEntries(Object.entries(boxes).filter(([card]) => card !== id));

// Every recorded card is still exactly where it was (half a pixel of tolerance for rounding).
export const expectSameBoxes = (after: Boxes, before: Boxes, when = ''): void => {
  const at = when === '' ? '' : `${when}: `;
  expect(Object.keys(after).sort(), `${at}the cards`).toEqual(Object.keys(before).sort());
  Object.entries(before).forEach(([id, box]) => {
    const now = after[id];
    expect(now, `${at}card ${id} left the hand`).toBeDefined();
    if (now === undefined) return;
    (['x', 'y', 'w', 'h'] as const).forEach((side) => {
      expect(
        Math.abs(now[side] - box[side]),
        `${at}card ${id} moved (${side})`,
      ).toBeLessThanOrEqual(0.5);
    });
  });
};

// `inner` lies inside `outer` (the drawn card inside the ghost cell).
export const expectInside = (inner: Box | null, outer: Box | null): void => {
  expect(inner).not.toBeNull();
  expect(outer).not.toBeNull();
  if (inner === null || outer === null) return;
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.5);
  expect(inner.x + inner.w).toBeLessThanOrEqual(outer.x + outer.w + 0.5);
  expect(inner.y + inner.h).toBeLessThanOrEqual(outer.y + outer.h + 0.5);
};
