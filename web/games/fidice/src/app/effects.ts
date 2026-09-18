// The browser side effects the controller asks for (docs/MIGRATION.md step 9): typed from
// legacy/fidice/index.html lines 3961-3999 (bundle section "// src/app/effects.ts"). Storage goes
// through web/shared/edge/storage.ts (docs/ARCHITECTURE.md "Module boundaries": app/effects.ts is
// the one fidice module that touches localStorage); the values read here are plain strings (the
// saved name, a reconnect token), so the decoder is the string read itself. The fallbacks are the
// legacy ones: a read that throws is null (sessionStorage is not consulted then), a write that
// fails goes to sessionStorage and is otherwise dropped. Randomness is injected (main.ts hands
// over Math.random, which the e2e harness seeds); the alphabet is the frozen one in
// web/shared/lib/roomCode.ts.
import {
  browserStore,
  createStore,
  unavailableStore,
  type StorageLike,
  type Store,
} from '../../../../shared/edge/storage.ts';
import { FIDICE_CODE_ALPHABET, randomCode } from '../../../../shared/lib/roomCode.ts';
import type { Rng } from '../../../../shared/lib/rng.ts';

/** The legacy literal, kept under its name; equal to the frozen shared alphabet. */
const CODE_ALPHABET = FIDICE_CODE_ALPHABET;

export type EffectsStorage = Readonly<{
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
}>;

export type Effects = Readonly<{
  storage: EffectsStorage;
  /** Resolves false when the clipboard refused. */
  copyToClipboard: (text: string) => Promise<boolean>;
  setHash: (hash: string) => void;
  readHash: () => string;
  scrollToTop: () => void;
  scrollIntoView: (id: string) => void;
  scrollToBottom: (id: string) => void;
  confirm: (question: string) => boolean;
  /** A fresh 5-character lobby code. */
  randomCode: () => string;
  /** Player ids and reconnect tokens. */
  randomId: () => string;
}>;

/** `sessionStorage` as a Store, or an unavailable one when even naming it throws. */
const sessionStore = (): Store => {
  try {
    const storage = (globalThis as Readonly<{ sessionStorage?: StorageLike }>).sessionStorage;
    return storage === undefined ? unavailableStore('no sessionStorage') : createStore(storage);
  } catch (e) {
    return unavailableStore(e instanceof Error ? e.message : String(e));
  }
};

/**
 * The legacy pair: `localStorage.getItem(k) ?? sessionStorage.getItem(k)` inside one try (a
 * throwing localStorage yields null without a look at sessionStorage), and a write that falls
 * back to sessionStorage and then gives up silently.
 */
const storageEffects = (local: Store, session: Store): EffectsStorage => ({
  get: (key) => {
    const first = local.readText(key);
    if (first.ok) return first.value;
    if (first.error.kind === 'unavailable') return null;
    const second = session.readText(key);
    return second.ok ? second.value : null;
  },
  set: (key, value) => {
    if (!local.writeText(key, value).ok) session.writeText(key, value);
  },
});

const browserEffects = (rng: Rng): Effects => ({
  storage: storageEffects(browserStore(), sessionStore()),
  copyToClipboard: (text) =>
    navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    ),
  setHash: (hash) => {
    location.hash = hash;
  },
  readHash: () => location.hash,
  scrollToTop: () => {
    window.scrollTo(0, 0);
  },
  scrollIntoView: (id) => {
    document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  },
  scrollToBottom: (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollTop = el.scrollHeight;
  },
  confirm: (question) => window.confirm(question),
  randomCode: () => randomCode('fidice', rng),
  randomId: () => rng().toString(36).slice(2) + rng().toString(36).slice(2),
});

export { CODE_ALPHABET, storageEffects, browserEffects };
