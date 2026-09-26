// The variant (docs/design/briscola-battle.md §3.3, §3.4, §6): the mixed radix round-trips over
// every index; the seed and the hash make two devices' readings of one trick identical; the rule
// bits follow the trick (the winning suit, a briscola's sparkles, a steal, the value class, the
// last trick's huge freeze); the hook's index reaches every flavour.
import { describe, expect, test } from 'vitest';

import type { Card, Played, TrickRecord } from '../engine/index.ts';
import { trickFacts } from '../engine/index.ts';
import {
  ARITIES,
  VARIANT_COUNT,
  digitsOf,
  flavourOf,
  indexOf,
  variantFrom,
  variantIndex,
  variantOf,
  variantSeed,
} from './variant.ts';

const card = (id: string, r: Card['r'], s: Card['s']): Card => ({ id, r, s });
const play = (seat: 0 | 1, c: Card): Played => ({ seat, card: c });
const trick = (no: number, cards: ReadonlyArray<Played>, winner: 0 | 1): TrickRecord => ({
  no,
  leader: 0,
  cards,
  winner,
  points: 0,
  drew: [winner, winner === 0 ? 1 : 0],
  trumpTaken: false,
});

const AC = card('AC', 1, 'C');
const T3D = card('3D', 3, 'D');
const F7S = card('7S', 7, 'S');
const RB = card('RB', 10, 'B');

describe('the digits', () => {
  test('6480 surfaces, and every index round-trips through its digits', () => {
    expect(VARIANT_COUNT).toBe(6480);
    Array.from({ length: VARIANT_COUNT }, (_, i) => i).forEach((i) => {
      const d = digitsOf(i);
      expect(d).toHaveLength(ARITIES.length);
      d.forEach((digit, k) => {
        expect(digit).toBeLessThan(ARITIES[k] ?? 0);
      });
      expect(indexOf(d)).toBe(i);
    });
  });

  test('every flavour value is reachable from some index', () => {
    const seen = new Set(
      Array.from({ length: VARIANT_COUNT }, (_, i) => flavourOf(i)).flatMap((f) => [
        `dist:${String(f.chargeDist)}`,
        `angle:${String(f.chargeAngle)}:${String(f.chargeSign)}`,
        `tempo:${f.tempo}`,
        `frame:${f.frame}`,
        `pose:${f.pose}`,
        `after:${f.after}`,
        `side:${f.side}`,
      ]),
    );
    expect(seen.size).toBe(3 + 6 + 3 + 2 + 5 + 3 + 2);
  });
});

describe('the seed', () => {
  test('spells startedAt:gameNo:no:cardIds in play order, and the index is inside the range', () => {
    const t = trick(7, [play(0, AC), play(1, T3D)], 0);
    expect(variantSeed(1727280000000, 1, t)).toBe('1727280000000:1:7:AC,3D');
    const idx = variantIndex(variantSeed(1727280000000, 1, t));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(VARIANT_COUNT);
  });

  test("the host's and a guest's readings of one trick are identical, and another trick's differs somewhere", () => {
    const t = trick(3, [play(0, F7S), play(1, RB)], 1);
    const host = variantOf('B', t, 1727280000000, 1);
    const guest = variantOf('B', { ...t }, 1727280000000, 1);
    expect(guest).toEqual(host);
    const other = variantOf('B', trick(4, [play(1, RB), play(0, F7S)], 1), 1727280000000, 1);
    expect(other.index).not.toBe(host.index);
  });
});

describe('the rules', () => {
  test('the winning suit names the frame family; no briscola, no sparkles; a pointless trick freezes 120 and shakes not at all', () => {
    const t = trick(1, [play(0, card('4B', 4, 'B')), play(1, F7S)], 0);
    const v = variantOf('C', t, 0, 1);
    expect(v.suit).toBe('B');
    expect(v.briscola).toBe(false);
    expect(v.sparkle).toBe('none');
    expect(v.freezeMs).toBe(120);
    expect(v.shakePx).toBe(0);
    expect(v.valueClass).toBe('pointless');
  });

  test('a briscola winner sparkles in the hash-picked shape; the asso and the tre make a huge trick', () => {
    const t = trick(2, [play(0, T3D), play(1, AC)], 1);
    const facts = trickFacts('C', t.cards);
    const v = variantFrom(0, facts);
    expect(v.briscola).toBe(true);
    expect(v.sparkle).toBe('ring');
    expect(variantFrom(indexOf([0, 0, 0, 0, 0, 1, 0, 0, 0]), facts).sparkle).toBe('scatter');
    expect(v.valueClass).toBe('huge');
    expect(v.freezeMs).toBe(200);
    expect(v.shakePx).toBe(2);
  });

  test('a briscola taking a led carico is a steal', () => {
    const t = trick(2, [play(0, T3D), play(1, card('2C', 2, 'C'))], 1);
    const v = variantOf('C', t, 0, 1);
    expect(v.steal).toBe(true);
    expect(v.briscola).toBe(true);
  });

  test('the last trick of a hand freezes huge whatever its points', () => {
    const t = trick(20, [play(0, F7S), play(1, RB)], 1);
    expect(variantOf('C', t, 0, 1, true).freezeMs).toBe(200);
    expect(variantOf('C', t, 0, 1, true).valueClass).toBe('huge');
  });
});
