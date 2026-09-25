import { describe, expect, test } from 'vitest';

import { now } from '../../../../test/shared/engine-helpers.ts';
import { mulberry32 } from '../../../shared/lib/rng.ts';
import { applyAction, bestMelding, idsOf, viewFor } from './engine/index.ts';
import type { Cards, State } from './engine/index.ts';
import {
  PRESETS,
  cardOfId,
  cardsOfText,
  dealMap,
  formatMap,
  mapOf,
  parseMap,
  presetById,
  randomMap,
  unlocksSandbox,
} from './sandbox.ts';
import { phoneRows } from './ui/hand/picture.ts';

const PLAYERS = [
  { id: 'p1', name: 'sandbox' },
  { id: 'p2', name: 'Bob' },
] as const;

const TWO_HANDS =
  'p1: AS 3H 5D 7C 9S JH KD 2C 4H 8S\np2: 2D 4S 6H 8C 10S QD KH 3C 5S 7D\ndiscard: 6C';

/** `parseMap` must succeed here; the value. */
const mapOfText = (text: string): ReturnType<typeof parseMap> & { ok: true } => {
  const r = parseMap(text);
  if (!r.ok) throw new Error(r.error);
  return r;
};
const deal = (text: string): State => dealMap(mapOfText(text).value, PLAYERS, now);
const ids = (cards: Cards): string => idsOf(cards).join(' ');

describe('cards', () => {
  test('cardOfId reads the engine ids in any case, T for ten; anything else is null', () => {
    expect(cardOfId('AS')).toEqual({ id: 'AS', r: 1, s: 'S' });
    expect(cardOfId('10h')).toEqual({ id: '10H', r: 10, s: 'H' });
    expect(cardOfId('td')?.id).toBe('10D');
    expect(cardOfId(' qC ')?.id).toBe('QC');
    expect(['1S', 'AX', '', 'S', '11H'].map(cardOfId)).toEqual([null, null, null, null, null]);
    expect(ids(cardsOfText('AS 2S  3S'))).toBe('AS 2S 3S');
    expect(() => cardsOfText('AS ZZ')).toThrow('bad card id ZZ');
  });

  test('the sandbox unlocks on the first name "sandbox", spelled any way', () => {
    expect(unlocksSandbox('sandbox')).toBe(true);
    expect(unlocksSandbox('  SandBox ')).toBe(true);
    expect(unlocksSandbox('Ari')).toBe(false);
    expect(unlocksSandbox('')).toBe(false);
  });
});

