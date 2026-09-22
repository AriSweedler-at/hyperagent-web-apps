import { describe, expect, test } from 'vitest';

import { GAMES, HOOKS, LANDING_HREFS, LEGACY_GAMES, PAGE_TITLES } from './games.ts';

describe('the games registry', () => {
  test('lists the two built games, both with a legacy page', () => {
    expect(GAMES).toEqual(['gin-rummy', 'fidice']);
    expect(LEGACY_GAMES).toEqual(['gin-rummy', 'fidice']);
  });

  test('pins every page title', () => {
    expect(PAGE_TITLES).toEqual({
      landing: "Ari's web apps",
      'gin-rummy': 'Gin Rummy',
      fidice: "Fidice — one-cup liar's dice",
    });
  });

  test('pins every page hook', () => {
    expect(HOOKS).toEqual({ 'gin-rummy': 'window.__gin', fidice: 'window.__fidice' });
  });

  test('the landing hrefs are games/<g>/ in GAMES order', () => {
    expect(LANDING_HREFS).toEqual(['games/gin-rummy/', 'games/fidice/']);
  });
});
