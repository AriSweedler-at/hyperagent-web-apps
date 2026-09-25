// The deck sheet's pure half (ui/deck.ts) over engine positions: a fresh deal for two lays the
// forty in suit rows with the briscola alone gone and thirty-six unseen (three are mine; the toggle
// greys them, it removes nothing); a card laid is gone the moment it lies on the table and a taken
// trick stays gone, so what is unseen is the stock plus the hands I cannot see; a later game's deal
// forgets the earlier game's tricks though the events run on; the three-player deck leaves the
// removed two's cell empty; a hand shown to me and an exchange's take are gone; the briscola drawn
// into my hand is mine, not gone; the key, the count line and the markup in the pack's faces.
import { describe, expect, test } from 'vitest';

import { NOW } from '../../../../../test/shared/engine-helpers.ts';
import { packByName } from '../../../../shared/lib/cards/packs.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import {
  SUITS,
  SUIT_NAME,
  actorOf,
  applyAction,
  cardById,
  createGame,
  deckFor,
  idsOf,
  viewFor,
  type Action,
  type Card,
  type CreateGameOptions,
  type Players,
  type Seat,
  type State,
  type View,
} from '../engine/index.ts';
import { deckHtml, deckKey, deckOf, deckSubText, seenIds, type Deck } from './deck.ts';

const rng = mulberry32(7);
const now = (): number => NOW;
const PAIR: Players = [
  { id: 'p1', name: 'Ann' },
  { id: 'p2', name: 'Bob' },
];
const TRIO: Players = [...PAIR, { id: 'p3', name: 'Cara' }];
const deal = (players: Players = PAIR, opts: CreateGameOptions = {}): State =>
  createGame(players, opts, rng, now);
