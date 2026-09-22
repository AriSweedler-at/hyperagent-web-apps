import { describe, expect, test } from 'vitest';

import { makeCard } from '../../engine/cards.ts';
import { cardHtml } from '../cards.ts';
import type { DrawStage } from './draw.ts';
import { defaultHandView, type HandModel } from './HandView.ts';
import type { Picture } from './picture.ts';
import { SLOT_COUNT, groupClass, slotHandView } from './SlotHandView.ts';

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

/** The ten cards as cells: two groups of three, then four loose slots, `card` rendering each one. */
const tenSlots = (card: (c: (typeof ten)[number]) => string): string =>
  `<div class="group n3"><div class="slot m0 head">${card(as)}</div><div class="slot m0">${card(ah)}</div><div class="slot m0 tail">${card(ad)}</div></div>` +
  `<div class="group n3"><div class="slot m1 head">${card(s5)}</div><div class="slot m1">${card(s6)}</div><div class="slot m1 tail">${card(s7)}</div></div>` +
  dead.map((c) => `<div class="slot dead">${card(c)}</div>`).join('');
const plain = (c: (typeof ten)[number]): string => cardHtml(c);
const OPEN = '<div class="slot ghost open"></div>';

/** The eleven-card view after a draw, as the engine would re-meld it (the jack joins nothing here). */
const eleven = (over: Partial<HandModel> = {}, me: Partial<HandModel['me']> = {}): HandModel =>
  model(
    { phase: 'discard', lastDrawnId: 'JH', ...over },
    { hand: [...ten, jh], melds: [set, run], deadwood: [...dead, jh], deadwoodValue: 43, ...me },
  );
/** The picture before the draw: what the ten slots keep showing while the jack sits in the ghost cell. */
const before: Picture = { groups: [set, run], loose: dead, human: [] };

