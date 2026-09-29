// The settings: the defaults where nothing is stored or a value is malformed, the round trip through
// the store, the query's overrides.
import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { DEFAULT_SETTINGS, KEYS, overridesFrom, readSettings, writeSetting } from './settings.ts';

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
  });
});
