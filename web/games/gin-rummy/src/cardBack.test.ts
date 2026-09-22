// The card-back vocabulary (docs/design/gin-card-backs.md §2): the four presets, the default, the
// guard the console hook and the home read use, and the line a refused value logs.
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
    ['', 'Default', 'blue_stripe', 'plaid', 'yu-gi-oh '].forEach((v) => {
      expect(isCardBack(v)).toBe(false);
    });
  });

  test('the refusal names the key, quotes the value, keeps the current back and lists the presets', () => {
    expect(badCardBackMsg('plaid')).toBe(
      'ginRummy_cardBack: "plaid" is not a card back; kept the current one. One of: default, blue-stripe, yu-gi-oh, empty.',
    );
  });
});
