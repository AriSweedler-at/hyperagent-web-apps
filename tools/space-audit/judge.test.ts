// The space audit's pure parts (docs/design/space-audit.md): the judge over a measured record, one
// table row per rule (a full table, a wasted side, a clipped slot, a small target, a frame on the
// wrong page, a box under the notch), the room and empty-side arithmetic, the command line, the
// cases and the sheet. The drive itself is proved by `npm run audit:space`.
import { describe, expect, test } from 'vitest';

import { deviceById, emulationFor, type Emulation } from '../../web/shared/lib/devices.ts';
import { PHONES, casesFor, pagesFor, parseAuditArgs, screensOf, totalsOf } from '../space-audit.ts';
import {
  FRAMED,
  GUTTER,
  LIMITS,
  PAGE_IDS,
  SIDES,
  TARGET_MIN,
  emptyOf,
  fractionOf,
  gapsOf,
  judge,
  roomOf,
  type Measured,
  type PageId,
  type Screen,
} from './judge.ts';
import { cardPasses, deviceLine, sheetHtml } from './sheet.ts';

const iphone12 = deviceById('iphone-390x844');
const se = deviceById('iphone-375x667-se');
if (iphone12 === null || se === null) throw new Error('rows missing');
/** Sideways standalone: the notch's 47 on both sides, 21 below. */
const sideways: Emulation = emulationFor(iphone12, 'landscape', 'standalone');
/** Upright standalone: 47 above, 34 below. */
const upright: Emulation = emulationFor(iphone12, 'portrait', 'standalone');

const TABLE: Screen = { id: 'table', kind: 'table' };
const HOME: Screen = { id: 'home', kind: 'home' };

/** A table screen that fills its room on `e`: an unframed page padded 12px, the content at the room's edge. */
const full = (e: Emulation, page: PageId = 'briscola'): Measured => {
  const pad = { top: 12, right: 12, bottom: 12, left: 12 };
  const room = roomOf(pad, e.insets);
  const w = e.viewport.width;
  const h = e.viewport.height;
  return {
    inner: { w, h },
    scrollHeight: h,
    scrollWidth: w,
    fixedScreen: true,
    frame: FRAMED.includes(page),
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

const failing = (m: Measured, e: Emulation, screen = TABLE, page: PageId = 'briscola') =>
  judge({ page, screen, e, m })
    .checks.filter((c) => !c.pass)
    .map((c) => c.name);

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
    });
  });
  test('every phone x eight cases by default; --device one phone; the filters narrow', () => {
    expect(PHONES.every((d) => d.kind !== 'ipad' && d.supported)).toBe(true);
    expect(casesFor(parseAuditArgs([]))).toHaveLength(PHONES.length * 8);
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
  test('every page has a home-kind screen first and a second screen', () => {
    PAGE_IDS.forEach((page) => {
      const screens = screensOf(page);
      expect(screens[0]?.kind).toBe('home');
      expect(screens).toHaveLength(2);
    });
    expect(screensOf('ui-sandbox')[1]).toEqual({ id: 'preview', kind: 'tool' });
    expect(screensOf('backgammon')[1]).toEqual({ id: 'table', kind: 'table' });
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
  test('the device line is the row, the models, the viewport and the insets', () => {
    expect(deviceLine(sideways)).toBe(
      'iphone-390x844 · iPhone 12, 12 Pro, 13, 13 Pro, 14, 16e · 844x390 @3x · insets t/r/b/l 0/47/21/47',
    );
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
});
