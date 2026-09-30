// The space audit's pure parts (docs/design/space-audit.md): the judge over a measured record, one
// table row per rule (a full table, a wasted side, a clipped slot, a small target, a frame on the
// wrong page, a box under the notch, a scroll the page's tier means, the turn gate standing), the
// room and empty-side arithmetic, the command line, the cases, the sheet, the check table and the
// diff against a baseline. The drive itself is proved by `npm run audit:space`.
import { describe, expect, test } from 'vitest';

import { deviceById, emulationFor, type Emulation } from '../../web/shared/lib/devices.ts';
import { twinOf } from '../shell-emulate.ts';
import {
  DESKTOP_WINDOWS,
  PHONES,
  casesFor,
  pagesFor,
  parseAuditArgs,
  screensOf,
  totalsOf,
} from '../space-audit.ts';
import {
  DESKTOP_LIMITS,
  FRAMED,
  GUTTER,
  LIMITS,
  PAGE_IDS,
  SIDES,
  TARGET_MIN,
  TARGET_MIN_DESKTOP,
  caseName,
  emptyOf,
  fractionOf,
  gapsOf,
  gatedOf,
  insetsOf,
  isDesktop,
  judge,
  limitsFor,
  orientationOf,
  roomOf,
  targetMinFor,
  tierOf,
  type AuditCase,
  type Measured,
  type Outcome,
  type PageId,
  type Screen,
} from './judge.ts';
import { changedRows, changesTable, checkTable, rowsOf, rowsOfReport } from './rows.ts';
import { cardPasses, caseLine, deviceLine, sheetHtml } from './sheet.ts';

const iphone12 = deviceById('iphone-390x844');
const se = deviceById('iphone-375x667-se');
if (iphone12 === null || se === null) throw new Error('rows missing');
/** Sideways standalone: the notch's 47 on both sides, 21 below. */
const sideways: Emulation = emulationFor(iphone12, 'landscape', 'standalone');
/** Upright standalone: 47 above, 34 below. */
const upright: Emulation = emulationFor(iphone12, 'portrait', 'standalone');

const TABLE: Screen = { id: 'table', kind: 'table' };
const HOME: Screen = { id: 'home', kind: 'home' };

/** The goldens' laptop window, the audit's third desktop case. */
const laptop: AuditCase = DESKTOP_WINDOWS[2] ?? {
  kind: 'desktop',
  viewport: { width: 1280, height: 800 },
};

/** A table screen that fills its room on `e`: an unframed page padded 12px, the content at the room's edge. */
const full = (e: AuditCase, page: PageId = 'briscola'): Measured => {
  const pad = { top: 12, right: 12, bottom: 12, left: 12 };
  const room = roomOf(pad, insetsOf(e));
  const w = e.viewport.width;
  const h = e.viewport.height;
  return {
    inner: { w, h },
    scrollHeight: h,
    scrollWidth: w,
    fixedScreen: true,
    lifted: false,
    frame: FRAMED.includes(page),
    plays: page === 'backgammon' ? 'landscape' : null,
    layout: isDesktop(e) ? 'desktop' : null,
    gate: false,
    locked: false,
    pad,
    gutterToken: null,
    used: {
      x: room.left,
      y: room.top,
      w: w - room.left - room.right,
      h: h - room.top - room.bottom,
    },
    clipped: [],
    targets: [{ sel: '#menuBtn', w: 44, h: 44 }],
    underInset: [],
  };
};

const failing = (m: Measured, e: AuditCase, screen = TABLE, page: PageId = 'briscola') =>
  judge({ page, screen, e, m })
    .checks.filter((c) => !c.pass)
    .map((c) => c.name);
/** The outcome per column, `used scroll clip targets frame gutter`. */
const outcomes = (
  m: Measured,
  e: AuditCase,
  screen = TABLE,
  page: PageId = 'briscola',
): ReadonlyArray<Outcome> => judge({ page, screen, e, m }).checks.map((c) => c.outcome);

