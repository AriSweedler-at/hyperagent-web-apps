// tools/shell-emulate.ts's pure parts (docs/design/devices.md): the command line, the case list
// `--all` and `--device` name, the explain text over the twin, the verdict over a measurement
// (the fill, the clearance, the scroll tier, the targets, the corner), the seam script and the
// sheet. The drive itself is proved by e2e/backgammon-devices.spec.ts and `npm run shots`.
import { describe, expect, test } from 'vitest';

import { deviceById, emulationFor, type Emulation } from '../web/shared/lib/devices.ts';
import {
  CLEARANCE,
  DESKTOP_SCROLL_MAX_HEIGHT,
  PHONE_SCROLL_MAX_HEIGHT,
  casesFor,
  explainText,
  judge,
  listText,
  parseEmulateArgs,
  seamScript,
  sheetHtml,
  summaryTable,
  twinOf,
  type Measured,
} from './shell-emulate.ts';

const iphone12 = deviceById('iphone-390x844');
const se = deviceById('iphone-375x667-se');
const ipad = deviceById('ipad-820x1180');
if (iphone12 === null || se === null || ipad === null) throw new Error('rows missing');

/** A measurement that satisfies every invariant for a case: the board where the twin puts it. */
const fitting = (e: Emulation): Measured => {
  const t = twinOf(e);
  const h = e.viewport.height;
  const w = e.viewport.width;
  const boardH = h - t.room.top - t.room.bottom;
  return {
    inner: { w, h },
    scrollHeight: h,
    board: { x: t.edge, y: t.room.top, w: w - 2 * t.edge - 50, h: boardH },
    frame: { '#statusLine': { x: 200, y: 11, w: 100, h: 22 }, '#controls': null },
    targets: [
      { sel: '#point-1', w: t.pointW, h: t.pointLen },
      { sel: '#menuBtn', w: 44, h: 44 },
    ],
    corner: e.corner,
    rootCorner: e.corner > 0 ? `${String(e.corner)}px` : '',
    screen: [e.screen.width, e.screen.height],
    dpr: e.dpr,
    coarse: true,
  };
};

describe('the command line', () => {
  test('a command, its options, defaults; a bad value names the choices; an unknown device names `list`', () => {
    expect(parseEmulateArgs(['list'])).toMatchObject({ command: 'list', all: false, device: null });
    expect(
      parseEmulateArgs([
        'explain',
        '--device',
        'iphone-390x844',
        '--orientation',
        'landscape',
        '--mode',
        'browser',
        '--bar',
        'hidden',
      ]),
    ).toMatchObject({
      command: 'explain',
      device: 'iphone-390x844',
      orientation: 'landscape',
      mode: 'browser',
      bar: 'hidden',
    });
    expect(
      parseEmulateArgs(['render', '--all', '--serve', '--out', 'shots/x', '--json', 'r.json']),
    ).toMatchObject({ command: 'render', all: true, serve: true, out: 'shots/x', json: 'r.json' });
    expect(() => parseEmulateArgs(['fly'])).toThrow(/list, explain, render, check/);
    expect(() => parseEmulateArgs(['explain', '--mode', 'kiosk'])).toThrow(
      /browser, standalone, fullscreen/,
    );
    expect(() => parseEmulateArgs(['explain', '--device', 'nokia'])).toThrow(/`list`/);
  });

  test('casesFor: --all is every supported device x orientation x mode, the tab twice, narrowed by the filters; --device is one case with landscape/browser/shown defaults', () => {
    const all = casesFor(parseEmulateArgs(['check', '--all']));
    expect(all.length).toBe(17 * 8);
    expect(all.some((e) => e.device.id === 'iphone-320x568-se1')).toBe(false);
    expect(casesFor(parseEmulateArgs(['explain', '--device', 'iphone-320x568-se1']))).toHaveLength(
      1,
    );
    const sideways = casesFor(parseEmulateArgs(['check', '--all', '--orientation', 'landscape']));
    expect(sideways.every((e) => e.orientation === 'landscape')).toBe(true);
    expect(sideways.length).toBe(17 * 4);
    const hidden = casesFor(
      parseEmulateArgs(['check', '--all', '--mode', 'browser', '--bar', 'hidden']),
    );
    expect(hidden.length).toBe(17 * 2);
    expect(hidden.every((e) => e.bar === 'hidden')).toBe(true);
    const one = casesFor(parseEmulateArgs(['explain', '--device', 'iphone-390x844']));
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ orientation: 'landscape', mode: 'browser', bar: 'shown' });
    expect(one[0]?.viewport).toEqual({ width: 844, height: 340 });
    expect(() => casesFor(parseEmulateArgs(['explain']))).toThrow(/--device <id> or --all/);
  });
});

