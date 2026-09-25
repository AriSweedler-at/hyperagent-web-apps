// The card-back vocabulary (docs/design/gin-card-backs.md §2; since docs/design/card-packs.md §2.2 a
// view over the shared packs that draw french52): the four presets in the legacy order, the default,
// the guard the console hook and the home read use, and the line a refused value logs under the
// renamed key.
import { describe, expect, test } from 'vitest';

import { CARD_BACKS, DEFAULT_CARD_BACK, badCardBackMsg, isCardBack } from './cardBack.ts';

describe('the card backs', () => {
  test('four presets; the default is one of them', () => {
    expect(CARD_BACKS).toEqual(['default', 'blue-stripe', 'yu-gi-oh', 'empty']);
    expect(isCardBack(DEFAULT_CARD_BACK)).toBe(true);
  });

  test('isCardBack accepts each preset by its exact name and nothing else', () => {
    CARD_BACKS.forEach((b) => {
      expect(isCardBack(b)).toBe(true);
    });
    // `linea` is a card pack, but for an Italian deck: not a gin back.
    ['', 'Default', 'blue_stripe', 'plaid', 'yu-gi-oh ', 'linea'].forEach((v) => {
      expect(isCardBack(v)).toBe(false);
    });
  });

  test('the refusal names the key, quotes the value, keeps the current back and lists the presets', () => {
    expect(badCardBackMsg('plaid')).toBe(
      'ginRummy_cardPack: "plaid" is not a card pack for this deck; kept the current one. One of: default, blue-stripe, yu-gi-oh, empty.',
    );
  });
});
