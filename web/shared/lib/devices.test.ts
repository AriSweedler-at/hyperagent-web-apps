// The device table and the corner it yields (docs/design/backgammon-board.md §3.6): every row's
// screen matches itself in either orientation, the two 375x812 classes part by their notch, an
// unknown screen falls back to the notch itself, and no notch (headless, a portrait tab, an SE)
// yields nothing, so the theme's `env()` fallback stands.
import { describe, expect, test } from 'vitest';

import { DEVICES, cornerRadius, deviceOf, portraitOf, type DeviceInputs } from './devices.ts';

const on = (width: number, height: number, dpr: number, notch: number | null): DeviceInputs => ({
  screen: { width, height },
  dpr,
  notch,
});

describe('devices', () => {
  test('portraitOf puts the shorter side first', () => {
    expect(portraitOf({ width: 844, height: 390 })).toEqual({ width: 390, height: 844 });
    expect(portraitOf({ width: 390, height: 844 })).toEqual({ width: 390, height: 844 });
  });

  test.each(DEVICES)('$models: its screen matches its row upright and sideways', (d) => {
    const upright = on(d.screen.width, d.screen.height, d.dpr, d.notch);
    const sideways = on(d.screen.height, d.screen.width, d.dpr, d.notch);
    expect(deviceOf(upright)).toBe(d);
    expect(deviceOf(sideways)).toBe(d);
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

  test('375x812: the notch tells the X (44pt, radius 39) from the 12 mini (50pt, radius 44); an unread notch yields nothing', () => {
    expect(cornerRadius(on(375, 812, 3, 44))).toBe(39);
    expect(cornerRadius(on(375, 812, 3, 50))).toBe(44);
    expect(deviceOf(on(375, 812, 3, null))?.models).toBe('iPhone X, XS, 11 Pro');
    expect(cornerRadius(on(375, 812, 3, null))).toBeNull();
  });

  test('no notch, no corner: headless, a portrait tab, an SE, an iPad all leave the env() fallback (0) standing', () => {
    expect(cornerRadius(on(800, 600, 1, null))).toBeNull();
    expect(cornerRadius(on(390, 844, 3, null))).toBeNull();
    expect(cornerRadius(on(390, 844, 3, 0))).toBeNull();
    expect(cornerRadius(on(375, 667, 2, 0))).toBeNull();
    expect(cornerRadius(on(1024, 1366, 2, 0))).toBeNull();
  });

  test('an unknown screen with a notch falls back to the notch itself, as the CSS does', () => {
    expect(deviceOf(on(412, 915, 2.625, 30))).toBeNull();
    expect(cornerRadius(on(412, 915, 2.625, 30))).toBe(30);
    // Display Zoom shrinks a 393x852 phone to 360x780: no row, the inset stands in.
    expect(cornerRadius(on(360, 780, 3, 54))).toBe(54);
  });
});
