import { describe, expect, test } from 'vitest';

import { makeCard } from '../../engine/cards.ts';
import { cardHtml } from '../cards.ts';
import type { DrawStage, HandHold } from './draw.ts';
import { defaultHandView, type HandModel } from './HandView.ts';
import { SLOT_COUNT, slotHandView } from './SlotHandView.ts';

const [as, ah, ad, s5, s6, s7, k, q, d9, c2, jh] = [
  makeCard(1, 'S'),
  makeCard(1, 'H'),
  makeCard(1, 'D'),
  makeCard(5, 'S'),
  makeCard(6, 'S'),
  makeCard(7, 'S'),
  makeCard(13, 'C'),
  makeCard(12, 'H'),
  makeCard(9, 'D'),
  makeCard(2, 'C'),
  makeCard(11, 'H'),
];
const set = [as, ah, ad];
const run = [s5, s6, s7];
const dead = [k, q, d9, c2];
const ten = [...set, ...run, ...dead];

const model = (over: Partial<HandModel> = {}, me: Partial<HandModel['me']> = {}): HandModel => ({
  me: {
    idx: 0,
    id: 'p1',
    name: 'Ann',
    total: 0,
    hand: ten,
    melds: [set, run],
    deadwood: dead,
    deadwoodValue: 33,
    ...me,
  },
  phase: 'draw',
  isMyTurn: true,
  lastDrawnId: null,
  drawnFromDiscard: null,
  ...over,
});

/** The ten cards as slots, `card` rendering each one. */
const tenSlots = (card: (c: (typeof ten)[number]) => string): string =>
  `<div class="slot m0 head">${card(as)}</div><div class="slot m0">${card(ah)}</div><div class="slot m0 tail">${card(ad)}</div>` +
  `<div class="slot m1 head">${card(s5)}</div><div class="slot m1">${card(s6)}</div><div class="slot m1 tail">${card(s7)}</div>` +
  dead.map((c) => `<div class="slot dead">${card(c)}</div>`).join('');
const plain = (c: (typeof ten)[number]): string => cardHtml(c);

const hold: HandHold = { melds: [set, run], deadwood: dead };
/** The eleven-card view after a draw, as the engine would re-meld it (the jack joins nothing here). */
const eleven = (over: Partial<HandModel> = {}, me: Partial<HandModel['me']> = {}): HandModel =>
  model(
    { phase: 'discard', lastDrawnId: 'JH', ...over },
    { hand: [...ten, jh], melds: [set, run], deadwood: [...dead, jh], deadwoodValue: 43, ...me },
  );

