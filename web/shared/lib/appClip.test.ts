// The clip's names as the page and the Worker share them (docs/design/rps-island.md D2, §8, §11).
import { describe, expect, test } from 'vitest';

import {
  AASA_PATH,
  APP_BUNDLE_ID,
  APP_STORE_ID,
  APP_STORE_ID_PLACEHOLDER,
  CLIP_BUNDLE_ID,
  CLIP_IDS,
  CLIP_ORIGIN,
  GATE_REASONS,
  INITIAL_ROLL,
  SESSION_ALPHABET,
  SESSION_LENGTH,
  TEAM_ID,
  TEAM_ID_PLACEHOLDER,
  appSiteAssociation,
  bannerContent,
  clipAppId,
  clipGate,
  clipUrl,
  diceClipUrl,
  isConfigured,
  isSession,
  islandIphone,
  rollFrom,
  rpsClipUrl,
  sessionFrom,
  smartAppBanner,
  type ClipIds,
} from './appClip.ts';
import { deviceById } from './devices.ts';

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

// ---- The dice (docs/design/ui-sandbox.md §7) -----------------------------------------------------

/** A filled pair, as the owner's constants will read. */
const FILLED: ClipIds = { appStoreId: '6741234567', teamId: 'ABCDE12345' };

describe("the owner's ids", () => {
  test('the constants are the placeholders until the owner fills them, so nothing is configured', () => {
    expect(APP_STORE_ID).toBe(APP_STORE_ID_PLACEHOLDER);
    expect(TEAM_ID).toBe(TEAM_ID_PLACEHOLDER);
    expect(CLIP_IDS).toEqual({ appStoreId: APP_STORE_ID, teamId: TEAM_ID });
    expect(isConfigured()).toBe(false);
  });

  test('configured needs both ids real; either placeholder leaves it off', () => {
    expect(isConfigured(FILLED)).toBe(true);
    expect(isConfigured({ ...FILLED, appStoreId: APP_STORE_ID_PLACEHOLDER })).toBe(false);
    expect(isConfigured({ ...FILLED, teamId: TEAM_ID_PLACEHOLDER })).toBe(false);
  });

  test('the banner content names the filled app id, the clip, the card and the argument; null unconfigured', () => {
    expect(bannerContent(clipUrl('dice'), FILLED)).toBe(
      `app-id=6741234567, app-clip-bundle-id=${CLIP_BUNDLE_ID}, app-clip-display=card, app-argument=${CLIP_ORIGIN}/clip/dice`,
    );
    expect(bannerContent(clipUrl('dice'))).toBeNull();
  });

  test('the AASA names the clip under the team id and hands /clip/* to the app; null unconfigured', () => {
    expect(AASA_PATH).toBe('/.well-known/apple-app-site-association');
    expect(APP_BUNDLE_ID).toBe('com.sweedler.games.dice');
    expect(CLIP_BUNDLE_ID).toBe(`${APP_BUNDLE_ID}.Clip`);
    expect(clipAppId(FILLED)).toBe(`ABCDE12345.${CLIP_BUNDLE_ID}`);
    expect(clipAppId()).toBe(`${TEAM_ID}.${CLIP_BUNDLE_ID}`);
    expect(appSiteAssociation(FILLED)).toEqual({
      appclips: { apps: [`ABCDE12345.${CLIP_BUNDLE_ID}`] },
      applinks: {
        details: [{ appIDs: [`ABCDE12345.${APP_BUNDLE_ID}`], components: [{ '/': '/clip/*' }] }],
      },
    });
    expect(appSiteAssociation()).toBeNull();
  });
});

describe('a roll', () => {
  test('one die per byte, mod 6 plus one; a missing byte is a 1; the URL spells a literal comma', () => {
    expect(rollFrom([0, 5])).toEqual([1, 6]);
    expect(rollFrom([6, 13])).toEqual([1, 2]);
    expect(rollFrom([255])).toEqual([4, 1]);
    expect(rollFrom([])).toEqual([1, 1]);
    expect(INITIAL_ROLL).toEqual([3, 5]);
    expect(diceClipUrl([3, 5])).toBe(`${CLIP_ORIGIN}/clip/dice?roll=3,5`);
  });
});

describe('the gate', () => {
  const island = deviceById('iphone-393x852');
  const notch = deviceById('iphone-390x844');
  const se = deviceById('iphone-375x667-se');
  const pixel = deviceById('android-412x915-pixel');

  test('islandIphone: the island rows alone; a notch, a whole glass, an Android hole and no row are not', () => {
    expect(island?.cut?.island).toBe(true);
    expect(islandIphone(island)).toBe(true);
    expect(islandIphone(notch)).toBe(false);
    expect(islandIphone(se)).toBe(false);
    expect(pixel?.cut?.island).toBe(true);
    expect(islandIphone(pixel)).toBe(false);
    expect(islandIphone(null)).toBe(false);
  });

  test('enabled only for an island iPhone with a configured clip; the hardware reason first, then the unpublished one', () => {
    expect(clipGate(island, FILLED)).toEqual({ enabled: true, reason: null });
    expect(clipGate(island)).toEqual({ enabled: false, reason: GATE_REASONS.unpublished });
    expect(clipGate(notch, FILLED)).toEqual({ enabled: false, reason: GATE_REASONS.hardware });
    expect(clipGate(null)).toEqual({ enabled: false, reason: GATE_REASONS.hardware });
    expect(GATE_REASONS.hardware).toBe(
      'Needs an iPhone with the Dynamic Island (14 Pro or later).',
    );
    expect(GATE_REASONS.unpublished).toBe('The Dice App Clip is not published yet.');
  });
});
