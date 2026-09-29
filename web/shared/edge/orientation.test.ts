import { describe, expect, test } from 'vitest';

import {
  createOrientationLock,
  type FullscreenDocumentLike,
  type ScreenLike,
} from './orientation.ts';

/** A document and a screen that record every call and flip fullscreen as the browser would. */
const fakes = (
  options: Readonly<{
    lock?: 'ok' | 'refuse' | 'absent';
    request?: 'ok' | 'refuse' | 'absent';
    exit?: 'ok' | 'throw' | 'absent';
    unlock?: 'ok' | 'throw' | 'absent';
    fullscreen?: boolean;
  }> = {},
): Readonly<{
  doc: FullscreenDocumentLike;
  screen: ScreenLike;
  calls: ReadonlyArray<string>;
  state: { on: boolean };
}> => {
  const calls: string[] = [];
  const state = { on: options.fullscreen === true };
  const doc: FullscreenDocumentLike = {
    ...(options.request === 'absent'
      ? {}
      : {
          documentElement: {
            requestFullscreen: () => {
              calls.push('request');
              if (options.request === 'refuse') return Promise.reject(new Error('denied'));
              state.on = true;
              return Promise.resolve();
            },
          },
        }),
    ...(options.exit === 'absent'
      ? {}
      : {
          exitFullscreen: () => {
            calls.push('exit');
            if (options.exit === 'throw') throw new Error('not fullscreen');
            state.on = false;
            return Promise.resolve();
          },
        }),
    get fullscreenElement() {
      return state.on ? {} : null;
    },
  };
  const screen: ScreenLike = {
    orientation: {
      ...(options.lock === 'absent'
        ? {}
        : {
            lock: (orientation: string) => {
              calls.push(`lock:${orientation}`);
              return options.lock === 'refuse'
                ? Promise.reject(new Error('NotSupportedError'))
                : Promise.resolve();
            },
          }),
      ...(options.unlock === 'absent'
        ? {}
        : {
            unlock: () => {
              calls.push('unlock');
              if (options.unlock === 'throw') throw new Error('unsupported');
            },
          }),
    },
  };
  return { doc, screen, calls, state };
};

describe('createOrientationLock', () => {
  test('hold: fullscreen on the document, then the landscape lock, in that order; true when both took; in fullscreen already, the lock alone', async () => {
    const f = fakes();
    const lock = createOrientationLock(f.doc, f.screen);
    await expect(lock.hold()).resolves.toBe(true);
    expect(f.calls).toEqual(['request', 'lock:landscape']);
    expect(f.state.on).toBe(true);
    // A second hold (the reducer only asks once per loss, but the adapter is honest either way).
    await expect(lock.hold()).resolves.toBe(true);
    expect(f.calls).toEqual(['request', 'lock:landscape', 'lock:landscape']);
    // UI Sandbox's portrait mode asks for the mirror.
    const upright = fakes();
    await expect(
      createOrientationLock(upright.doc, upright.screen, 'portrait').hold(),
    ).resolves.toBe(true);
    expect(upright.calls).toEqual(['request', 'lock:portrait']);
  });

  test('hold resolves false and throws nothing when the screen refuses the lock (a tablet, desktop Chromium), when fullscreen is denied (no activation: the lock is not even asked), and when either API is missing (an iPhone)', async () => {
    const refused = fakes({ lock: 'refuse' });
    await expect(createOrientationLock(refused.doc, refused.screen).hold()).resolves.toBe(false);
    expect(refused.calls).toEqual(['request', 'lock:landscape']);
    const denied = fakes({ request: 'refuse' });
    await expect(createOrientationLock(denied.doc, denied.screen).hold()).resolves.toBe(false);
    expect(denied.calls).toEqual(['request']);
    const noLock = fakes({ lock: 'absent' });
    await expect(createOrientationLock(noLock.doc, noLock.screen).hold()).resolves.toBe(false);
    expect(noLock.calls).toEqual([]);
    const noFullscreen = fakes({ request: 'absent' });
    await expect(createOrientationLock(noFullscreen.doc, noFullscreen.screen).hold()).resolves.toBe(
      false,
    );
    expect(noFullscreen.calls).toEqual([]);
    await expect(createOrientationLock({}, {}).hold()).resolves.toBe(false);
    await expect(createOrientationLock({}, { orientation: {} }).hold()).resolves.toBe(false);
  });

  test('drop: unlock, then out of fullscreen only when the page is in it; silent without the APIs and when either throws', () => {
    const inFullscreen = fakes({ fullscreen: true });
    createOrientationLock(inFullscreen.doc, inFullscreen.screen).drop();
    expect(inFullscreen.calls).toEqual(['unlock', 'exit']);
    expect(inFullscreen.state.on).toBe(false);
    const upright = fakes();
    createOrientationLock(upright.doc, upright.screen).drop();
    expect(upright.calls).toEqual(['unlock']);
    const throwing = fakes({ fullscreen: true, unlock: 'throw', exit: 'throw' });
    expect(() => {
      createOrientationLock(throwing.doc, throwing.screen).drop();
    }).not.toThrow();
    expect(throwing.calls).toEqual(['unlock', 'exit']);
    const bare = fakes({ fullscreen: true, unlock: 'absent', exit: 'absent' });
    expect(() => {
      createOrientationLock(bare.doc, bare.screen).drop();
    }).not.toThrow();
    expect(bare.calls).toEqual([]);
    expect(() => {
      createOrientationLock({}, {}).drop();
    }).not.toThrow();
  });

  test('a rejected exitFullscreen (left fullscreen by a gesture between the check and the call) is swallowed', async () => {
    const calls: string[] = [];
    const doc: FullscreenDocumentLike = {
      fullscreenElement: {},
      exitFullscreen: () => {
        calls.push('exit');
        return Promise.reject(new Error('not fullscreen'));
      },
    };
    createOrientationLock(doc, {}).drop();
    await Promise.resolve();
    expect(calls).toEqual(['exit']);
  });
});
