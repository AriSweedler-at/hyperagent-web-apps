// The app reducer's persist()/resume against the payloads a real legacy session wrote
// (docs/MIGRATION.md step 12): every `ginRummyMP_v1` capture in test/fixtures/legacy/gin-storage
// is read as the home screen would read it (`readHome`), offered as the resume the legacy offered,
// resumed through the reducer, and the App that results persists to the captured string byte for
// byte. The lobby and guest saves are also reproduced from the intents that created them.
import { describe, expect, test } from 'vitest';

import { viewFor } from '../../web/games/gin-rummy/src/engine/index.ts';
import { STORAGE_KEYS, readSave } from '../../web/games/gin-rummy/src/storage.ts';
import {
  initialApp,
  readHome,
  reduce,
  resumeLabel,
  runEffect,
  saveFor,
  type App,
  type EffectDeps,
  type Intent,
} from '../../web/games/gin-rummy/src/ui/state.ts';
import { createStore, type StorageLike } from '../../web/shared/edge/storage.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';
import { storageCaptures } from './gin.fixtures.ts';

const ctx = { rng: mulberry32(11), now: () => 1_700_000_000_000 };

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

const quiet = (): void => undefined;
const depsOver = (store: EffectDeps['store'], dispatch: (i: Intent) => void): EffectDeps => ({
  store,
  toast: quiet,
  fx: quiet,
  wakeLock: quiet,
  net: { startHost: quiet, startGuest: quiet, send: quiet, close: quiet },
  confirm: () => true,
  scrollTop: quiet,
  scorer: { resume: quiet },
  copy: quiet,
  revealRule: quiet,
  timers: { start: quiet, cancel: quiet },
  toggleSound: quiet,
  share: quiet,
  page: { fillName: quiet, fillP2Name: quiet, setCode: quiet },
  dispatch,
});

/** A tiny runtime: the reducer, the effects against a store, the app in a cell. */
const runtime = (
  storage: StorageLike,
): Readonly<{ app: () => App; dispatch: (intent: Intent) => void }> => {
  const cell = { app: initialApp };
  const store = createStore(storage);
  const dispatch = (intent: Intent): void => {
    const step = reduce(cell.app, intent, ctx);
    cell.app = step.app;
    step.effects.forEach((e) => {
      runEffect(cell.app, e, depsOver(store, dispatch));
    });
  };
  return { app: () => cell.app, dispatch };
};

const saves = storageCaptures().filter((c) => c.key === STORAGE_KEYS.save);

describe('the captured saves through the reducer', () => {
  test('there is a capture for each role, and a live one for each resumable role', () => {
    expect(saves.map((c) => c.variant).sort()).toEqual([
      'guest.derived',
      'host.lobby',
      'host.midHand',
      'local.dealt',
      'local.midHand',
      'local.pendingDraw',
    ]);
  });

  test.each(saves.map((c) => [c.variant, c] as const))(
    '%s: resumed from the home screen, the app persists the captured bytes',
    (variant, c) => {
      const storage = fakeStorage();
      storage.setItem(c.key, c.raw);
      const rt = runtime(storage);
      rt.dispatch({ type: 'home/init', home: readHome(createStore(storage)) });
      const offer = rt.app().shell.resume;
      if (variant === 'host.lobby') {
        // A room with no hand dealt is not offered (the legacy needed `saved.game`).
        expect(offer).toBeNull();
        return;
      }
      expect(offer).not.toBeNull();
      if (offer === null) return;
      expect(resumeLabel(offer)).toMatch(
        /^(Resume pass & play: |Resume hosting room |Rejoin room )/,
      );
      // Resuming clears nothing and writes nothing until the session persists; do that now.
      storage.removeItem(c.key);
      rt.dispatch({ type: 'resume/click' });
      rt.dispatch({ type: 'persist' });
      expect(storage.map.get(c.key)).toBe(c.raw);
      expect([...storage.map.keys()]).toEqual([c.key]);
      // And what was written reads back as the save the capture holds.
      expect(readSave(createStore(storage))).toEqual(readSave(createStore(fakeStorageWith(c))));
    },
  );

  test('host.lobby: hosting to 75 as Ann with the captured code persists the captured bytes', () => {
    const c = saves.find((s) => s.variant === 'host.lobby');
    if (c === undefined) throw new Error('no host.lobby capture');
    const storage = fakeStorage();
    const rt = runtime(storage);
    rt.dispatch({ type: 'home/init', home: readHome(createStore(storage)) });
    rt.dispatch({ type: 'host/click', name: 'Ann', target: '75' });
    // The legacy drew its code from Math.random; the capture's is LRZL.
    rt.dispatch({ type: 'host/start', code: 'LRZL' });
    rt.dispatch({ type: 'persist' });
    expect(storage.map.get(c.key)).toBe(c.raw);
    expect(saveFor(rt.app())).toEqual({
      role: 'host',
      code: 'LRZL',
      myName: 'Ann',
      target: 75,
      game: null,
      oppName: null,
    });
  });

  test('guest.derived: joining KQZM as Jeff persists the captured bytes once connected', () => {
    const c = saves.find((s) => s.variant === 'guest.derived');
    if (c === undefined) throw new Error('no guest.derived capture');
    const storage = fakeStorage();
    const rt = runtime(storage);
    rt.dispatch({ type: 'home/init', home: readHome(createStore(storage)) });
    rt.dispatch({ type: 'join/click', name: 'Jeff', code: 'KQZM' });
    rt.dispatch({ type: 'guest/connected' });
    rt.dispatch({ type: 'persist' });
    expect(storage.map.get(c.key)).toBe(c.raw);
  });

  test('host.midHand: the resumed host sees the saved hand as seat 0', () => {
    const c = saves.find((s) => s.variant === 'host.midHand');
    if (c === undefined) throw new Error('no host.midHand capture');
    const storage = fakeStorage();
    storage.setItem(c.key, c.raw);
    const rt = runtime(storage);
    rt.dispatch({ type: 'home/init', home: readHome(createStore(storage)) });
    rt.dispatch({ type: 'resume/click' });
    const app = rt.app();
    expect(app.shell.role).toBe('host');
    expect(app.shell.screen).toBe('hostWaitScreen');
    expect(app.shell.game).not.toBeNull();
    if (app.shell.game === null) return;
    expect(app.shell.view).toEqual(viewFor(app.shell.game, 0));
    expect(app.shell.oppName).toBe('Jeff');
    expect(app.shell.target).toBe(75);
  });
});

const fakeStorageWith = (c: Readonly<{ key: string; raw: string }>): StorageLike => {
  const storage = fakeStorage();
  storage.setItem(c.key, c.raw);
  return storage;
};
