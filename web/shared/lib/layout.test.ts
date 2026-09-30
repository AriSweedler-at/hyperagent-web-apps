// The bucket table over the device catalogue: every catalogued phone x orientation x mode lands in
// a phone bucket (upright; sideways; sideways-short where the viewport is 375px or under), every
// iPad in a tablet bucket, the audit's desktop windows in the two desktop buckets, a touch laptop
// with the desktops; each representative viewport in its own bucket; the media strings spell the
// same thresholds; a name reads back.
import { describe, expect, test } from 'vitest';

import {
  BUCKETS,
  BUCKET_MEDIA,
  DESKTOP_MIN_WIDTH,
  DESKTOP_WIDE_MIN_WIDTH,
  PHONE_MAX_WIDTH,
  REPRESENTATIVE,
  SHORT_MAX_HEIGHT,
  SIDEWAYS_MAX_HEIGHT,
  bucketNamed,
  bucketOf,
  isDesktop,
  isSideways,
  type Bucket,
  type LayoutInputs,
} from './layout.ts';
import { DEVICES, deviceById, emulationName, emulationsOf, type Emulation } from './devices.ts';

const touch = (width: number, height: number): LayoutInputs => ({
  width,
  height,
  fine: false,
  hover: false,
});
const mouse = (width: number, height: number): LayoutInputs => ({
  width,
  height,
  fine: true,
  hover: true,
});
const ofEmulation = (e: Emulation): LayoutInputs => touch(e.viewport.width, e.viewport.height);

/** What a phone's case should land in, from its numbers alone. */
const phoneBucket = (e: Emulation): Bucket =>
  e.orientation === 'portrait'
    ? 'phone-upright'
    : e.viewport.height <= SHORT_MAX_HEIGHT
      ? 'phone-sideways-short'
      : 'phone-sideways';

const phones = DEVICES.filter((d) => d.kind !== 'ipad');
const ipads = DEVICES.filter((d) => d.kind === 'ipad');

/** The audit's desktop windows (tools/space-audit.ts `DESKTOP_WINDOWS`), with the bucket each lands in. */
const WINDOWS: ReadonlyArray<readonly [number, number, Bucket]> = [
  [900, 700, 'desktop'],
  [1024, 768, 'desktop'],
  [1280, 800, 'desktop'],
  [1440, 900, 'desktop-wide'],
  [1920, 1080, 'desktop-wide'],
];

