// The device catalogue and the functions over it (docs/design/devices.md): every row's screen
// matches itself in either orientation, the classes that share a screen part by their notch and
// their pixel ratio, an unknown screen falls back to the notch itself, no notch (headless, a
// portrait tab, an SE) yields nothing so the theme's `env()` fallback stands, and the emulation
// cases (insets, viewport, corner, reach) follow the rows: one `test.each` over DEVICES, so a new
// phone is one row here too.
import { describe, expect, test } from 'vitest';

import {
  BARS,
  DEVICES,
  DISPLAY_MODES,
  ORIENTATIONS,
  cornerRadius,
  deviceById,
  deviceLabel,
  deviceOf,
  emulationFor,
  emulationName,
  emulationsOf,
  insetsFor,
  notchOf,
  portraitOf,
  reachOf,
  viewportFor,
  type DeviceInputs,
} from './devices.ts';

const on = (width: number, height: number, dpr: number, notch: number | null): DeviceInputs => ({
  screen: { width, height },
  dpr,
  notch,
});

describe('the catalogue', () => {
  test('ids are unique and spell the screen; every screen is portrait; every inset and radius is a non-negative number', () => {
    const ids = DEVICES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    DEVICES.forEach((d) => {
      expect(d.id).toContain(`${String(d.screen.width)}x${String(d.screen.height)}`);
      expect(d.screen.width).toBeLessThan(d.screen.height);
      [
        d.insets.portrait.top,
        d.insets.portrait.bottom,
        d.insets.landscape.left,
        d.insets.landscape.right,
        d.insets.landscape.bottom,
        d.cutout,
        d.corner,
      ].forEach((n) => {
        expect(n).toBeGreaterThanOrEqual(0);
      });
      expect(d.toolbar.portrait.min).toBeLessThanOrEqual(d.toolbar.portrait.max);
      expect(d.toolbar.landscape.min).toBeLessThanOrEqual(d.toolbar.landscape.max);
      expect(deviceById(d.id)).toBe(d);
    });
    expect(deviceById('nope')).toBeNull();
  });

  test('portraitOf puts the shorter side first', () => {
    expect(portraitOf({ width: 844, height: 390 })).toEqual({ width: 390, height: 844 });
    expect(portraitOf({ width: 390, height: 844 })).toEqual({ width: 390, height: 844 });
  });

  test.each(DEVICES)('$id: its screen, notch and dpr match its row upright and sideways', (d) => {
    const upright = on(d.screen.width, d.screen.height, d.dpr, notchOf(d));
    const sideways = on(d.screen.height, d.screen.width, d.dpr, notchOf(d));
    expect(deviceOf(upright)).toBe(d);
    expect(deviceOf(sideways)).toBe(d);
    expect(deviceLabel(upright)).toBe(d.id);
  });

  test('the corner table: the published radii by screen', () => {
    const corner = (w: number, h: number, notch: number) => cornerRadius(on(w, h, 3, notch));
    expect(corner(390, 844, 47)).toBe(47.33);
    expect(corner(844, 390, 47)).toBe(47.33);
    expect(corner(393, 852, 59)).toBe(55);
    expect(corner(430, 932, 59)).toBe(55);
    expect(corner(428, 926, 47)).toBe(53.33);
    expect(corner(402, 874, 62)).toBe(62);
    expect(corner(440, 956, 62)).toBe(62);
    expect(cornerRadius(on(414, 896, 2, 48))).toBe(41.5);
  });

  test('a shared screen: the notch tells the X (44pt, 39) from the 12 mini (50pt, 44), the dpr the XR (2x, 41.5) from the XS Max (3x, 39); an unread notch takes the first row', () => {
    expect(cornerRadius(on(375, 812, 3, 44))).toBe(39);
    expect(cornerRadius(on(375, 812, 3, 50))).toBe(44);
    expect(deviceOf(on(375, 812, 3, null))?.id).toBe('iphone-375x812-x');
    expect(cornerRadius(on(375, 812, 3, null))).toBeNull();
    expect(cornerRadius(on(414, 896, 2, 48))).toBe(41.5);
    expect(cornerRadius(on(414, 896, 3, 44))).toBe(39);
    // Notch and dpr disagree: the dpr (a hardware constant) decides; neither known: the first row.
    expect(deviceOf(on(414, 896, 3, 48))?.id).toBe('iphone-414x896-max');
    expect(deviceOf(on(414, 896, 1, 44))?.id).toBe('iphone-414x896-max');
    expect(deviceOf(on(375, 812, 2, 47))?.id).toBe('iphone-375x812-x');
  });

  test('no notch, no corner: headless, a portrait tab, an SE, an iPad all leave the env() fallback (0) standing', () => {
    expect(cornerRadius(on(800, 600, 1, null))).toBeNull();
    expect(cornerRadius(on(390, 844, 3, null))).toBeNull();
    expect(cornerRadius(on(390, 844, 3, 0))).toBeNull();
    expect(cornerRadius(on(375, 667, 2, 0))).toBeNull();
    expect(cornerRadius(on(1024, 1366, 2, 0))).toBeNull();
  });

  test('an unknown screen with a notch falls back to the notch itself, as the CSS does', () => {
    expect(deviceOf(on(600, 1200, 2, 30))).toBeNull();
    expect(deviceLabel(on(600, 1200, 2, 30))).toBe('unknown (heuristic)');
    expect(deviceLabel(null)).toBe('unknown (heuristic)');
    expect(cornerRadius(on(600, 1200, 2, 30))).toBe(30);
    // Display Zoom shrinks a 393x852 phone to 360x780: the Galaxy's screen, so its row answers.
    expect(deviceOf(on(360, 780, 3, 54))?.id).toBe('android-360x780-galaxy');
  });
});