describe('list and explain', () => {
  test('list: one line per row with its id, screen, insets, corner and bar ranges; UNVERIFIED rows say so', () => {
    const text = listText();
    expect(text).toContain('iphone-390x844');
    expect(text).toContain('47/34');
    expect(text).toContain('47/47/21');
    expect(text.split('\n')).toHaveLength(1 + 18);
    expect(text).toMatch(/android-412x915-pixel.*UNVERIFIED/);
    expect(text).not.toMatch(/iphone-390x844 .*UNVERIFIED/);
  });

  test('explain, sideways in a tab: the match, the radius over the notch, the rail scheme, the twin numbers, and the other bar state', () => {
    const text = explainText(emulationFor(iphone12, 'landscape', 'browser', 'shown'));
    expect(text).toContain('iphone-390x844 landscape browser bar-shown');
    expect(text).toContain('viewport 844x340');
    expect(text).toContain('insets t/r/b/l 0/47/21/47  notch 47');
    expect(text).toContain('match iphone-390x844  --screen-corner 47.33px');
    expect(text).toContain('tl 47.33  tr 47.33  br 47.33  bl 47.33');
    expect(text).toContain('layout landscape (rail)');
    expect(text).toContain('edge 47  chrome-w 144');
    expect(text).toContain('padding 11/27  chrome-h 66  room above/below 39/27');
    // (340 - 66 - 16) / 2 = 129; bar hidden: (390 - 66 - 16) / 2 = 154.
    expect(text).toContain('point-len 129 (floor 96;');
    expect(text).toContain('bar hidden: viewport 844x390  point-len 154  board 324 tall');
  });

  test('explain, upright in a tab and an iPad sideways: no notch means the env() fallback and square corners; the iPad is the desktop template', () => {
    const upright = explainText(emulationFor(iphone12, 'portrait', 'browser', 'hidden'));
    expect(upright).toContain('--screen-corner env() fallback (0)');
    expect(upright).toContain('tl 0  tr 0  br 0  bl 0');
    expect(upright).toContain('layout phone');
    const tablet = explainText(emulationFor(ipad, 'landscape', 'standalone'));
    expect(tablet).toContain('(UNVERIFIED row)');
    expect(tablet).toContain('layout desktop');
    expect(tablet).not.toContain('point-len');
  });

  test('the scroll tiers upright and on the desktop: a portrait tab under 806px scrolls, standalone at 844 fits, the SE upright always scrolls, an iPad sideways never', () => {
    expect(twinOf(emulationFor(iphone12, 'portrait', 'browser', 'hidden'))).toMatchObject({
      layout: 'phone',
      scrolls: true,
    });
    expect(twinOf(emulationFor(iphone12, 'portrait', 'standalone'))).toMatchObject({
      layout: 'phone',
      scrolls: false,
    });
    expect(twinOf(emulationFor(se, 'portrait', 'fullscreen')).scrolls).toBe(true);
    expect(twinOf(emulationFor(ipad, 'landscape', 'browser', 'shown')).scrolls).toBe(false);
    expect(PHONE_SCROLL_MAX_HEIGHT).toBe(805);
    expect(DESKTOP_SCROLL_MAX_HEIGHT).toBe(645);
  });

  test('the SE sideways with the bar up is under the rows floor: the twin says it scrolls', () => {
    const t = twinOf(emulationFor(se, 'landscape', 'browser', 'shown'));
    expect(t).toMatchObject({
      layout: 'landscape',
      scheme: 'rows',
      pointLen: 104.5,
      scrolls: false,
    });
    const se1 = deviceById('iphone-320x568-se1');
    if (se1 === null) throw new Error('row missing');
    const short = twinOf(emulationFor(se1, 'landscape', 'browser', 'shown'));
    expect(short).toMatchObject({ scheme: 'rows', pointLen: 90, scrolls: true, floorHeight: 296 });
    expect(explainText(emulationFor(se1, 'landscape', 'browser', 'shown'))).toContain('SCROLLS');
  });
});

