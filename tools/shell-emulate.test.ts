// tools/shell-emulate.ts's pure parts (docs/design/devices.md): the command line, the case list
// `--all` and `--device` name, the explain text over the twin, the verdict over a measurement
// (the fill, the clearance, the scroll tier, the targets, the corner), the seam script and the
// sheet. The drive itself is proved by e2e/backgammon-devices.spec.ts and `npm run shots`.
import { describe, expect, test } from 'vitest';

import {
  CORNER_KEYS,
  deviceById,
  emulationFor,
  type Emulation,
} from '../web/shared/lib/devices.ts';
import {
  CLEARANCE,
  DESKTOP_SCROLL_MAX_HEIGHT,
  PHONE_SCROLL_MAX_HEIGHT,
  SANDBOX_EXAMPLES,
  SANDBOX_PHONES,
  casesFor,
  explainSandboxText,
  explainText,
  gamesFor,
  judge,
  judgeSandbox,
  listText,
  parseEmulateArgs,
  sandboxCasesFor,
  sandboxMap,
  sandboxName,
  seamScript,
  sheetHtml,
  summaryTable,
  twinOf,
  typesOf,
  type ExampleMeasure,
  type Measured,
  type SandboxCase,
  type SandboxMeasured,
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
    corners: e.corners,
    rootCorners: CORNER_KEYS.map((k) => `${String(e.corners[k])}px`).join('/'),
    fullscreen: false,
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
    expect(parseEmulateArgs(['check', '--all', '--game', 'ui-sandbox'])).toMatchObject({
      game: 'ui-sandbox',
    });
    expect(() => parseEmulateArgs(['check', '--game', 'chess'])).toThrow(/backgammon, ui-sandbox/);
  });

  test('gamesFor: --game names one; without it --all drives both and one --device drives backgammon alone', () => {
    expect(gamesFor(parseEmulateArgs(['render', '--all']))).toEqual(['backgammon', 'ui-sandbox']);
    expect(gamesFor(parseEmulateArgs(['render', '--device', 'iphone-390x844']))).toEqual([
      'backgammon',
    ]);
    expect(gamesFor(parseEmulateArgs(['check', '--all', '--game', 'ui-sandbox']))).toEqual([
      'ui-sandbox',
    ]);
    expect(
      gamesFor(parseEmulateArgs(['check', '--device', 'iphone-390x844', '--game', 'ui-sandbox'])),
    ).toEqual(['ui-sandbox']);
  });

  test('sandboxCasesFor: the phones (no iPad, no SE 1st gen) x every emulation, sideways under both landscape types and upright under the one portrait; the filters narrow; the e2e sweep`s 56 are among --all`s', () => {
    expect(SANDBOX_PHONES.map((d) => d.kind)).not.toContain('ipad');
    expect(SANDBOX_PHONES).toHaveLength(14);
    expect(typesOf('landscape')).toEqual(['landscape-primary', 'landscape-secondary']);
    expect(typesOf('portrait')).toEqual(['portrait-primary']);
    const all = sandboxCasesFor(parseEmulateArgs(['check', '--all']));
    // 8 emulations per phone: 4 upright (x1 type) + 4 sideways (x2 types) = 12.
    expect(all).toHaveLength(14 * 12);
    const names = all.map(sandboxName);
    expect(names).toContain('iphone-393x852 landscape browser bar-shown landscape-secondary');
    expect(names).toContain('iphone-393x852 landscape fullscreen landscape-primary');
    expect(names).toContain('iphone-393x852 portrait browser bar-shown portrait-primary');
    expect(names.some((n) => n.startsWith('ipad'))).toBe(false);
    const upright = sandboxCasesFor(
      parseEmulateArgs(['check', '--all', '--orientation', 'portrait']),
    );
    expect(upright).toHaveLength(14 * 4);
    expect(upright.every((c) => c.type === 'portrait-primary')).toBe(true);
    const one = sandboxCasesFor(parseEmulateArgs(['explain', '--device', 'iphone-390x844']));
    expect(one.map((c) => c.type)).toEqual(['landscape-primary', 'landscape-secondary']);
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

  test('explain, sideways in a tab: the match, the radius over the notch, the frame corners (the bar up takes the top pair), the rail scheme, the twin numbers, and the other bar state', () => {
    const text = explainText(emulationFor(iphone12, 'landscape', 'browser', 'shown'));
    expect(text).toContain('iphone-390x844 landscape browser bar-shown');
    expect(text).toContain('viewport 844x340');
    expect(text).toContain('insets t/r/b/l 0/47/21/47  notch 47');
    expect(text).toContain('match iphone-390x844  radius 47.33px');
    expect(text).toContain('tl 0  tr 0  br 47.33  bl 47.33');
    expect(explainText(emulationFor(iphone12, 'landscape', 'browser', 'hidden'))).toContain(
      'tl 47.33  tr 47.33  br 47.33  bl 47.33',
    );
    expect(text).toContain('layout landscape (rail)');
    expect(text).toContain('edge 47  chrome-w 144');
    expect(text).toContain('padding 11/27  chrome-h 66  room above/below 39/27');
    // (340 - 66 - 16) / 2 = 129; bar hidden: (390 - 66 - 16) / 2 = 154.
    expect(text).toContain('point-len 129 (floor 96;');
    expect(text).toContain('bar hidden: viewport 844x390  point-len 154  board 324 tall');
  });

  test('explain, upright in a tab and an iPad sideways: no notch means the env() fallback and square corners; the iPad is the desktop template', () => {
    const upright = explainText(emulationFor(iphone12, 'portrait', 'browser', 'hidden'));
    expect(upright).toContain('radius none (square)');
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

describe('the sandbox: explain, the map and the verdict', () => {
  const island = deviceById('iphone-393x852');
  if (island === null) throw new Error('row missing');
  const primary: SandboxCase = {
    e: emulationFor(island, 'landscape', 'browser', 'shown'),
    type: 'landscape-primary',
  };
  const secondary: SandboxCase = { ...primary, type: 'landscape-secondary' };
  const upright: SandboxCase = {
    e: emulationFor(island, 'portrait', 'browser', 'shown'),
    type: 'portrait-primary',
  };
  /** A measurement that satisfies every sandbox invariant for a case: the page agrees with the module. */
  const agreeing = (c: SandboxCase): SandboxMeasured => {
    const map = sandboxMap(c);
    const free = map.cutEdge === 'left' ? 'right' : map.cutEdge === 'right' ? 'left' : null;
    const ears =
      map.cutEdge === 'left' || map.cutEdge === 'right' ? map.edges[map.cutEdge].length : 0;
    const h = c.e.viewport.height;
    const base: ExampleMeasure = {
      fits: true,
      gaps: { top: 11, right: 70, bottom: 32, left: 70 },
      placements: [],
      railButtons: 0,
      ears: 0,
      scrollHeight: h,
    };
    return {
      inner: { w: c.e.viewport.width, h },
      corners: c.e.corners,
      device: island.id,
      map,
      deviceLine: `device ${island.id}  ${island.models}`,
      examples: {
        cover: base,
        board: base,
        rail:
          free === null
            ? base
            : { ...base, railButtons: 3, placements: [`rail: ${free} segment 1`] },
        ears: {
          ...base,
          ears,
          placements: Array.from(
            { length: ears },
            (_, i) => `ear${String(i + 1)}: ${map.cutEdge} segment ${String(i + 1)}`,
          ),
        },
        gutters: base,
      },
    };
  };

  test('explain --game ui-sandbox: the match and the cut, the frame corners, the cut`s side and span, the ears, every edge`s segments, where (g) and (h) land; the secondary mirrors the primary; upright in a tab the cut is under the bar', () => {
    const text = explainSandboxText(primary);
    expect(text).toContain('iphone-393x852 landscape browser bar-shown landscape-primary');
    expect(text).toContain('match iphone-393x852  cut 126 island');
    expect(text).toContain('frame corners: tl 0  tr 0  br 55  bl 55');
    expect(text).toContain('cut side left  at 83.5-209.5 (126)  ear 68.5  free side right');
    expect(text).toContain('safe left: 0-77.5 (77.5), 215.5-284 (68.5)');
    expect(text).toContain('(g) rail: right segment 1  (h) ears: 2');
    const mirror = explainSandboxText(secondary);
    expect(mirror).toContain('cut side right');
    expect(mirror).toContain('safe right: 0-77.5 (77.5), 215.5-284 (68.5)');
    expect(mirror).toContain('(g) rail: left segment 1');
    const up = explainSandboxText(upright);
    expect(up).toContain('cut side top (off the page: under the bar)');
    expect(up).toContain('(g) rail: hidden (no free segment)  (h) ears: 0');
  });

  test('judgeSandbox: a page that agrees with the module passes the seven checks; each disagreement fails its own', () => {
    const m = agreeing(primary);
    const v = judgeSandbox(primary, m);
    expect(v.checks.map((c) => c.name)).toEqual([
      'corner',
      'device',
      'map',
      'fits',
      'rail',
      'ears',
      'scroll',
    ]);
    expect(v.pass, JSON.stringify(v.checks)).toBe(true);
    const failing = (patch: Partial<SandboxMeasured>): ReadonlyArray<string> =>
      judgeSandbox(primary, { ...m, ...patch })
        .checks.filter((c) => !c.pass)
        .map((c) => c.name);
    expect(failing({ corners: { tl: 55, tr: 55, br: 55, bl: 55 } })).toEqual(['corner']);
    expect(failing({ device: 'iphone-390x844' })).toEqual(['device']);
    expect(failing({ device: null })).toEqual(['device']);
    expect(failing({ map: { ...m.map, ear: 0 } })).toEqual(['map']);
    const ex = m.examples;
    expect(failing({ examples: { ...ex, cover: { ...ex.cover, fits: false } } })).toEqual(['fits']);
    expect(
      failing({ examples: { ...ex, cover: { ...ex.cover, gaps: { ...ex.cover.gaps, top: 9 } } } }),
    ).toEqual(['fits']);
    expect(failing({ examples: { ...ex, rail: { ...ex.rail, railButtons: 2 } } })).toEqual([
      'rail',
    ]);
    expect(
      failing({
        examples: {
          ...ex,
          rail: { ...ex.rail, placements: ['rail: right OVER AN ARC OR THE CUT'] },
        },
      }),
    ).toEqual(['rail']);
    expect(failing({ examples: { ...ex, ears: { ...ex.ears, ears: 1 } } })).toEqual(['ears']);
    expect(
      failing({
        examples: {
          ...ex,
          ears: {
            ...ex.ears,
            placements: ['ear1: left OVER AN ARC OR THE CUT', 'ear2: left segment 2'],
          },
        },
      }),
    ).toEqual(['ears']);
    expect(
      failing({ examples: { ...ex, board: { ...ex.board, scrollHeight: m.inner.h + 30 } } }),
    ).toEqual(['scroll']);
    expect(
      judgeSandbox(primary, {
        ...m,
        examples: { ...ex, board: { ...ex.board, scrollHeight: m.inner.h + 30 } },
      }).checks[6]?.detail,
    ).toBe('scrolls: board');
    // Upright in a tab: no free side, no ears; a rail or an ear shown fails.
    const up = agreeing(upright);
    expect(judgeSandbox(upright, up).pass).toBe(true);
    expect(
      judgeSandbox(upright, {
        ...up,
        examples: { ...up.examples, rail: { ...up.examples.rail, railButtons: 3 } },
      }).checks[4],
    ).toMatchObject({ name: 'rail', pass: false });
    expect(
      judgeSandbox(upright, {
        ...up,
        examples: { ...up.examples, ears: { ...up.examples.ears, ears: 2 } },
      }).checks[5],
    ).toMatchObject({ name: 'ears', pass: false });
    expect(SANDBOX_EXAMPLES).toEqual(['cover', 'board', 'rail', 'ears', 'gutters']);
  });

  test('the sheet holds both games: a sandbox card with its five pictures, the device line and the cut, under its own heading; the counts per game and overall', () => {
    const e = emulationFor(iphone12, 'landscape', 'browser', 'shown');
    const fm = fitting(e);
    const board = {
      name: 'iphone-390x844 landscape browser bar-shown',
      e,
      twin: twinOf(e),
      measured: fm,
      verdict: judge(e, fm),
      pictures: {
        home: 'a--home.png',
        curtain: 'a--curtain.png',
        roll: 'a--roll.png',
        board: 'a--board.png',
      },
    };
    const m = agreeing(primary);
    const sandbox = {
      name: sandboxName(primary),
      c: primary,
      measured: m,
      verdict: judgeSandbox(primary, m),
      pictures: Object.fromEntries(SANDBOX_EXAMPLES.map((x) => [x, `s--${x}.png`])),
    };
    const html = sheetHtml([board, sandbox], '20260929-1200');
    expect(html).toContain('2 of 2 cases pass');
    expect(html).toContain('Backgammon · 1 of 1 pass');
    expect(html).toContain('UI Sandbox · 1 of 1 pass');
    expect(html.match(/<section class="card/g)).toHaveLength(2);
    expect(html.match(/<img /g)).toHaveLength(4 + 5);
    expect(html).toContain('src="s--ears.png"');
    expect(html).toContain('(h) buttons in the ears');
    expect(html).toContain(
      '<p class="device">device iphone-393x852  iPhone 14 Pro, 15, 15 Pro, 16</p>',
    );
    expect(html).toContain(
      '<dt>cut</dt><dd>left at 83.5-209.5 (126), ear 68.5, free side right</dd>',
    );
    expect(html).toContain('<b>ears</b>');
    // Backgammon alone: no sandbox heading.
    expect(sheetHtml([board], 'x')).not.toContain('UI Sandbox ·');
  });
});

describe('the verdict', () => {
  test('a measurement at the twin passes every check', () => {
    const e = emulationFor(iphone12, 'landscape', 'browser', 'hidden');
    const v = judge(e, fitting(e));
    expect(v.checks.map((c) => c.name)).toEqual(['corner', 'fills', 'clear', 'scroll', 'targets']);
    expect(v.pass, JSON.stringify(v.checks)).toBe(true);
  });

  test('a corner off by the insets fails, as does a round top pair where the bar owns the top; four zeros pass upright in a tab', () => {
    const e = emulationFor(iphone12, 'landscape', 'standalone');
    const v = judge(e, { ...fitting(e), corners: { tl: 47, tr: 47.33, br: 47.33, bl: 47.33 } });
    expect(v.checks[0]).toMatchObject({ name: 'corner', pass: false });
    expect(v.checks[0]?.detail).toContain(
      'frame tl 47 tr 47.33 br 47.33 bl 47.33, catalogue tl 47.33 tr 47.33 br 47.33 bl 47.33',
    );
    const barUp = emulationFor(iphone12, 'landscape', 'browser', 'shown');
    expect(
      judge(barUp, { ...fitting(barUp), corners: { tl: 47.33, tr: 47.33, br: 47.33, bl: 47.33 } })
        .checks[0],
    ).toMatchObject({ name: 'corner', pass: false });
    expect(judge(barUp, fitting(barUp)).checks[0]).toMatchObject({ pass: true });
    // The page in fullscreen (the Android lock granted at the table): four round corners pass.
    const locked = judge(barUp, {
      ...fitting(barUp),
      fullscreen: true,
      corners: { tl: 47.33, tr: 47.33, br: 47.33, bl: 47.33 },
    });
    expect(locked.checks[0]).toMatchObject({ pass: true });
    expect(locked.checks[0]?.detail).toContain('(page in fullscreen)');
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
  test('the seam script writes the four insets on the root (the frame reads them) and on #app (the theme does)', () => {
    const sideways = seamScript(emulationFor(iphone12, 'landscape', 'standalone'));
    expect(sideways).toContain('const insets = {"top":0,"right":47,"bottom":21,"left":47}');
    expect(sideways).toContain("'--frame-inset-top'");
    expect(sideways).toContain("'--frame-inset-left'");
    expect(sideways).toContain("'--inset-l'");
    expect(seamScript(emulationFor(se, 'portrait', 'browser', 'shown'))).toContain(
      'const insets = {"top":0,"right":0,"bottom":0,"left":0}',
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
    const bad = judge(e, { ...fitting(e), corners: { tl: 0, tr: 0, br: 0, bl: 0 } });
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