describe('parseMap', () => {
  test('two hands and a pile: the rest of the deck goes to the stock in deck order, defaults fill in', () => {
    const map = mapOfText(`# a comment\n${TWO_HANDS}\n\n`).value;
    expect(ids(map.hands[0])).toBe('AS 3H 5D 7C 9S JH KD 2C 4H 8S');
    expect(ids(map.hands[1])).toBe('2D 4S 6H 8C 10S QD KH 3C 5S 7D');
    expect(ids(map.discard)).toBe('6C');
    expect(map.stock).toHaveLength(52 - 21);
    expect(ids(map.stock.slice(0, 4))).toBe('2S 3S 6S 7S');
    expect(map).toMatchObject({ turn: 0, phase: 'draw', drawn: null, melds: [], target: 100 });
    // Every card once.
    const all = [...map.hands[0], ...map.hands[1], ...map.discard, ...map.stock];
    expect(new Set(idsOf(all)).size).toBe(52);
  });

  test('the stock names its top first; the named cards come before the rest', () => {
    const map = mapOfText(`${TWO_HANDS}\nstock: KC QC`).value;
    expect(ids(map.stock.slice(0, 3))).toBe('KC QC 2S');
    // The engine keeps the top last: the first listed card is the next draw.
    const drew = applyAction(
      deal(`${TWO_HANDS}\nstock: KC QC`),
      0,
      { type: 'drawStock' },
      mulberry32(1),
      now,
    );
    expect(drew.ok && drew.value.lastDrawn).toEqual({ p: 0, id: 'KC' });
  });

  test('keys in any case, a turn, a phase, a target, and hand-made melds', () => {
    const map = mapOfText(
      'P1: AS 2S 3S 7H 7D 7C 9S 10D QH KC\nP2: 4S 5S 6S 8H 8D 8C 9D JD QD 2C\nDiscard: 5H\nTurn: P2\nPhase: Upcard\nTarget: 50\nMelds: 7H 7D 7C | AS 2S 3S',
    ).value;
    expect(map).toMatchObject({ turn: 1, phase: 'upcard', target: 50 });
    expect(map.melds.map(ids)).toEqual(['7H 7D 7C', 'AS 2S 3S']);
  });

  test('eleven cards for the turn player in the discard phase, with the drawn card marked', () => {
    const map = mapOfText(
      'p1: AS 2S 3S 7H 7D 7C 9S 10D QH KC 4D\np2: 4S 5S 6S 8H 8D 8C 9D JD QD 2C\nphase: discard\ndrawn: 4D',
    ).value;
    expect(map.hands[0]).toHaveLength(11);
    expect(map.drawn?.id).toBe('4D');
    expect(map.discard).toEqual([]);
  });

  test('says what is wrong, first thing first', () => {
    const errorOf = (text: string): string => {
      const r = parseMap(text);
      return r.ok ? 'ok' : r.error;
    };
    expect(errorOf('hello')).toBe(
      'Unknown line "hello": the keys are p1, p2, discard, stock, turn, phase, drawn, melds, target',
    );
    expect(errorOf(`${TWO_HANDS}\np1: AS`)).toBe('"p1" is given twice');
    expect(errorOf('p1: AS ZZ')).toBe('p1: "ZZ" is not a card (AS, 10H, QD…)');
    expect(errorOf(`${TWO_HANDS}\nturn: me`)).toBe('turn: p1 or p2');
    expect(errorOf(`${TWO_HANDS}\nphase: knock`)).toBe('phase: upcard, draw or discard');
    expect(errorOf(`${TWO_HANDS}\nstock: 6C`)).toBe('"6C" appears twice');
    expect(errorOf('p1: AS 2S\np2: 3S 4S\ndiscard: 5S')).toBe('p1 needs 10 cards, has 2');
    expect(errorOf('p1: AS 3H 5D 7C 9S JH KD 2C 4H 8S\np2: 2D 4S 6H 8C 10S QD KH 3C 5S 7D')).toBe(
      'discard: the upcard and draw phases need a card on the pile',
    );
    expect(errorOf(`${TWO_HANDS}\ndrawn: AS`)).toBe(
      'drawn: "AS" must be in the turn player\'s hand, in the discard phase',
    );
    expect(errorOf(`${TWO_HANDS}\ndrawn: ZZ`)).toBe('drawn: "ZZ" is not a card');
    expect(errorOf(`${TWO_HANDS}\nmelds: AS 2D`)).toBe('melds: "2D" is not in p1\'s hand');
    expect(errorOf(`${TWO_HANDS}\ntarget: lots`)).toBe('target: a positive whole number');
    expect(errorOf(`${TWO_HANDS}\ntarget: 0`)).toBe('target: a positive whole number');
  });
});