describe('layout buckets', () => {
  test.each(phones.map((d) => [d.id, d] as const))(
    '%s: every orientation x mode x bar lands in a phone bucket, the short one at 375px or under',
    (_id, d) => {
      const cases = emulationsOf(d).map(
        (e) => [emulationName(e), bucketOf(ofEmulation(e)), phoneBucket(e)] as const,
      );
      cases.forEach(([name, got, want]) => {
        expect(got, name).toBe(want);
      });
      // No phone case is a tablet's or a desktop's.
      expect(cases.every(([, got]) => got.startsWith('phone-'))).toBe(true);
    },
  );

  test('the named phones: the 12 sideways standalone is a phone sideways, in a tab with the bar shown short; the SE and the X class sideways are short in every mode; the Pro Max sideways is never short', () => {
    const at = (
      id: string,
      orientation: 'portrait' | 'landscape',
      mode: 'browser' | 'standalone',
      bar: 'shown' | 'hidden' = 'hidden',
    ): Bucket => {
      const d = deviceById(id);
      if (d === null) throw new Error(id);
      const e = emulationsOf(d).find(
        (c) => c.orientation === orientation && c.mode === mode && c.bar === bar,
      );
      if (e === undefined) throw new Error(`${id} ${orientation} ${mode} ${bar}`);
      return bucketOf(ofEmulation(e));
    };
    expect(at('iphone-390x844', 'landscape', 'standalone')).toBe('phone-sideways');
    expect(at('iphone-390x844', 'landscape', 'browser', 'shown')).toBe('phone-sideways-short');
    expect(at('iphone-390x844', 'portrait', 'browser', 'shown')).toBe('phone-upright');
    expect(at('iphone-375x667-se', 'landscape', 'standalone')).toBe('phone-sideways-short');
    expect(at('iphone-375x812-x', 'landscape', 'standalone')).toBe('phone-sideways-short');
    expect(at('android-360x780-galaxy', 'landscape', 'browser', 'hidden')).toBe(
      'phone-sideways-short',
    );
    expect(at('iphone-440x956', 'landscape', 'browser', 'shown')).toBe('phone-sideways');
    expect(at('iphone-440x956', 'portrait', 'standalone')).toBe('phone-upright');
  });

  test.each(ipads.map((d) => [d.id, d] as const))(
    '%s: upright a tablet upright, sideways a tablet sideways, in every mode',
    (_id, d) => {
      emulationsOf(d).forEach((e) => {
        expect(bucketOf(ofEmulation(e)), emulationName(e)).toBe(
          e.orientation === 'portrait' ? 'tablet-upright' : 'tablet-sideways',
        );
      });
    },
  );

  test.each(WINDOWS)('a fine pointer at %dx%d is %s', (w, h, want) => {
    expect(bucketOf(mouse(w, h))).toBe(want);
    // A touch laptop: a fine pointer that hovers, judged by its pointer whatever its width.
    expect(bucketOf({ width: w, height: h, fine: true, hover: false })).toBe(want);
    expect(bucketOf({ width: w, height: h, fine: false, hover: true })).toBe(want);
  });

  test('the family is the pointer: a phone-sized window with a mouse is a desktop, a desktop-sized touch screen a tablet', () => {
    expect(bucketOf(mouse(390, 844))).toBe('desktop');
    expect(bucketOf(touch(1920, 1080))).toBe('tablet-sideways');
    expect(bucketOf(touch(1080, 1920))).toBe('tablet-upright');
    expect(isDesktop({ fine: false, hover: false })).toBe(false);
    expect(isDesktop({ fine: true, hover: false })).toBe(true);
  });

  test('the edges: a square is upright; 600 wide upright is a tablet, 599 a phone; 500 tall sideways is a phone, 501 a tablet; 375 is short, 376 not; 1440 is wide, 1439 not', () => {
    expect(isSideways({ width: 500, height: 500 })).toBe(false);
    expect(bucketOf(touch(500, 500))).toBe('phone-upright');
    expect(bucketOf(touch(PHONE_MAX_WIDTH, 900))).toBe('tablet-upright');
    expect(bucketOf(touch(PHONE_MAX_WIDTH - 1, 900))).toBe('phone-upright');
    expect(bucketOf(touch(900, SIDEWAYS_MAX_HEIGHT))).toBe('phone-sideways');
    expect(bucketOf(touch(900, SIDEWAYS_MAX_HEIGHT + 1))).toBe('tablet-sideways');
    expect(bucketOf(touch(667, SHORT_MAX_HEIGHT))).toBe('phone-sideways-short');
    expect(bucketOf(touch(667, SHORT_MAX_HEIGHT + 1))).toBe('phone-sideways');
    expect(bucketOf(mouse(DESKTOP_WIDE_MIN_WIDTH, 900))).toBe('desktop-wide');
    expect(bucketOf(mouse(DESKTOP_WIDE_MIN_WIDTH - 1, 900))).toBe('desktop');
    expect(bucketOf(mouse(DESKTOP_MIN_WIDTH - 200, 700))).toBe('desktop');
  });

  test('each representative viewport lands in its own bucket', () => {
    BUCKETS.forEach((b) => {
      expect(bucketOf(REPRESENTATIVE[b]), b).toBe(b);
    });
  });

  test('the media strings spell the same thresholds and the touch family once each', () => {
    expect(BUCKET_MEDIA['phone-upright']).toBe(
      '(any-pointer: coarse) and (hover: none) and (orientation: portrait) and (max-width: 599px)',
    );
    expect(BUCKET_MEDIA['phone-sideways']).toContain('(max-height: 500px)');
    expect(BUCKET_MEDIA['phone-sideways-short']).toContain('(max-height: 375px)');
    expect(BUCKET_MEDIA['tablet-upright']).toContain('(min-width: 600px)');
    expect(BUCKET_MEDIA['tablet-sideways']).toContain('(min-height: 501px)');
    expect(BUCKET_MEDIA.desktop).toBe(
      '(any-pointer: fine) and (max-width: 1439px), (hover: hover) and (max-width: 1439px)',
    );
    expect(BUCKET_MEDIA['desktop-wide']).toBe(
      '(any-pointer: fine) and (min-width: 1440px), (hover: hover) and (min-width: 1440px)',
    );
    expect(Object.keys(BUCKET_MEDIA).sort()).toEqual([...BUCKETS].sort());
  });

  test('bucketNamed reads a name back and nothing else', () => {
    BUCKETS.forEach((b) => {
      expect(bucketNamed(b)).toBe(b);
    });
    expect(bucketNamed('phone')).toBeNull();
    expect(bucketNamed(null)).toBeNull();
  });
});