describe('slotHandView.render', () => {
  test('ten cards in slots (head, tail and colour per meld, dead for deadwood) and the open ghost on my draw', () => {
    expect(slotHandView.render(model(), null)).toBe(
      `${tenSlots(plain)}<div class="slot ghost open"></div>`,
    );
    expect(slotHandView.render(model({ phase: 'upcard' }), null)).toContain(
      '<div class="slot ghost open"></div>',
    );
    expect(slotHandView.render(model(), null).match(/<div class="slot /g)).toHaveLength(SLOT_COUNT);
  });

  test('the ghost is hidden but kept on their turn, while I discard without a stage, and between hands', () => {
    expect(slotHandView.render(model({ isMyTurn: false }), null)).toBe(
      `${tenSlots(plain)}<div class="slot ghost"></div>`,
    );
    expect(slotHandView.render(model({ phase: 'discard' }), null)).toContain(
      '<div class="slot ghost"></div>',
    );
    expect(slotHandView.render(model({ phase: 'roundOver', isMyTurn: false }), null)).toContain(
      '<div class="slot ghost"></div>',
    );
  });

  test('waiting: the pending cell, the ten cards from the hold', () => {
    const stage: DrawStage = { kind: 'waiting', from: 'stock', hold };
    expect(slotHandView.render(model(), null, stage)).toBe(
      `${tenSlots(plain)}<div class="slot ghost pending"></div>`,
    );
  });

  test('shown from the stock: the held ten from the hold, the fresh card in the ghost slot, no lock', () => {
    const stage: DrawStage = { kind: 'shown', from: 'stock', cardId: 'JH', hold };
    expect(slotHandView.render(eleven(), null, stage)).toBe(
      `${tenSlots(plain)}<div class="slot ghost shown">${cardHtml(jh, { fresh: true })}</div>`,
    );
  });

  test('shown from the discard pile: the ghost card is fresh and locked', () => {
    const stage: DrawStage = { kind: 'shown', from: 'discard', cardId: 'JH', hold };
    expect(slotHandView.render(eleven({ drawnFromDiscard: 'JH' }), null, stage)).toBe(
      `${tenSlots(plain)}<div class="slot ghost shown">${cardHtml(jh, { fresh: true, locked: true })}</div>`,
    );
  });

  test('the hold wins over the view: the eleven-card re-meld does not move the ten', () => {
    const stage: DrawStage = { kind: 'shown', from: 'stock', cardId: 'JH', hold };
    // The engine's own arrangement of the eleven: one big deadwood group, nothing melded.
    const remelded = eleven({}, { melds: [], deadwood: [...ten, jh] });
    expect(slotHandView.render(remelded, null, stage)).toBe(
      slotHandView.render(eleven(), null, stage),
    );
    // Without the stage the view's own arrangement paints: eleven dead slots, no ghost.
    expect(slotHandView.render(remelded, null)).toBe(
      [...ten, jh]
        .map((c) => `<div class="slot dead">${cardHtml(c, { fresh: c.id === 'JH' })}</div>`)
        .join(''),
    );
  });

  test('a shown stage naming a card the hand no longer holds falls back to the open cell', () => {
    const stage: DrawStage = { kind: 'shown', from: 'stock', cardId: 'ZZ', hold };
    expect(slotHandView.render(model({ phase: 'discard' }), null, stage)).toBe(
      `${tenSlots(plain)}<div class="slot ghost open"></div>`,
    );
  });

  test('accepted: eleven card slots, the dot on the drawn card, no ghost cell', () => {
    const html = slotHandView.render(eleven(), null);
    expect(html).toBe(
      tenSlots(plain) + `<div class="slot dead">${cardHtml(jh, { fresh: true })}</div>`,
    );
    expect(html).not.toContain('ghost');
    expect(html.match(/<div class="slot /g)).toHaveLength(SLOT_COUNT);
    expect(html.match(/data-card=/g)).toHaveLength(11);
  });

  test('a one-card group is head and tail; the sixth meld wraps back to m0', () => {
    const one = model(
      {},
      { melds: [[as], [ah], [ad], [s5], [s6], [s7]], deadwood: dead, hand: ten },
    );
    const html = slotHandView.render(one, null);
    expect(html.startsWith(`<div class="slot m0 head tail">${cardHtml(as)}</div>`)).toBe(true);
    expect(html).toContain(`<div class="slot m4 head tail">${cardHtml(s6)}</div>`);
    expect(html).toContain(`<div class="slot m0 head tail">${cardHtml(s7)}</div>`);
  });

  test('selection, fresh and locked marks on held cards; the selection is suppressed while a stage shows', () => {
    const discarding = eleven({ drawnFromDiscard: 'KC' });
    const html = slotHandView.render(discarding, 'AS');
    expect(html).toContain('class="card black selected" data-card="AS"');
    expect(html).toContain('class="card red fresh" data-card="JH"');
    expect(html).toContain('class="card black locked" data-card="KC"');
    const stage: DrawStage = { kind: 'shown', from: 'stock', cardId: 'JH', hold };
    expect(slotHandView.render(discarding, 'AS', stage)).not.toContain('selected');
    // Locked only while discarding on my turn, as the default view has it.
    expect(slotHandView.render(model({ drawnFromDiscard: 'KC' }), null)).not.toContain('locked');
  });

  test('the default view ignores the stage: its legacy golden is unaffected', () => {
    const stage: DrawStage = { kind: 'shown', from: 'stock', cardId: 'JH', hold };
    expect(defaultHandView.render(eleven(), 'AS', stage)).toBe(
      defaultHandView.render(eleven(), 'AS'),
    );
  });
});