describe('the emulation cases', () => {
  const iphone12 = deviceById('iphone-390x844');
  const se = deviceById('iphone-375x667-se');
  const pixel = deviceById('android-412x915-pixel');
  if (iphone12 === null || se === null || pixel === null) throw new Error('rows missing');

  test('insets: the notch and the indicator standalone; in a tab the top is 0 upright and the sides stand sideways; an Android cutout fullscreen alone', () => {
    expect(insetsFor(iphone12, 'portrait', 'standalone')).toEqual({
      top: 47,
      right: 0,
      bottom: 34,
      left: 0,
    });
    expect(insetsFor(iphone12, 'portrait', 'browser')).toEqual({
      top: 0,
      right: 0,
      bottom: 34,
      left: 0,
    });
    expect(insetsFor(iphone12, 'landscape', 'browser')).toEqual({
      top: 0,
      right: 47,
      bottom: 21,
      left: 47,
    });
    expect(insetsFor(se, 'landscape', 'standalone')).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(insetsFor(pixel, 'portrait', 'browser').top).toBe(0);
    expect(insetsFor(pixel, 'portrait', 'fullscreen').top).toBe(28);
    expect(insetsFor(pixel, 'landscape', 'fullscreen').left).toBe(28);
    expect(insetsFor(pixel, 'landscape', 'browser').left).toBe(0);
  });

  test('viewport: the screen turned for the orientation, less the bar in a tab (shown: the range max; hidden: its min)', () => {
    expect(viewportFor(iphone12, 'landscape', 'standalone', 'shown')).toEqual({
      width: 844,
      height: 390,
    });
    expect(viewportFor(iphone12, 'landscape', 'browser', 'shown')).toEqual({
      width: 844,
      height: 340,
    });
    expect(viewportFor(iphone12, 'landscape', 'browser', 'hidden')).toEqual({
      width: 844,
      height: 390,
    });
    expect(viewportFor(iphone12, 'portrait', 'browser', 'shown')).toEqual({
      width: 390,
      height: 664,
    });
    expect(viewportFor(iphone12, 'portrait', 'browser', 'hidden')).toEqual({
      width: 390,
      height: 750,
    });
    expect(viewportFor(pixel, 'portrait', 'browser', 'shown')).toEqual({ width: 412, height: 835 });
  });

  test('reach: all four corners outside a tab; in a tab only where both edges have an inset, the top sideways counting as reached over a home indicator', () => {
    const all = { tl: true, tr: true, br: true, bl: true };
    expect(
      reachOf('portrait', 'standalone', insetsFor(iphone12, 'portrait', 'standalone')),
    ).toEqual(all);
    expect(reachOf('landscape', 'fullscreen', insetsFor(se, 'landscape', 'fullscreen'))).toEqual(
      all,
    );
    expect(reachOf('portrait', 'browser', insetsFor(iphone12, 'portrait', 'browser'))).toEqual({
      tl: false,
      tr: false,
      br: false,
      bl: false,
    });
    expect(reachOf('landscape', 'browser', insetsFor(iphone12, 'landscape', 'browser'))).toEqual(
      all,
    );
    expect(reachOf('landscape', 'browser', insetsFor(se, 'landscape', 'browser'))).toEqual({
      tl: false,
      tr: false,
      br: false,
      bl: false,
    });
  });

  test('emulationFor: the corner is what the boot writes (the class radius over a notch, 0 over none); the bar matters in a tab alone', () => {
    const sideways = emulationFor(iphone12, 'landscape', 'browser', 'shown');
    expect(sideways.notch).toBe(47);
    expect(sideways.corner).toBe(47.33);
    expect(sideways.viewport).toEqual({ width: 844, height: 340 });
    expect(sideways.screen).toEqual({ width: 390, height: 844 });
    expect(emulationName(sideways)).toBe('iphone-390x844 landscape browser bar-shown');
    const upright = emulationFor(iphone12, 'portrait', 'browser', 'hidden');
    expect(upright.notch).toBe(0);
    expect(upright.corner).toBe(0);
    const standalone = emulationFor(iphone12, 'portrait', 'standalone', 'shown');
    expect(standalone.bar).toBe('hidden');
    expect(standalone.corner).toBe(47.33);
    expect(emulationName(standalone)).toBe('iphone-390x844 portrait standalone');
    expect(emulationFor(se, 'landscape', 'standalone').corner).toBe(0);
  });

  test.each(DEVICES)(
    '$id: eight cases, one per orientation x mode with the tab twice, each inside the screen',
    (d) => {
      const cases = emulationsOf(d);
      expect(cases).toHaveLength(ORIENTATIONS.length * (DISPLAY_MODES.length + BARS.length - 1));
      expect(new Set(cases.map(emulationName)).size).toBe(cases.length);
      cases.forEach((e) => {
        const screen = e.orientation === 'portrait' ? d.screen : portraitOf(e.viewport);
        expect(portraitOf(e.viewport).width).toBeLessThanOrEqual(screen.width);
        expect(e.viewport.height).toBeGreaterThan(0);
        expect(e.viewport.height).toBeLessThanOrEqual(
          e.orientation === 'portrait' ? d.screen.height : d.screen.width,
        );
        expect(e.corner).toBe(e.notch > 0 ? d.corner : 0);
      });
    },
  );
});
