// The shell-path flag and the old path's two URL residues (docs/design/fidice-shell-adoption.md §4
// M4, §6 risks 10, 14, §7 D2), every branch: the three answers of `?shell=`, the query with
// `shell` gone, the legacy invite's rewrite, the legacy name's copy.
import { describe, expect, test } from 'vitest';

import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import {
  LEGACY_NAME_KEY,
  adoptLegacyName,
  legacyInviteUrl,
  shellPathOn,
  withoutShellParam,
} from './flag.ts';
import { STORAGE_KEYS, readName, readShellFlag, writeName, writeShellFlag } from './storage.ts';

const fakeStorage = (): StorageLike & Readonly<{ map: Map<string, string> }> => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
};

describe('shellPathOn', () => {
  test('?shell=1 boots the shell path and is remembered; ?shell=0 boots the old path and is forgotten', () => {
    const s = fakeStorage();
    const store = createStore(s);
    expect(shellPathOn(store, '1')).toBe(true);
    expect(s.map.get(STORAGE_KEYS.shell)).toBe('1');
    expect(readShellFlag(store)).toBe(true);
    expect(shellPathOn(store, '0')).toBe(false);
    expect(s.map.has(STORAGE_KEYS.shell)).toBe(false);
  });

  test('any other query leaves the stored flag: the old path until a device opts in, the shell path after', () => {
    const store = createStore(fakeStorage());
    expect(shellPathOn(store, null)).toBe(false);
    expect(shellPathOn(store, 'yes')).toBe(false);
    writeShellFlag(store, true);
    expect(shellPathOn(store, null)).toBe(true);
    expect(shellPathOn(store, '')).toBe(true);
  });
});

describe('withoutShellParam', () => {
  test('drops shell wherever it sits, keeps the rest, and empties a query of shell alone', () => {
    expect(withoutShellParam('?shell=0')).toBe('');
    expect(withoutShellParam('?shell')).toBe('');
    expect(withoutShellParam('?a=1&shell=0&b=2')).toBe('?a=1&b=2');
    expect(withoutShellParam('?shell=1&peer=127.0.0.1:9000')).toBe('?peer=127.0.0.1:9000');
    expect(withoutShellParam('?shellfish=1')).toBe('?shellfish=1');
    expect(withoutShellParam('')).toBe('');
    expect(withoutShellParam('?')).toBe('');
  });
});

describe('legacyInviteUrl', () => {
  test('#join=CODE becomes ?join=CODE on the same path, upper-cased, after the hooks the query carries', () => {
    expect(legacyInviteUrl({ pathname: '/fidice/', search: '', hash: '#join=abcde' })).toBe(
      '/fidice/?join=ABCDE',
    );
    expect(
      legacyInviteUrl({ pathname: '/games/fidice/', search: '?shell=1', hash: '#join=K7Q2M' }),
    ).toBe('/games/fidice/?shell=1&join=K7Q2M');
  });

  test('any other hash is left alone: none, a rule deep link, a watch link (D6), a code of the wrong shape', () => {
    expect(legacyInviteUrl({ pathname: '/fidice/', search: '', hash: '' })).toBeNull();
    expect(legacyInviteUrl({ pathname: '/fidice/', search: '', hash: '#rule-goal' })).toBeNull();
    expect(legacyInviteUrl({ pathname: '/fidice/', search: '', hash: '#watch=ABCDE' })).toBeNull();
    expect(legacyInviteUrl({ pathname: '/fidice/', search: '', hash: '#join=ABCD' })).toBeNull();
  });
});

describe('adoptLegacyName', () => {
  test('the legacy fidice-name is copied under fidice_name when that key is empty; the old key is kept', () => {
    const s = fakeStorage();
    s.map.set(LEGACY_NAME_KEY, 'Legacy');
    const store = createStore(s);
    adoptLegacyName(store);
    expect(readName(store)).toEqual({ ok: true, value: 'Legacy' });
    expect(s.map.get(LEGACY_NAME_KEY)).toBe('Legacy');
  });

  test('a remembered shell name wins; a blank or missing legacy name copies nothing', () => {
    const s = fakeStorage();
    s.map.set(LEGACY_NAME_KEY, 'Legacy');
    const store = createStore(s);
    writeName(store, 'Ari');
    adoptLegacyName(store);
    expect(readName(store)).toEqual({ ok: true, value: 'Ari' });
    const blank = fakeStorage();
    blank.map.set(LEGACY_NAME_KEY, '   ');
    adoptLegacyName(createStore(blank));
    expect(blank.map.has(STORAGE_KEYS.name)).toBe(false);
    const none = fakeStorage();
    adoptLegacyName(createStore(none));
    expect(none.map.has(STORAGE_KEYS.name)).toBe(false);
  });
});