describe('dealMap, mapOf and formatMap', () => {
  test('the dealt state plays: a draw phase draws, an upcard phase passes, a discard phase discards', () => {
    const drawing = deal(TWO_HANDS);
    expect(drawing).toMatchObject({ turn: 0, phase: 'draw', dealer: 1, handNumber: 1 });
    expect(applyAction(drawing, 0, { type: 'drawDiscard' }, mulberry32(1), now).ok).toBe(true);
    const deciding = deal(`${TWO_HANDS}\nphase: upcard\nturn: p2`);
    expect(deciding).toMatchObject({ turn: 1, dealer: 0, upcardStage: 'nonDealer' });
    expect(applyAction(deciding, 1, { type: 'passUpcard' }, mulberry32(1), now).ok).toBe(true);
    const discarding = deal(
      'p1: AS 3H 5D 7C 9S JH KD 2C 4H 8S 6C\np2: 2D 4S 6H 8C 10S QD KH 3C 5S 7D\nphase: discard\ndrawn: 6C',
    );
    const view = viewFor(discarding, 0);
    expect(view).toMatchObject({
      phase: 'discard',
      isMyTurn: true,
      lastDrawnId: '6C',
      canUndo: false,
    });
    expect(
      applyAction(discarding, 0, { type: 'discard', cardId: '6C' }, mulberry32(1), now).ok,
    ).toBe(true);
  });

  test('a state reads back as the map it was dealt from, and the text round-trips', () => {
    const text = `${TWO_HANDS}\nstock: KC QC\nturn: p2\nphase: upcard\ntarget: 75`;
    const map = mapOfText(text).value;
    const back = mapOf(dealMap(map, PLAYERS, now));
    expect(back).toEqual(map);
    expect(parseMap(formatMap(map))).toEqual({ ok: true, value: map });
    // The drawn card and the hand-made melds print too.
    const marked = mapOfText(
      'p1: AS 3H 5D 7C 9S JH KD 2C 4H 8S 6C\np2: 2D 4S 6H 8C 10S QD KH 3C 5S 7D\nphase: discard\ndrawn: 6C\nmelds: AS 2C',
    ).value;
    expect(formatMap(marked)).toContain('drawn: 6C\nmelds: AS 2C\n');
    expect(parseMap(formatMap(marked))).toEqual({ ok: true, value: marked });
    expect(mapOf(dealMap(marked, PLAYERS, now))).toEqual({ ...marked, melds: [] });
  });

  test('randomMap deals every card once, ten each and the upcard, the same for the same seed', () => {
    const map = randomMap(mulberry32(5));
    expect(map.hands[0]).toHaveLength(10);
    expect(map.hands[1]).toHaveLength(10);
    expect(map.discard).toHaveLength(1);
    expect(map.stock).toHaveLength(31);
    const all = [...map.hands[0], ...map.hands[1], ...map.discard, ...map.stock];
    expect(new Set(idsOf(all)).size).toBe(52);
    expect(randomMap(mulberry32(5))).toEqual(map);
    expect(randomMap(mulberry32(6))).not.toEqual(map);
  });
});

describe('the presets', () => {
  const hand = (id: string): Cards => mapOfText(presetById(id)?.map ?? '').value.hands[0];

  test('unique ids, each a title and a map that parses', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    PRESETS.forEach((p) => {
      expect(p.title.length, p.id).toBeGreaterThan(10);
      expect(parseMap(p.map).ok, p.id).toBe(true);
    });
    expect(presetById('nope')).toBeNull();
  });

  test('each exercises what its title says', () => {
    const melds = (id: string): number => bestMelding(hand(id)).melds.length;
    expect(melds('no-melds')).toBe(0);
    expect(melds('one-set')).toBe(1);
    expect(melds('one-run')).toBe(1);
    expect(melds('set-and-run')).toBe(2);
    expect(melds('knock-ready')).toBe(3);
    expect(bestMelding(hand('knock-ready')).value).toBe(5);
    // Gin: knock with the 2C from the discard phase.
    const ginState = deal(presetById('gin-in-hand')?.map ?? '');
    const knocked = applyAction(ginState, 0, { type: 'knock', cardId: '2C' }, mulberry32(1), now);
    expect(knocked.ok && knocked.value.result?.void === false && knocked.value.result.outcome).toBe(
      'gin',
    );
    // Two ways with a tie: the engine offers both arrangements.
    expect(viewFor(deal(presetById('two-ways-tie')?.map ?? ''), 0).meldOptions.length).toBe(2);
    // Two ways without one: the run beats the set of four, so one arrangement is offered.
    expect(melds('four-eights')).toBe(2);
    expect(viewFor(deal(presetById('four-eights')?.map ?? ''), 0).meldOptions.length).toBe(1);
    // A run of seven, made by hand so the solver cannot split it, wraps: three rows on a phone.
    const seven = mapOfText(presetById('seven-run')?.map ?? '').value;
    expect(seven.melds.map((m) => m.length)).toEqual([7]);
    const kings = seven.hands[0].filter((c) => c.r === 13);
    expect(phoneRows({ groups: [...seven.melds, kings], loose: [], human: [] })).toBe(3);
    // The six-run loses to a set and a five-run.
    expect(
      bestMelding(hand('six-run-or-set'))
        .melds.map((m) => m.length)
        .sort(),
    ).toEqual([3, 5]);
    // The hand-made set stands in the map.
    expect(mapOfText(presetById('hand-made-set')?.map ?? '').value.melds.map(ids)).toEqual([
      '7S 7H 7D',
    ]);
  });
});
