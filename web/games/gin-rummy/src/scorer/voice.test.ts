import { describe, expect, test } from 'vitest';

import { extractNumber, parseVoiceScores, wordsToNumber } from './voice.ts';

const ari = { id: 'a', name: 'Ari' };
const jeff = { id: 'j', name: 'Jeff' };
const players = [ari, jeff];

describe('wordsToNumber / extractNumber', () => {
  test.each<[string, number | null]>([
    ['five', 5],
    ['twenty', 20],
    ['twenty-five', 25],
    ['forty two', 42],
    ['fourty', 40],
    ['one hundred', 100],
    ['hundred', 100],
    ['a hundred and five', 105],
    ['two hundred twenty', 220],
    ['oh', 0],
    ['for', 4],
    ['ate', 8],
    ['nothing here', null],
    ['', null],
    ['constructor toString', null],
  ])('%j -> %j', (text, n) => {
    expect(wordsToNumber(text)).toBe(n);
  });

  test('digits win over words', () => {
    expect(extractNumber('knocked with 12 and five')).toBe(12);
    expect(extractNumber('knocked with five')).toBe(5);
    expect(extractNumber('knocked')).toBeNull();
  });
});

describe('parseVoiceScores', () => {
  test('"Ari knocked with five, Jeff twenty"', () => {
    expect(parseVoiceScores('Ari knocked with five, Jeff twenty', players)).toEqual({
      heard: { knockerId: 'a', knockType: 'knock', deadwood: { a: 5, j: 20 } },
      matches: ['Ari: Knock (5)', 'Jeff: 20'],
    });
  });

  test('"Jeff gin, Ari twelve"; a gin zeroes the knocker', () => {
    expect(parseVoiceScores('Jeff gin, Ari twelve', players)).toEqual({
      heard: { knockerId: 'j', knockType: 'gin', deadwood: { j: 0, a: 12 } },
      matches: ['Jeff: Gin', 'Ari: 12'],
    });
  });

  test('"and" and "&" split clauses; a knock without a count; an unknown name is skipped', () => {
    expect(parseVoiceScores('Ari knocked and Jeff 7 & Bob 3', players)).toEqual({
      heard: { knockerId: 'a', knockType: 'knock', deadwood: { j: 7 } },
      matches: ['Ari: Knock', 'Jeff: 7'],
    });
    expect(parseVoiceScores('nobody said anything', players)).toEqual({
      heard: { knockerId: null, knockType: null, deadwood: {} },
      matches: [],
    });
    expect(parseVoiceScores('Ari mumbled', players).matches).toEqual([]);
  });

  test('the longest matching name wins a clause, later clauses overwrite', () => {
    const ps = [
      { id: 'a', name: 'Ann' },
      { id: 'b', name: 'Annie' },
    ];
    expect(parseVoiceScores('Annie 9', ps).heard.deadwood).toEqual({ b: 9 });
    expect(parseVoiceScores('Ann 9, Ann 4', ps).heard.deadwood).toEqual({ a: 4 });
  });
});