const act = (s: State, seat: Seat, action: Action): State => {
  const r = applyAction(s, seat, action, rng, now);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
/** The actor lays the first card of its hand. */
const playFirst = (s: State): State => {
  const seat = actorOf(s) ?? s.turn;
  const id = s.hands[seat]?.[0]?.id;
  if (id === undefined) throw new Error('an empty hand');
  return act(s, seat, { type: 'play', cardId: id });
};
const playTrick = (s: State): State =>
  Array.from({ length: s.options.seatCount }).reduce<State>((a) => playFirst(a), s);
const c = (id: string): Card => {
  const card = cardById(id);
  if (card === null) throw new Error(`no card ${id}`);
  return card;
};
const ids = (deck: Deck, pick: (chip: Readonly<{ gone: boolean; mine: boolean }>) => boolean) =>
  deck.rows.flatMap((row) =>
    row.chips.flatMap((chip) => (chip !== null && pick(chip) ? [chip.id] : [])),
  );
const gone = (deck: Deck): ReadonlyArray<string> => ids(deck, (chip) => chip.gone);
const mine = (deck: Deck): ReadonlyArray<string> => ids(deck, (chip) => chip.mine);
const laid = (deck: Deck): ReadonlyArray<string | null> =>
  deck.rows.flatMap((row) => row.chips.map((chip) => chip?.id ?? null));
const linea = packByName('linea');

describe('deckOf', () => {
  test('a fresh deal: the forty in SUITS order by rank, the briscola alone gone, my three mine, thirty-six unseen', () => {
    const v = viewFor(deal(), 0);
    const deck = deckOf(v, false);
    expect(deck.rows.map((row) => row.suit)).toEqual(SUITS);
    expect(deck.rows.every((row) => row.chips.length === 10)).toBe(true);
    expect(laid(deck)).toEqual(idsOf(deckFor(v.options)));
    expect(gone(deck)).toEqual([v.trumpCard.id]);
    expect(new Set(mine(deck))).toEqual(new Set(idsOf(v.me.hand)));
    expect(deck).toMatchObject({ unseen: 36, stock: 34, inHand: 3, withHand: false });
    // The toggle changes nothing of the model but its flag: my cards are still there, still mine.
    const withHand = deckOf(v, true);
    expect(withHand).toEqual({ ...deck, withHand: true });
    expect(deckSubText(deck)).toBe('36 unseen · 34 in the stock');
    expect(deckSubText(withHand)).toBe('36 unseen · 34 in the stock · 3 in your hand');
    expect(deckKey(deck)).toMatch(/^deck\|[.xm]{10}(,[.xm]{10}){3}$/);
    expect(deckKey(withHand)).toBe(deckKey(deck).replace(/^deck/, 'hand'));
  });

  test('a card laid is gone for the seat that sees it; a taken trick stays gone; the unseen are the stock and the hands I cannot see', () => {
    const start = deal();
    const one = playFirst(start);
    const [onTable] = one.trick;
    if (onTable === undefined) throw new Error('nothing laid');
    const other = viewFor(one, onTable.seat === 0 ? 1 : 0);
    expect(gone(deckOf(other, false))).toEqual(
      expect.arrayContaining([onTable.card.id, other.trumpCard.id]),
    );
    expect(deckOf(other, false).unseen).toBe(35);
    const taken = playFirst(one);
    expect(taken.trickNo).toBe(1);
    const v = viewFor(taken, 0);
    const deck = deckOf(v, false);
    const trick = v.lastTrick?.cards.map((p) => p.card.id) ?? [];
    expect(trick).toHaveLength(2);
    expect(new Set(gone(deck))).toEqual(new Set([...trick, v.trumpCard.id]));
    expect(deck.unseen).toBe(34);
    expect(deck.stock).toBe(32);
    // The stock less the briscola lying in it (seen), plus the three Bob drew up to.
    expect(deck.unseen).toBe(v.stockCount - 1 + (v.others[0]?.handCount ?? 0));
    expect(seenIds(v)).toEqual(new Set([...trick, v.trumpCard.id]));
  });

  test('a game played out leaves nothing unseen; the next deal forgets its tricks though the events run on', () => {
    const over = Array.from({ length: 20 }).reduce<State>((s) => playTrick(s), deal());
    expect(over.phase).toBe('over');
    expect(deckOf(viewFor(over, 0), false)).toMatchObject({ unseen: 0, stock: 0, inHand: 0 });
    const next = act(over, 0, { type: 'next' });
    const v = viewFor(next, 1);
    expect(v.gameNo).toBe(2);
    expect(v.events.filter((e) => e.kind === 'trick')).toHaveLength(20);
    const deck = deckOf(v, false);
    expect(gone(deck)).toEqual([v.trumpCard.id]);
    expect(deck).toMatchObject({ unseen: 36, stock: 34, inHand: 3 });
  });

  test('three players: the removed two leaves its cell empty, so the ranks keep their columns', () => {
    const v = viewFor(deal(TRIO, { removedTwo: 'D' }), 0);
    const deck = deckOf(v, false);
    const denari = deck.rows.find((row) => row.suit === 'D');
    expect(denari?.chips[1]).toBeNull();
    expect(denari?.chips.filter((chip) => chip !== null)).toHaveLength(9);
    expect(laid(deck).filter((id) => id !== null)).toEqual(idsOf(deckFor(v.options)));
    expect(laid(deck)).toHaveLength(40);
    expect(deck).toMatchObject({ unseen: 35, stock: 30, inHand: 3 });
    expect(deckHtml(linea, deck).match(/<span class="dk-out"><\/span>/g)).toHaveLength(1);
  });

  test('a hand shown to me (scoperta) and what an exchange took are gone; the briscola in my hand is mine', () => {
    const v = viewFor(deal(PAIR, { scoperta: true }), 0);
    const shown = idsOf(v.others[0]?.hand ?? []);
    expect(shown).toHaveLength(3);
    const deck = deckOf(v, false);
    expect(new Set(gone(deck))).toEqual(new Set([...shown, v.trumpCard.id]));
    expect(deck.unseen).toBe(33);
    // An exchange on the record: the card it took off the table sits in a hand now.
    const swapped: View = {
      ...v,
      exchanges: [{ seat: 1, gave: c('7B'), took: c('AB') }],
    };
    expect(gone(deckOf(swapped, false))).toContain('AB');
    // The briscola drawn into my hand (or the trump card I swapped in): mine, not gone.
    const [first] = v.me.hand;
    if (first === undefined) throw new Error('an empty hand');
    const drawn: View = { ...v, trumpCard: first, trumpOnTable: false };
    const held = deckOf(drawn, true);
    expect(gone(held)).not.toContain(first.id);
    expect(mine(held)).toContain(first.id);
  });
});

describe('deckHtml', () => {
  test('four rows led by the suit symbol, ten chip faces each in rank order; gone greyed; held only with the toggle', () => {
    const v = viewFor(deal(), 0);
    const html = deckHtml(linea, deckOf(v, false));
    const rows = [...html.matchAll(/<div class="dk-row" role="group" aria-label="([^"]+)">/g)];
    expect(rows.map((m) => m[1])).toEqual(SUITS.map((s) => SUIT_NAME[s]));
    expect([...html.matchAll(/<use href="#suit-([CDSB])"\/>/g)].map((m) => m[1])).toEqual(SUITS);
    const chips = [...html.matchAll(/<div class="card ([^"]*)" data-card="([^"]+)"/g)];
    expect(chips).toHaveLength(40);
    expect(chips.map((m) => m[2])).toEqual(idsOf(deckFor(v.options)));
    expect(chips.every((m) => (m[1] ?? '').split(' ').includes('chip'))).toBe(true);
    const greyed = chips.filter((m) => (m[1] ?? '').endsWith(' chip gone')).map((m) => m[2]);
    expect(greyed).toEqual([v.trumpCard.id]);
    expect(html).not.toContain(' held');
    const withHand = deckHtml(linea, deckOf(v, true));
    const held = [...withHand.matchAll(/ chip held" data-card="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(held)).toEqual(new Set(idsOf(v.me.hand)));
    expect(withHand.match(/ chip gone"/g)).toHaveLength(1);
  });
});
