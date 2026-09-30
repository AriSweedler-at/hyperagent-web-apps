// The settings: the defaults where nothing is stored or a value is malformed, the round trip through
// the store, the query's overrides.
import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import {
  DEFAULT_SETTINGS,
  EXAMPLE_IDS,
  EXAMPLE_LETTERS,
  KEYS,
  clipPretendedFrom,
  exampleIdOf,
  letterOf,
  nextExampleId,
  overridesFrom,
  readSettings,
  writeSetting,
} from './settings.ts';

const memory = (): StorageLike => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
};

describe('settings', () => {
  test('nothing stored: the defaults; every key round-trips; a bad value is the default', () => {
    const store = createStore(memory());
    expect(readSettings(store)).toEqual(DEFAULT_SETTINGS);
    writeSetting(store, 'mode', 'portrait');
    writeSetting(store, 'frame', false);
    writeSetting(store, 'band', 9);
    writeSetting(store, 'color', '#112233');
    writeSetting(store, 'hairline', false);
    writeSetting(store, 'example', 'ears');
    writeSetting(store, 'flip', true);
    expect(readSettings(store)).toEqual({
      mode: 'portrait',
      frame: false,
      band: 9,
      color: '#112233',
      hairline: false,
      example: 'ears',
      flip: true,
    });
    store.writeText(KEYS.band, '99');
    store.writeText(KEYS.color, 'olive');
    store.writeText(KEYS.mode, 'sideways');
    const s = readSettings(store);
    expect(s.band).toBe(6);
    expect(s.color).toBe(DEFAULT_SETTINGS.color);
    expect(s.mode).toBe('auto');
  });

  test('the query overrides what it names and nothing else; a bad value is ignored', () => {
    expect(overridesFrom('?example=rail&frame=off&mode=portrait&flip=on&band=3')).toEqual({
      example: 'rail',
      frame: false,
      mode: 'portrait',
      flip: true,
      band: 3,
    });
    expect(overridesFrom('?example=nope&band=40&mode=x')).toEqual({});
    expect(overridesFrom('')).toEqual({});
    // The letters: `(a)` to `(j)` in the dropdown's order, either case.
    expect(overridesFrom('?example=b')).toEqual({ example: 'side' });
    expect(overridesFrom('?example=I')).toEqual({ example: 'gutters' });
    expect(overridesFrom('?example=j')).toEqual({ example: 'dice' });
    expect(overridesFrom('?example=k')).toEqual({});
    // `?clip=on` alone pretends the clip is published; it is no setting and is never stored.
    expect(clipPretendedFrom('?clip=on')).toBe(true);
    expect(clipPretendedFrom('?clip=off')).toBe(false);
    expect(clipPretendedFrom('')).toBe(false);
    expect(overridesFrom('?clip=on')).toEqual({});
  });

  test('the letters a-j name the ten in order; Next wraps from the last to the first', () => {
    expect(EXAMPLE_LETTERS).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    expect(EXAMPLE_IDS.map(letterOf)).toEqual(EXAMPLE_LETTERS);
    expect(EXAMPLE_LETTERS.map(exampleIdOf)).toEqual(EXAMPLE_IDS);
    expect(exampleIdOf('rail')).toBe('rail');
    expect(exampleIdOf('G')).toBe('rail');
    expect(exampleIdOf('')).toBeNull();
    expect(exampleIdOf('z')).toBeNull();
    expect(EXAMPLE_IDS.map(nextExampleId)).toEqual([...EXAMPLE_IDS.slice(1), EXAMPLE_IDS[0]]);
  });
});
