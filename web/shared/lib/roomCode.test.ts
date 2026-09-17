import { describe, expect, test } from 'vitest';

import { err, ok } from './result.ts';
import { mulberry32 } from './rng.ts';
import {
  FIDICE_CODE_ALPHABET,
  FIDICE_CODE_LENGTH,
  FIDICE_CODE_LENGTH_ERROR,
  FIDICE_PEER_PREFIX,
  GIN_CODE_ALPHABET,
  GIN_CODE_LENGTH,
  GIN_CODE_LENGTH_ERROR,
  GIN_PEER_PREFIX,
  ROOM_CODE,
  isWellFormedCode,
  peerIdFor,
  randomCode,
  sanitiseCode,
  validateCode,
  type Game,
} from './roomCode.ts';

const GAMES: ReadonlyArray<Game> = ['gin-rummy', 'fidice'];

describe('frozen literals (byte for byte what the legacy pages hold)', () => {
  test('gin', () => {
    expect(GIN_PEER_PREFIX).toBe('ginrummy-ari-');
    expect(GIN_CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ');
    expect(GIN_CODE_LENGTH).toBe(4);
    expect(GIN_CODE_LENGTH_ERROR).toBe('Enter the 4-letter room code.');
    expect(ROOM_CODE['gin-rummy']).toEqual({
      alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
      length: 4,
      peerPrefix: 'ginrummy-ari-',
      peerCase: 'upper',
      lengthError: 'Enter the 4-letter room code.',
    });
  });

  test('fidice', () => {
    expect(FIDICE_PEER_PREFIX).toBe('fidice-');
    expect(FIDICE_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    expect(FIDICE_CODE_LENGTH).toBe(5);
    expect(FIDICE_CODE_LENGTH_ERROR).toBe('Codes are 5 characters');
    expect(ROOM_CODE.fidice).toEqual({
      alphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
      length: 5,
      peerPrefix: 'fidice-',
      peerCase: 'lower',
      lengthError: 'Codes are 5 characters',
    });
  });

  test('the alphabets leave out the look-alikes and have no repeats', () => {
    expect(GIN_CODE_ALPHABET).not.toMatch(/[IO]/);
    expect(FIDICE_CODE_ALPHABET).not.toMatch(/[ILO01]/);
    expect(new Set(GIN_CODE_ALPHABET).size).toBe(GIN_CODE_ALPHABET.length);
    expect(new Set(FIDICE_CODE_ALPHABET).size).toBe(FIDICE_CODE_ALPHABET.length);
  });
});

describe('randomCode', () => {
  test.each(GAMES)('%s: right length, drawn from the alphabet, seed-deterministic', (game) => {
    const codes = Array.from({ length: 200 }, (_, i) => randomCode(game, mulberry32(i)));
    codes.forEach((code) => {
      expect(code).toHaveLength(ROOM_CODE[game].length);
      expect(isWellFormedCode(game, code)).toBe(true);
    });
    expect(randomCode(game, mulberry32(9))).toBe(randomCode(game, mulberry32(9)));
    expect(new Set(codes).size).toBeGreaterThan(190);
  });

  test('matches the legacy draw: floor(rng * alphabet.length) per character', () => {
    const rng = mulberry32(3);
    const draws = Array.from({ length: 4 }, () => rng());
    const expected = draws
      .map((d) => GIN_CODE_ALPHABET[Math.floor(d * GIN_CODE_ALPHABET.length)])
      .join('');
    expect(randomCode('gin-rummy', mulberry32(3))).toBe(expected);
  });

  test('an rng returning 0 hits the first letter, one just under 1 the last', () => {
    expect(randomCode('gin-rummy', () => 0)).toBe('AAAA');
    expect(randomCode('fidice', () => 1 - Number.EPSILON)).toBe('99999');
  });
});

describe('sanitiseCode (what the legacy input handlers keep)', () => {
  test('gin: upper case, letters only, four at most', () => {
    expect(sanitiseCode('gin-rummy', 'ab1c-d e')).toBe('ABCD');
    expect(sanitiseCode('gin-rummy', 'abcdefg')).toBe('ABCD');
    expect(sanitiseCode('gin-rummy', '')).toBe('');
    expect(sanitiseCode('gin-rummy', 'wxyz')).toBe('WXYZ');
  });

  test('gin: characters outside the alphabet are dropped (I and O too)', () => {
    expect(sanitiseCode('gin-rummy', 'IOAB')).toBe('AB');
  });

  test('fidice: upper case, alphabet characters only, five at most', () => {
    expect(sanitiseCode('fidice', 'ab2c-d3 e')).toBe('AB2CD');
    expect(sanitiseCode('fidice', 'il0o1abcd')).toBe('ABCD');
  });
});

describe('validateCode (what the legacy join buttons check)', () => {
  test('trims and upper-cases, then checks only the length', () => {
    expect(validateCode('gin-rummy', ' abcd ')).toEqual(ok('ABCD'));
    expect(validateCode('gin-rummy', 'abc')).toEqual(err('Enter the 4-letter room code.'));
    expect(validateCode('gin-rummy', 'abcde')).toEqual(err('Enter the 4-letter room code.'));
    expect(validateCode('gin-rummy', '')).toEqual(err('Enter the 4-letter room code.'));
    expect(validateCode('fidice', 'ab2cd')).toEqual(ok('AB2CD'));
    expect(validateCode('fidice', 'abcd')).toEqual(err('Codes are 5 characters'));
  });

  test('legacy accepts letters outside the alphabet as long as the length fits', () => {
    expect(validateCode('gin-rummy', 'IIII')).toEqual(ok('IIII'));
    expect(isWellFormedCode('gin-rummy', 'IIII')).toBe(false);
  });
});

describe('isWellFormedCode', () => {
  test('length and alphabet', () => {
    expect(isWellFormedCode('gin-rummy', 'ABCD')).toBe(true);
    expect(isWellFormedCode('gin-rummy', 'ABC')).toBe(false);
    expect(isWellFormedCode('gin-rummy', 'abcd')).toBe(false);
    expect(isWellFormedCode('fidice', 'AB2C9')).toBe(true);
    expect(isWellFormedCode('fidice', 'AB1C9')).toBe(false);
  });
});

describe('peerIdFor', () => {
  test('gin keeps the code as given after the prefix', () => {
    expect(peerIdFor('gin-rummy', 'ABCD')).toBe('ginrummy-ari-ABCD');
  });

  test('fidice lower-cases the code after the prefix', () => {
    expect(peerIdFor('fidice', 'AB2CD')).toBe('fidice-ab2cd');
    expect(peerIdFor('fidice', 'ab2cd')).toBe('fidice-ab2cd');
  });
});
