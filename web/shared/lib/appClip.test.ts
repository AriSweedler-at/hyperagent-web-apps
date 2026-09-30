// The clip's names as the page and the Worker share them (docs/design/rps-island.md D2, §8, §11).
import { describe, expect, test } from 'vitest';

import {
  APP_STORE_ID,
  CLIP_BUNDLE_ID,
  CLIP_ORIGIN,
  SESSION_ALPHABET,
  SESSION_LENGTH,
  clipUrl,
  isSession,
  rpsClipUrl,
  sessionFrom,
  smartAppBanner,
} from './appClip.ts';

describe('the clip', () => {
  test('its bundle id is the one the Worker pushes to (rps-push.ts CLIP_BUNDLE)', () => {
    expect(CLIP_BUNDLE_ID).toBe('com.sweedler.games.dice.Clip');
  });

  test('the dice URL has no query; the buddy URL carries the session, encoded', () => {
    expect(clipUrl('dice')).toBe(`${CLIP_ORIGIN}/clip/dice`);
    expect(rpsClipUrl('abc12345')).toBe(`${CLIP_ORIGIN}/clip/rps?session=abc12345`);
    expect(
      clipUrl('rps', [
        ['a b', 'c&d'],
        ['e', 'f'],
      ]),
    ).toBe(`${CLIP_ORIGIN}/clip/rps?a%20b=c%26d&e=f`);
  });

  test('the Smart App Banner names the app, the clip, the card and the invocation URL', () => {
    const url = rpsClipUrl('abc12345');
    expect(smartAppBanner(url)).toBe(
      `app-id=${APP_STORE_ID}, app-clip-bundle-id=${CLIP_BUNDLE_ID}, app-clip-display=card, app-argument=${url}`,
    );
  });
});

describe('the session id', () => {
  test('eight of the alphabet, one per byte, the rest of the bytes ignored', () => {
    expect(sessionFrom([0, 1, 25, 26, 35, 36, 255, 37, 99, 100])).toBe('abz09adb');
    expect(SESSION_ALPHABET).toHaveLength(36);
    expect(SESSION_LENGTH).toBe(8);
  });

  test('a short byte list yields a short id (the edge always hands eight)', () => {
    expect(sessionFrom([0, 1])).toBe('ab');
  });

  test('isSession: eight ASCII letters or digits, either case', () => {
    expect(isSession('abc12345')).toBe(true);
    expect(isSession('ABCdef12')).toBe(true);
    expect(isSession('abc1234')).toBe(false);
    expect(isSession('abc123456')).toBe(false);
    expect(isSession('abc-1234')).toBe(false);
    expect(isSession('')).toBe(false);
  });
});