describe('the verdict', () => {
  test('a measurement at the twin passes every check', () => {
    const e = emulationFor(iphone12, 'landscape', 'browser', 'hidden');
    const v = judge(e, fitting(e));
    expect(v.checks.map((c) => c.name)).toEqual(['corner', 'fills', 'clear', 'scroll', 'targets']);
    expect(v.pass, JSON.stringify(v.checks)).toBe(true);
  });

  test('the corner off by the insets fails; the fallback at 0 where nothing was written passes upright', () => {
    const e = emulationFor(iphone12, 'landscape', 'standalone');
    const v = judge(e, { ...fitting(e), corner: 47 });
    expect(v.checks[0]).toMatchObject({ name: 'corner', pass: false });
    expect(v.checks[0]?.detail).toContain('trim 47px, catalogue 47.33px');
    const up = emulationFor(iphone12, 'portrait', 'browser', 'shown');
    expect(judge(up, fitting(up)).checks[0]).toMatchObject({ pass: true });
  });

  test('parchment above or below the board fails the fill by more than half a pixel', () => {
    const e = emulationFor(iphone12, 'landscape', 'fullscreen');
    const m = fitting(e);
    const b = m.board;
    if (b === null) throw new Error('board');
    expect(judge(e, { ...m, board: { ...b, y: b.y + 0.4 } }).checks[1]?.pass).toBe(true);
    expect(judge(e, { ...m, board: { ...b, y: b.y + 3 } }).checks[1]).toMatchObject({
      pass: false,
      detail: expect.stringContaining('above 42 (room 39)') as string,
    });
    expect(judge(e, { ...m, board: { ...b, h: b.h - 8 } }).checks[1]?.pass).toBe(false);
  });

  test('a box inside the 11px clearance, a scroll where the twin fits, a 40px target: each fails its own check', () => {
    const e = emulationFor(iphone12, 'landscape', 'browser', 'hidden');
    const m = fitting(e);
    expect(
      judge(e, { ...m, frame: { ...m.frame, '#menuBtn': { x: 790, y: 8, w: 44, h: 44 } } })
        .checks[2],
    ).toMatchObject({ name: 'clear', pass: false });
    expect(judge(e, { ...m, scrollHeight: m.inner.h + 30 }).checks[3]).toMatchObject({
      name: 'scroll',
      pass: false,
    });
    expect(
      judge(e, { ...m, targets: [...m.targets, { sel: '#undoBtn', w: 40, h: 44 }] }).checks[4],
    ).toMatchObject({ name: 'targets', pass: false, detail: '#undoBtn 40x44' });
    expect(CLEARANCE).toBe(11);
  });

  test('under the floor the document must scroll and the fill is not asked; on the desktop template the targets are not', () => {
    const se1 = deviceById('iphone-320x568-se1');
    if (se1 === null) throw new Error('row missing');
    const e = emulationFor(se1, 'landscape', 'browser', 'shown');
    const m = fitting(e);
    expect(judge(e, { ...m, scrollHeight: m.inner.h + 40 }).checks[3]?.pass).toBe(true);
    expect(judge(e, m).checks[3]?.pass).toBe(false);
    expect(judge(e, m).checks[1]?.detail).toContain('under the floor');
    const tablet = emulationFor(ipad, 'landscape', 'standalone');
    const tm = fitting(tablet);
    expect(
      judge(tablet, { ...tm, targets: [{ sel: '#point-1', w: 40, h: 200 }] }).checks[4]?.pass,
    ).toBe(true);
  });
});

describe('the seam and the sheet', () => {
  test('the seam script writes the insets on #app and the notch on the root, and nothing on the root without a notch', () => {
    const sideways = seamScript(emulationFor(iphone12, 'landscape', 'standalone'));
    expect(sideways).toContain('const insets = {"top":0,"right":47,"bottom":21,"left":47}');
    expect(sideways).toContain('const notch = 47');
    expect(sideways).toContain("'--screen-corner'");
    expect(sideways).toContain("'--inset-l'");
    expect(seamScript(emulationFor(se, 'portrait', 'browser', 'shown'))).toContain(
      'const notch = 0',
    );
  });

  test('the sheet: one card per case with its four pictures, the numbers and the checks; the count in the heading', () => {
    const e = emulationFor(iphone12, 'landscape', 'browser', 'shown');
    const m = fitting(e);
    const card = {
      name: 'iphone-390x844 landscape browser bar-shown',
      e,
      twin: twinOf(e),
      measured: m,
      verdict: judge(e, m),
      pictures: {
        home: 'a--home.png',
        curtain: 'a--curtain.png',
        roll: 'a--roll.png',
        board: 'a--board.png',
      },
    };
    const html = sheetHtml(
      [card, { ...card, verdict: { pass: false, checks: [] } }],
      '20260928-1200',
    );
    expect(html).toContain('2 cases');
    expect(html).toContain('1 of 2 cases pass');
    expect(html.match(/<section class="card/g)).toHaveLength(2);
    expect(html.match(/<img /g)).toHaveLength(8);
    expect(html).toContain('src="a--board.png"');
    expect(html).toContain('844x340 @3x (screen 390x844)');
    expect(html).toContain('0/47/21/47');
    expect(html).toContain('<b>fills</b>');
    expect(html).toContain('class="card fail"');
  });

  test('the summary table: one row per case, a column per check, the count last', () => {
    const e = emulationFor(iphone12, 'landscape', 'browser', 'hidden');
    const ok = judge(e, fitting(e));
    const bad = judge(e, { ...fitting(e), corner: 0 });
    const text = summaryTable([
      ['a', ok],
      ['b', bad],
    ]);
    expect(text.split('\n')[0]).toMatch(
      /^case\s+corner\s+fills\s+clear\s+scroll\s+targets\s+result$/,
    );
    expect(text).toMatch(/^b\s+FAIL\s+ok\s+ok\s+ok\s+ok\s+FAIL$/m);
    expect(text).toContain('1 of 2 cases pass');
  });
});