describe('slotHandView.render', () => {
  test('ten cards in cells (a group per meld with head, tail and colour; dead for the loose) and the open ghost on my draw', () => {
    expect(slotHandView.render(model(), null)).toBe(`${tenSlots(plain)}${OPEN}`);
    expect(slotHandView.render(model({ phase: 'upcard' }), null)).toContain(OPEN);
    expect(slotHandView.render(model(), null).match(/<div class="slot /g)).toHaveLength(SLOT_COUNT);
    expect(groupClass(4)).toBe('group n4');
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

  test('waiting: the pending cell, the ten cards as they were', () => {
    const stage: DrawStage = { kind: 'waiting', from: 'stock' };
    expect(slotHandView.render(model(), null, stage)).toBe(
      `${tenSlots(plain)}<div class="slot ghost pending"></div>`,
    );
  });

  test('shown from the stock: the kept ten, the fresh card in the ghost slot, no lock', () => {
    const stage: DrawStage = { kind: 'shown', from: 'stock', cardId: 'JH' };
    expect(slotHandView.render(eleven(), null, stage, before)).toBe(
      `${tenSlots(plain)}<div class="slot ghost shown">${cardHtml(jh, { fresh: true })}</div>`,
    );
  });

  test('shown from the discard pile: the ghost card is fresh and locked', () => {
    const stage: DrawStage = { kind: 'shown', from: 'discard', cardId: 'JH' };
    expect(slotHandView.render(eleven({ drawnFromDiscard: 'JH' }), null, stage, before)).toBe(
      `${tenSlots(plain)}<div class="slot ghost shown">${cardHtml(jh, { fresh: true, locked: true })}</div>`,
    );
  });

  test('the picture wins over the view: the eleven-card re-meld does not move the ten', () => {
    const stage: DrawStage = { kind: 'shown', from: 'stock', cardId: 'JH' };
    // The engine's own arrangement of the eleven: one big deadwood group, nothing melded.
    const remelded = eleven({}, { melds: [], deadwood: [...ten, jh] });
    expect(slotHandView.render(remelded, null, stage, before)).toBe(
      slotHandView.render(eleven(), null, stage, before),
    );
    // Without a picture the engine's arrangement paints, the drawn card left out: eleven dead
    // slots become ten and the ghost cell.
    expect(slotHandView.render(remelded, null, stage)).toBe(
      ten.map((c) => `<div class="slot dead">${cardHtml(c)}</div>`).join('') +
        `<div class="slot ghost shown">${cardHtml(jh, { fresh: true })}</div>`,
    );
    // Without a stage or a picture the view's own arrangement paints: eleven dead slots, no ghost.
    expect(slotHandView.render(remelded, null)).toBe(
      [...ten, jh]
        .map((c) => `<div class="slot dead">${cardHtml(c, { fresh: c.id === 'JH' })}</div>`)
        .join(''),
    );
  });

  test('a shown stage naming a card the hand no longer holds falls back to the open cell', () => {
    const stage: DrawStage = { kind: 'shown', from: 'stock', cardId: 'ZZ' };
    expect(slotHandView.render(model({ phase: 'discard' }), null, stage)).toBe(
      `${tenSlots(plain)}${OPEN}`,
    );
  });

  test('accepted with a kept picture: the drawn card is the last loose cell, the dot on it, no ghost', () => {
    const kept: Picture = { groups: [set, run], loose: [...dead, jh], human: [] };
    const html = slotHandView.render(eleven(), null, null, kept);
    expect(html).toBe(
      tenSlots(plain) + `<div class="slot dead">${cardHtml(jh, { fresh: true })}</div>`,
    );
    expect(html).not.toContain('ghost');
    expect(html.match(/<div class="slot /g)).toHaveLength(SLOT_COUNT);
    expect(html.match(/data-card=/g)).toHaveLength(11);
  });

  test('a group a discard broke stays in place with dead cells and no rounding; the colours still count it', () => {
    const broken: Picture = { groups: [[as, ah], run], loose: dead, human: [] };
    const html = slotHandView.render(
      model({}, { hand: [as, ah, ...run, ...dead] }),
      null,
      null,
      broken,
    );
    expect(
      html.startsWith(
        `<div class="group n2"><div class="slot dead">${cardHtml(as)}</div><div class="slot dead">${cardHtml(ah)}</div></div>`,
      ),
    ).toBe(true);
    expect(html).toContain(`<div class="group n3"><div class="slot m1 head">${cardHtml(s5)}</div>`);
  });

  test('the colours cycle over the groups: the sixth meld wraps back to m0', () => {
    const kings = [k, makeCard(13, 'D'), makeCard(13, 'H')];
    const six: Picture = { groups: [set, run, kings, set, run, kings], loose: [], human: [] };
    const html = slotHandView.render(model(), null, null, six);
    expect(html).toContain(`<div class="group n3"><div class="slot m4 head">${cardHtml(s5)}</div>`);
    expect(html).toContain(`<div class="group n3"><div class="slot m0 head">${cardHtml(k)}</div>`);
    expect(html.match(/<div class="group n3">/g)).toHaveLength(6);
  });

  test('a hand-made meld marks its slots human; a loose card never is', () => {
    const mine: Picture = { groups: [set, run], loose: dead, human: ['5S', '6S', '7S'] };
    const html = slotHandView.render(model(), null, null, mine);
    expect(html).toContain(
      `<div class="group n3"><div class="slot m1 head human">${cardHtml(s5)}</div><div class="slot m1 human">${cardHtml(s6)}</div><div class="slot m1 tail human">${cardHtml(s7)}</div></div>`,
    );
    expect(html).toContain(`<div class="slot m0 head">${cardHtml(as)}</div>`);
    expect(html.match(/ human"/g)).toHaveLength(3);
  });

  test('selection, fresh and locked marks on held cards; the selection is suppressed while a stage shows', () => {
    const discarding = eleven({ drawnFromDiscard: 'KC' });
    const html = slotHandView.render(discarding, 'AS');
    expect(html).toContain('class="card black selected" data-card="AS"');
    expect(html).toContain('class="card red fresh" data-card="JH"');
    expect(html).toContain('class="card black locked" data-card="KC"');
    const stage: DrawStage = { kind: 'shown', from: 'stock', cardId: 'JH' };
    expect(slotHandView.render(discarding, 'AS', stage, before)).not.toContain('selected');
    // Locked only while discarding on my turn, as the default view has it.
    expect(slotHandView.render(model({ drawnFromDiscard: 'KC' }), null)).not.toContain('locked');
  });

  test('the default view ignores the stage and the picture: its legacy golden is unaffected', () => {
    const stage: DrawStage = { kind: 'shown', from: 'stock', cardId: 'JH' };
    expect(defaultHandView.render(eleven(), 'AS', stage, before)).toBe(
      defaultHandView.render(eleven(), 'AS'),
    );
  });
});