describe('the room and the empty sides', () => {
  test('the room is the padding or the inset, whichever is more', () => {
    expect(roomOf({ top: 12, right: 12, bottom: 12, left: 12 }, sideways.insets)).toEqual({
      top: 12,
      right: 47,
      bottom: 21,
      left: 47,
    });
  });
  test('the empty side is the gap beyond the room, never negative', () => {
    const gaps = gapsOf({ w: 844, h: 390 }, { x: 60, y: 12, w: 700, h: 300 });
    expect(gaps).toEqual({ top: 12, right: 84, bottom: 78, left: 60 });
    expect(emptyOf(gaps, { top: 12, right: 47, bottom: 21, left: 47 })).toEqual({
      top: 0,
      right: 37,
      bottom: 57,
      left: 13,
    });
    expect(
      emptyOf(
        { top: 0, right: 0, bottom: 0, left: 0 },
        { top: 12, right: 12, bottom: 12, left: 12 },
      ),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
  test('a fraction is of the height for top and bottom, of the width for the sides', () => {
    expect(fractionOf({ w: 844, h: 390 }, 'bottom', 39)).toBeCloseTo(0.1);
    expect(fractionOf({ w: 844, h: 390 }, 'left', 84.4)).toBeCloseTo(0.1);
  });
  test('nothing painted: no gaps, and the judge fails `used`', () => {
    expect(gapsOf({ w: 390, h: 844 }, null)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(failing({ ...full(upright), used: null }, upright)).toEqual(['used']);
  });
});

describe('the judge, one row per rule', () => {
  test('a full table passes every check', () => {
    const v = judge({ page: 'briscola', screen: TABLE, e: sideways, m: full(sideways) });
    expect(v.pass).toBe(true);
    expect(v.checks.map((c) => c.name)).toEqual([
      'used',
      'scroll',
      'clip',
      'targets',
      'frame',
      'gutter',
    ]);
  });
  test('a wasted side: more than 8% of the height empty below a table', () => {
    const m = full(upright);
    const used = m.used;
    if (used === null) throw new Error('used');
    const short = { ...m, used: { ...used, h: used.h - 0.2 * upright.viewport.height } };
    expect(failing(short, upright)).toEqual(['used']);
    const v = judge({ page: 'briscola', screen: TABLE, e: upright, m: short });
    expect(v.checks[0]?.detail).toContain('over the table limit: bottom');
  });
  test('the same 20% below a home screen upright is within the 30% allowance', () => {
    const m = full(upright);
    const used = m.used;
    if (used === null) throw new Error('used');
    const short = {
      ...m,
      fixedScreen: false,
      used: { ...used, h: used.h - 0.2 * upright.viewport.height },
    };
    expect(failing(short, upright, HOME)).toEqual([]);
  });
  test("the shell's 480px column sideways stands within a quarter a side on the widest phone", () => {
    const widest = deviceById('iphone-440x956');
    if (widest === null) throw new Error('row missing');
    const e = emulationFor(widest, 'landscape', 'standalone');
    const m = full(e);
    const w = e.viewport.width;
    const column = { ...m, fixedScreen: false, used: { x: (w - 480) / 2, y: 12, w: 480, h: 300 } };
    expect(failing(column, e, HOME)).toEqual([]);
    // A 340px column: (956 - 340) / 2 - 62 of inset = 246px a side, 25.7%.
    const wider = { ...column, used: { x: (w - 340) / 2, y: 12, w: 340, h: 300 } };
    expect(failing(wider, e, HOME)).toEqual(['used']);
  });
  test('a clipped slot: one nowrap element wider than its box', () => {
    const m = { ...full(sideways), clipped: [{ sel: '#statusLine', over: 18 }] };
    expect(failing(m, sideways)).toEqual(['clip']);
    expect(judge({ page: 'briscola', screen: TABLE, e: sideways, m }).checks[2]?.detail).toBe(
      '#statusLine by 18px',
    );
  });
  test(`a small target: anything under ${String(TARGET_MIN)}px either way`, () => {
    const m = { ...full(sideways), targets: [{ sel: '#resetBtn', w: 120, h: 28 }] };
    expect(failing(m, sideways)).toEqual(['targets']);
  });
  test('a box under the home indicator below the fold of a scrolling screen is not counted', () => {
    const m = {
      ...full(upright),
      fixedScreen: false,
      scrollHeight: upright.viewport.height + 400,
      underInset: [{ sel: '#joinBtn', side: 'bottom' as const }],
    };
    expect(failing(m, upright, HOME)).toEqual([]);
    expect(
      failing({ ...m, underInset: [{ sel: 'h1', side: 'top' as const }] }, upright, HOME),
    ).toEqual(['gutter']);
    // The same for content reaching the fold, on the SE (no inset: the bottom is the gutter's
    // edge): no gutter while the document scrolls, a gutter failure once it ends at the viewport.
    const seUp = emulationFor(se, 'portrait', 'standalone');
    const flat = full(seUp);
    const used = flat.used;
    if (used === null) throw new Error('used');
    const toFold = {
      ...flat,
      fixedScreen: false,
      scrollHeight: seUp.viewport.height + 400,
      used: { ...used, h: seUp.viewport.height - used.y },
    };
    expect(failing(toFold, seUp, HOME)).toEqual([]);
    expect(failing({ ...toFold, scrollHeight: seUp.viewport.height }, seUp, HOME)).toEqual([
      'gutter',
    ]);
  });
  test('a frame on the wrong page, none on backgammon; the sandbox demos it', () => {
    expect(failing(full(sideways, 'ui-sandbox'), sideways, TABLE, 'ui-sandbox')).toEqual([]);
    expect(failing({ ...full(sideways), frame: true }, sideways)).toEqual(['frame']);
    expect(
      failing({ ...full(sideways, 'backgammon'), frame: false }, sideways, TABLE, 'backgammon'),
    ).toEqual(['frame']);
    expect(failing(full(sideways, 'backgammon'), sideways, TABLE, 'backgammon')).toEqual([]);
  });
  test('a box under the notch fails `gutter` on any page', () => {
    const m = { ...full(sideways), underInset: [{ sel: '#oppName', side: 'left' as const }] };
    expect(failing(m, sideways)).toEqual(['gutter']);
    expect(judge({ page: 'briscola', screen: TABLE, e: sideways, m }).checks[5]?.detail).toContain(
      '#oppName (left)',
    );
  });
  test(`content within ${String(GUTTER)}px of an inset-free edge fails \`gutter\` on an unframed page, not on the framed one`, () => {
    const m = full(sideways);
    const used = m.used;
    if (used === null) throw new Error('used');
    // The top sideways has no inset: content 2px from it.
    const tight = { ...m, used: { ...used, y: 2, h: used.h + used.y - 2 } };
    expect(failing(tight, sideways)).toEqual(['gutter']);
    const framed = { ...full(sideways, 'backgammon'), used: tight.used };
    expect(failing(framed, sideways, TABLE, 'backgammon')).toEqual([]);
  });
  test("the theme's --gutter replaces the 4px default", () => {
    const m = full(sideways);
    const used = m.used;
    if (used === null) throw new Error('used');
    const at8 = { ...m, gutterToken: 12, used: { ...used, y: 8, h: used.h + used.y - 8 } };
    expect(failing(at8, sideways)).toEqual(['gutter']);
    expect(failing({ ...at8, gutterToken: null }, sideways)).toEqual([]);
  });
  test('scroll: sideways never; down only where the kind allows and the body is not fixed-screen', () => {
    const m = full(upright);
    expect(failing({ ...m, scrollWidth: m.inner.w + 2 }, upright)).toEqual(['scroll']);
    expect(failing({ ...m, scrollHeight: m.inner.h + 2 }, upright)).toEqual(['scroll']);
    expect(failing({ ...m, scrollHeight: m.inner.h + 1 }, upright)).toEqual([]);
    expect(
      failing({ ...m, fixedScreen: false, scrollHeight: m.inner.h + 200 }, upright, HOME),
    ).toEqual([]);
    expect(
      failing({ ...m, fixedScreen: true, scrollHeight: m.inner.h + 200 }, upright, HOME),
    ).toEqual(['scroll']);
  });
  test('every column is ok or FAIL on a plain table, and the ok/FAIL outcome follows pass', () => {
    expect(outcomes(full(sideways), sideways)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    const m = { ...full(sideways), clipped: [{ sel: '#x', over: 3 }] };
    expect(outcomes(m, sideways)).toEqual(['ok', 'ok', 'FAIL', 'ok', 'ok', 'ok']);
  });
  test("a scroll the theme means (a lifted fixed-screen body) is `tier`, grey, and passes; a scroll it doesn't is FAIL", () => {
    const seTab = emulationFor(se, 'portrait', 'browser', 'shown');
    const m = { ...full(seTab, 'gin-rummy'), scrollHeight: seTab.viewport.height + 200 };
    expect(outcomes(m, seTab, TABLE, 'gin-rummy')[1]).toBe('FAIL');
    const lifted = { ...m, lifted: true };
    const v = judge({ page: 'gin-rummy', screen: TABLE, e: seTab, m: lifted });
    expect(v.pass).toBe(true);
    expect(v.checks[1]?.outcome).toBe('tier');
    expect(v.checks[1]?.detail).toContain('the theme lifts fixed-screen here');
    // A sideways scroll is never a tier.
    expect(outcomes({ ...lifted, scrollWidth: m.inner.w + 3 }, seTab, TABLE, 'gin-rummy')[1]).toBe(
      'FAIL',
    );
    // Nor does the lift excuse a screen that fits: no scroll, no tier.
    expect(
      outcomes({ ...full(seTab, 'gin-rummy'), lifted: true }, seTab, TABLE, 'gin-rummy')[1],
    ).toBe('ok');
  });
  test("backgammon's upright tier is the twin's (§3.10: at most 805px tall), read on the kept board", () => {
    const kept: Screen = { id: 'kept', kind: 'table', kept: true };
    // The 12 upright standalone: 844 tall, above the tier; in a tab with the bar shown, under it.
    const tab = emulationFor(iphone12, 'portrait', 'browser', 'shown');
    expect(twinOf(upright).scrolls).toBe(false);
    expect(twinOf(tab).scrolls).toBe(true);
    const tall = (e: Emulation): Measured => ({
      ...full(e, 'backgammon'),
      scrollHeight: e.viewport.height + 100,
    });
    expect(tierOf({ page: 'backgammon', screen: kept, e: tab, m: tall(tab) })).toContain(
      'the §3.10 upright tier',
    );
    expect(tierOf({ page: 'backgammon', screen: kept, e: upright, m: tall(upright) })).toBeNull();
    expect(outcomes(tall(tab), tab, kept, 'backgammon')[1]).toBe('tier');
    expect(outcomes(tall(upright), upright, kept, 'backgammon')[1]).toBe('FAIL');
    // Sideways no catalogued phone is under the landscape floor: a scroll there is a failure.
    expect(outcomes(tall(sideways), sideways, TABLE, 'backgammon')[1]).toBe('FAIL');
  });
  test('the turn gate: upright on a page that plays sideways, the gate standing is the whole judgement', () => {
    const gate = { ...full(upright, 'backgammon'), gate: true };
    expect(gatedOf({ page: 'backgammon', screen: TABLE, e: upright, m: gate })).toBe(true);
    expect(gatedOf({ page: 'backgammon', screen: HOME, e: upright, m: gate })).toBe(false);
    expect(gatedOf({ page: 'backgammon', screen: TABLE, e: sideways, m: gate })).toBe(false);
    expect(
      gatedOf({ page: 'backgammon', screen: { ...TABLE, kept: true }, e: upright, m: gate }),
    ).toBe(false);
    // Under the gate nothing else is judged: a short, clipped, small-target board passes.
    const messy = {
      ...gate,
      scrollHeight: upright.viewport.height + 300,
      clipped: [{ sel: '#oppName', over: 25 }],
      targets: [{ sel: '.point', w: 44, h: 39 }],
      underInset: [{ sel: '#statusLine', side: 'top' as const }],
    };
    const v = judge({ page: 'backgammon', screen: TABLE, e: upright, m: messy });
    expect(v.pass).toBe(true);
    expect(v.checks.map((c) => c.outcome)).toEqual(['ok', 'gate', 'gate', 'gate', 'ok', 'gate']);
    expect(v.checks[0]?.detail).toContain('the turn gate stands');
    // The frame is still judged under the gate.
    expect(failing({ ...messy, frame: false }, upright, TABLE, 'backgammon')).toEqual(['frame']);
    // A missing gate is the failure, on `used`.
    const none = judge({
      page: 'backgammon',
      screen: TABLE,
      e: upright,
      m: { ...gate, gate: false },
    });
    expect(none.pass).toBe(false);
    expect(none.checks.map((c) => c.outcome)).toEqual([
      'FAIL',
      'gate',
      'gate',
      'gate',
      'ok',
      'gate',
    ]);
    expect(none.checks[0]?.detail).toContain('no turn gate stands upright');
    // A gate standing the way the page plays is a bug on `used`, the rest judged as usual.
    expect(
      failing({ ...full(sideways, 'backgammon'), gate: true }, sideways, TABLE, 'backgammon'),
    ).toEqual(['used']);
    // A page that plays either way (no data-plays) is never gated.
    expect(gatedOf({ page: 'briscola', screen: TABLE, e: upright, m: full(upright) })).toBe(false);
  });
  test("the Android lock in the gate's place: the page turned the phone, so `used` passes and a kept screen under it is a gate too", () => {
    const locked = { ...full(upright, 'backgammon'), locked: true };
    const v = judge({ page: 'backgammon', screen: TABLE, e: upright, m: locked });
    expect(v.pass).toBe(true);
    expect(v.checks[0]?.detail).toContain('the Android lock is held');
    expect(v.checks[1]?.detail).toContain('the Android lock turned the phone');
    const kept: Screen = { id: 'kept', kind: 'table', kept: true };
    expect(gatedOf({ page: 'backgammon', screen: kept, e: upright, m: locked })).toBe(true);
    expect(outcomes(locked, upright, kept, 'backgammon')).toEqual([
      'ok',
      'gate',
      'gate',
      'gate',
      'ok',
      'gate',
    ]);
    // The lock the way the page plays changes nothing: sideways is judged as a table.
    expect(
      failing({ ...full(sideways, 'backgammon'), locked: true }, sideways, TABLE, 'backgammon'),
    ).toEqual([]);
  });
  test('the desktop cases (docs/design/space-audit.md §5): five windows, named and landscape, no insets; their own limits (home 40% below and beside, table 10% a side, no scroll) and a 32px target; no gate and no twin tier on a window', () => {
    expect(DESKTOP_WINDOWS.map(caseName)).toEqual([
      'desktop 900x700',
      'desktop 1024x768',
      'desktop 1280x800',
      'desktop 1440x900',
      'desktop 1920x1080',
    ]);
    DESKTOP_WINDOWS.forEach((w) => {
      expect(isDesktop(w)).toBe(true);
      expect(orientationOf(w)).toBe('landscape');
      expect(insetsOf(w)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
      expect(targetMinFor(w)).toBe(TARGET_MIN_DESKTOP);
      expect(limitsFor('table', w)).toBe(DESKTOP_LIMITS.table);
    });
    expect(isDesktop(sideways)).toBe(false);
    expect(orientationOf(sideways)).toBe('landscape');
    expect(insetsOf(sideways)).toEqual(sideways.insets);
    expect(targetMinFor(sideways)).toBe(TARGET_MIN);
    expect(limitsFor('home', sideways)).toBe(LIMITS.home);
    expect(DESKTOP_LIMITS.home.emptyMax).toEqual({ top: 0.1, right: 0.4, bottom: 0.4, left: 0.4 });
    expect(DESKTOP_LIMITS.table).toEqual({
      emptyMax: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
      mayScroll: false,
    });
    // A full table on the laptop passes; its `targets` detail names the mouse.
    const ok = judge({ page: 'briscola', screen: TABLE, e: laptop, m: full(laptop) });
    expect(ok.pass).toBe(true);
    expect(ok.checks.find((c) => c.name === 'targets')?.detail).toContain('32px (a mouse)');
    // A 36px control: a click's size on the window, short of a finger on the phone.
    const small = { ...full(laptop), targets: [{ sel: '#x', w: 36, h: 36 }] };
    expect(failing(small, laptop)).toEqual([]);
    expect(
      failing({ ...full(sideways), targets: [{ sel: '#x', w: 36, h: 36 }] }, sideways),
    ).toEqual(['targets']);
    // 11.3% empty above and below (beyond the 12px pad: 8.2% on the phone, 9.8% on the window): within
    // the window's tenth, over the phone's 8%. Top and bottom, since sideways the notch's 47px room
    // would swallow a side's band.
    const bands = (e: AuditCase): Measured => {
      const m = full(e);
      const dy = Math.round(m.inner.h * 0.113);
      return {
        ...m,
        used: { x: m.used?.x ?? 0, y: dy, w: m.used?.w ?? 0, h: m.inner.h - 2 * dy },
      };
    };
    expect(failing(bands(laptop), laptop)).toEqual([]);
    expect(failing(bands(sideways), sideways)).toEqual(['used']);
    // A home column ending 35% above the bottom: within the window's 40%, over the phone's 30%.
    const shortHome = (e: AuditCase): Measured => {
      const m = full(e);
      return {
        ...m,
        fixedScreen: false,
        used: {
          x: m.used?.x ?? 0,
          y: m.used?.y ?? 0,
          w: m.used?.w ?? 0,
          h: Math.round(m.inner.h * 0.6),
        },
      };
    };
    expect(failing(shortHome(laptop), laptop, HOME)).toEqual([]);
    expect(failing(shortHome(upright), upright, HOME)).toEqual(['used']);
    // Backgammon on a window: the page plays landscape, the window is landscape, no gate; no twin tier.
    const bg = full(laptop, 'backgammon');
    expect(gatedOf({ page: 'backgammon', screen: TABLE, e: laptop, m: bg })).toBe(false);
    expect(tierOf({ page: 'backgammon', screen: TABLE, e: laptop, m: bg })).toBeNull();
    expect(
      tierOf({ page: 'backgammon', screen: TABLE, e: laptop, m: { ...bg, lifted: true } }),
    ).toBe('the theme lifts fixed-screen here');
    // The bucket is reported per screen.
    expect(full(laptop).layout).toBe('desktop');
  });

  test('the limits: a table 8% a side, a home 10/25/30/25, the tool 2%', () => {
    expect(LIMITS.table.emptyMax).toEqual({ top: 0.08, right: 0.08, bottom: 0.08, left: 0.08 });
    expect(LIMITS.home.emptyMax).toEqual({ top: 0.1, right: 0.25, bottom: 0.3, left: 0.25 });
    expect(SIDES.every((s) => LIMITS.tool.emptyMax[s] === 0.02)).toBe(true);
    expect(LIMITS.home.mayScroll).toBe(true);
    expect(LIMITS.table.mayScroll).toBe(false);
  });
});

describe('the command line and the cases', () => {
  test('defaults; --game narrows the pages; a bad page or device is an error', () => {
    const args = parseAuditArgs([]);
    expect(args).toMatchObject({
      game: null,
      device: null,
      out: 'shots/space-audit',
      port: 0,
      jobs: 4,
    });
    expect(pagesFor(args)).toEqual(PAGE_IDS);
    expect(pagesFor(parseAuditArgs(['--game', 'rps']))).toEqual(['rps']);
    expect(() => parseAuditArgs(['--game', 'chess'])).toThrow(/--game must be one of/);
    expect(() => parseAuditArgs(['--device', 'nokia'])).toThrow(/not in the catalogue/);
    expect(() => parseAuditArgs(['--jobs', 'x'])).toThrow(/whole number/);
    expect(parseAuditArgs(['--serve', '--port', '16373', '--jobs', '2'])).toMatchObject({
      port: 16373,
      jobs: 2,
      baseline: null,
    });
    expect(parseAuditArgs(['--baseline', 'shots/space-audit/rps/report.json']).baseline).toBe(
      'shots/space-audit/rps/report.json',
    );
  });
  test('every phone x eight cases plus the five desktop windows by default; --device one phone (no windows) or desktop (the windows alone); the filters narrow and leave the windows out', () => {
    expect(PHONES.every((d) => d.kind !== 'ipad' && d.supported)).toBe(true);
    const all = casesFor(parseAuditArgs([]));
    expect(all).toHaveLength(PHONES.length * 8 + DESKTOP_WINDOWS.length);
    expect(all.slice(-DESKTOP_WINDOWS.length)).toEqual(DESKTOP_WINDOWS);
    expect(casesFor(parseAuditArgs(['--device', 'desktop']))).toEqual(DESKTOP_WINDOWS);
    expect(casesFor(parseAuditArgs(['--orientation', 'landscape'])).some(isDesktop)).toBe(false);
    expect(casesFor(parseAuditArgs(['--device', 'iphone-390x844']))).toHaveLength(8);
    expect(
      casesFor(parseAuditArgs(['--device', 'ipad-820x1180', '--orientation', 'landscape'])),
    ).toHaveLength(4);
    expect(
      casesFor(
        parseAuditArgs([
          '--device',
          'iphone-390x844',
          '--orientation',
          'landscape',
          '--mode',
          'browser',
        ]),
      ),
    ).toEqual([emulationFor(iphone12, 'landscape', 'browser', 'shown')]);
    expect(casesFor(parseAuditArgs(['--mode', 'browser', '--bar', 'hidden']))).toHaveLength(
      PHONES.length * 2,
    );
  });
  test('every page has a home-kind screen first and a second screen; backgammon a third, upright only: the gate kept', () => {
    PAGE_IDS.forEach((page) => {
      const screens = screensOf(page, 'landscape');
      expect(screens[0]?.kind).toBe('home');
      expect(screens).toHaveLength(2);
    });
    expect(screensOf('ui-sandbox')[1]).toEqual({ id: 'preview', kind: 'tool' });
    expect(screensOf('backgammon')[1]).toEqual({ id: 'table', kind: 'table' });
    expect(screensOf('backgammon', 'portrait')).toEqual([
      { id: 'home', kind: 'home' },
      { id: 'table', kind: 'table' },
      { id: 'kept', kind: 'table', kept: true },
    ]);
    expect(screensOf('backgammon', 'landscape')).toHaveLength(2);
    expect(screensOf('gin-rummy', 'portrait')).toHaveLength(2);
  });
});

describe('the sheet and the totals', () => {
  const okTable = judge({ page: 'briscola', screen: TABLE, e: sideways, m: full(sideways) });
  const badTable = judge({
    page: 'briscola',
    screen: TABLE,
    e: sideways,
    m: { ...full(sideways), clipped: [{ sel: '#x', over: 3 }] },
  });
  const cards = [
    {
      e: sideways,
      screens: [{ screen: TABLE, measured: full(sideways), verdict: okTable, picture: 'a.png' }],
    },
    {
      e: upright,
      screens: [{ screen: TABLE, measured: full(upright), verdict: badTable, picture: 'b.png' }],
    },
  ];
  test('the totals count cases, screens and failures per column', () => {
    expect(totalsOf(cards)).toEqual({
      cases: 2,
      casesPassed: 1,
      screens: 2,
      screensPassed: 1,
      failures: { clip: 1 },
    });
    expect(cards.map(cardPasses)).toEqual([true, false]);
  });
  test('the device line is the row, the models, the viewport and the insets; a window says so', () => {
    expect(deviceLine(sideways)).toBe(
      'iphone-390x844 · iPhone 12, 12 Pro, 13, 13 Pro, 14, 16e · 844x390 @3x · insets t/r/b/l 0/47/21/47',
    );
    expect(caseLine(sideways)).toBe(deviceLine(sideways));
    expect(caseLine(laptop)).toBe(
      'desktop 1280x800 · a fine pointer, no touch, no insets · 1280x800 @1x',
    );
  });
  test('the sheet groups the desktop windows after the phones under their own heading, and prints the bucket per screen', () => {
    const win = judge({ page: 'briscola', screen: TABLE, e: laptop, m: full(laptop) });
    const html = sheetHtml(
      'briscola',
      [
        ...cards,
        {
          e: laptop,
          screens: [{ screen: TABLE, measured: full(laptop), verdict: win, picture: 'd.png' }],
        },
      ],
      '20260930-1400',
    );
    expect(html).toContain('<h2 class="group">Phones <small>· 1 of 2 pass</small></h2>');
    expect(html).toContain('<h2 class="group">Desktop windows <small>· 1 of 1 pass</small></h2>');
    expect(html.indexOf('Desktop windows')).toBeGreaterThan(
      html.indexOf('iphone-390x844 landscape'),
    );
    expect(html).toContain('<h2>Desktop window <small>desktop 1280x800</small>');
    expect(html).toContain('<dt>bucket</dt><dd>desktop</dd>');
    expect(html).toContain('<dt>bucket</dt><dd>none written</dd>');
    // Phones alone: no group heading.
    expect(sheetHtml('briscola', cards, '20260930-1200')).not.toContain('class="group"');
    expect(rowsOf([{ e: laptop, screens: [] }])).toEqual([]);
  });
  test('the sheet: dark, one card per case, red where a rule fails, the tally in the heading', () => {
    const html = sheetHtml('briscola', cards, '20260930-1200');
    expect(html).toContain('background:#0f1115');
    expect(html).toContain('1 of 2 cases pass');
    expect(html.match(/<section class="card /g)).toHaveLength(2);
    expect(html).toContain('class="card fail"');
    expect(html).toContain('<li class="bad"><b>clip</b> #x by 3px</li>');
    expect(html).toContain('iphone-390x844_landscape_standalone'.replace(/_/g, ' '));
    expect(html).toContain('<img src="a.png"');
  });
  test('the sheet: a tier or gate column is grey with its badge, the screen passes', () => {
    const gate = judge({
      page: 'backgammon',
      screen: TABLE,
      e: upright,
      m: { ...full(upright, 'backgammon'), gate: true },
    });
    const html = sheetHtml(
      'backgammon',
      [
        {
          e: upright,
          screens: [
            {
              screen: TABLE,
              measured: full(upright, 'backgammon'),
              verdict: gate,
              picture: 'g.png',
            },
          ],
        },
      ],
      '20260930-1300',
    );
    expect(html).toContain('1 of 1 cases pass');
    expect(html).toContain('<li class="grey"><b>scroll</b>');
    expect(html).toContain('<span class="badge grey">gate</span>');
    expect(html).not.toContain('class="grey"><b>used</b>');
  });
});

describe('the check table and the diff against a baseline', () => {
  const gateV = judge({
    page: 'backgammon',
    screen: TABLE,
    e: upright,
    m: { ...full(upright, 'backgammon'), gate: true },
  });
  const okV = judge({
    page: 'backgammon',
    screen: TABLE,
    e: sideways,
    m: full(sideways, 'backgammon'),
  });
  const cards = [
    {
      e: upright,
      screens: [
        { screen: TABLE, measured: full(upright, 'backgammon'), verdict: gateV, picture: 'a.png' },
      ],
    },
    {
      e: sideways,
      screens: [
        { screen: TABLE, measured: full(sideways, 'backgammon'), verdict: okV, picture: 'b.png' },
      ],
    },
  ];
  test('the rows carry the case, the screen and an outcome per column; the table prints them', () => {
    const rows = rowsOf(cards);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      case: 'iphone-390x844 portrait standalone',
      screen: 'table',
      outcomes: {
        used: 'ok',
        scroll: 'gate',
        clip: 'gate',
        targets: 'gate',
        frame: 'ok',
        gutter: 'gate',
      },
    });
    const table = checkTable(rows);
    expect(table.split('\n')[0]).toMatch(
      /^case\s+used\s+scroll\s+clip\s+targets\s+frame\s+gutter\s+result$/,
    );
    expect(table).toContain(
      'iphone-390x844 portrait standalone table  ok       gate     gate     gate     ok       gate     pass',
    );
    expect(table).toContain('2 of 2 screens pass');
  });
  test("a first-run report (checks with `pass` alone) reads as ok/FAIL rows; a file that isn't one names what is missing", () => {
    const report = {
      cases: [
        {
          case: 'iphone-390x844 portrait standalone',
          screens: [
            {
              screen: { id: 'table', kind: 'table' },
              verdict: {
                pass: false,
                checks: [
                  { name: 'used', pass: true, detail: '' },
                  { name: 'scroll', pass: false, detail: '' },
                  { name: 'clip', pass: false, detail: '' },
                  { name: 'targets', pass: true, detail: '' },
                  { name: 'frame', pass: true, detail: '' },
                  { name: 'gutter', pass: true, detail: '' },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(rowsOfReport(report)[0]?.outcomes).toEqual({
      used: 'ok',
      scroll: 'FAIL',
      clip: 'FAIL',
      targets: 'ok',
      frame: 'ok',
      gutter: 'ok',
    });
    expect(() => rowsOfReport({ stamp: 'x', pages: {} })).toThrow(/no `cases` list/);
    expect(() => rowsOfReport({ cases: [{ case: 'a', screens: [{ screen: {} }] }] })).toThrow(
      /screen 0: no screen id or checks/,
    );
  });
  test('the diff lists the rows whose outcome moved, per column, and a new row from `new`', () => {
    const before = [
      {
        case: 'iphone-390x844 portrait standalone',
        screen: 'table',
        outcomes: {
          used: 'ok',
          scroll: 'FAIL',
          clip: 'FAIL',
          targets: 'ok',
          frame: 'ok',
          gutter: 'ok',
        } as const,
      },
      {
        case: 'iphone-390x844 landscape standalone',
        screen: 'table',
        outcomes: {
          used: 'ok',
          scroll: 'ok',
          clip: 'ok',
          targets: 'ok',
          frame: 'ok',
          gutter: 'ok',
        } as const,
      },
    ];
    const after = rowsOf(cards);
    const changed = changedRows(before, after);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.changes).toEqual([
      { name: 'scroll', from: 'FAIL', to: 'gate' },
      { name: 'clip', from: 'FAIL', to: 'gate' },
      { name: 'targets', from: 'ok', to: 'gate' },
      { name: 'gutter', from: 'ok', to: 'gate' },
    ]);
    const text = changesTable(changed, after.length);
    expect(text).toContain('scroll FAIL→gate, clip FAIL→gate, targets ok→gate, gutter ok→gate');
    expect(text).toContain('1 of 2 screens changed against the baseline');
    expect(changesTable([], 2)).toBe('no verdict changed against the baseline (2 screens)');
    // A row the baseline never had: every column from `new`.
    const fresh = changedRows([], after.slice(1));
    expect(fresh[0]?.changes.every((c) => c.from === null)).toBe(true);
    expect(changesTable(fresh, 1)).toContain('used new→ok');
    // Nothing moved: the same rows twice.
    expect(changedRows(after, after)).toEqual([]);
  });
});
