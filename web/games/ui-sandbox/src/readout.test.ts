// The readout's text over a reading: the device line, the bar's state from the corners, the map
// and the media rows.
import { describe, expect, test } from 'vitest';

import type { FrameReading } from '../../../shared/edge/screen.ts';
import { safeAreaMap } from '../../../shared/lib/safeArea.ts';
import { EXAMPLES, diceLine, exampleById, exampleReport } from './examples.ts';
import { drawMap, mapRows } from './mapSvg.ts';
import { BAR_COPY, barOf, matchedDevice, readoutLines, type Readout } from './readout.ts';

const reading: FrameReading = {
  inputs: { screen: { width: 393, height: 852 }, dpr: 3, notch: 59 },
  insets: { top: 0, right: 59, bottom: 21, left: 59 },
  mode: 'browser',
  orientation: 'landscape',
  viewport: { width: 852, height: 343 },
  full: { width: 852, height: 393 },
  radius: 55,
  reach: { tl: false, tr: false, br: true, bl: true },
  corners: { tl: 0, tr: 0, br: 55, bl: 55 },
};
const map = safeAreaMap({
  corners: reading.corners,
  cut: { length: 126, island: true },
  type: 'landscape-primary',
  insets: reading.insets,
  viewport: { width: 852, height: 343 },
  full: reading.full,
});
const readout: Readout = {
  reading,
  type: 'landscape-primary',
  typeForced: false,
  visual: { width: 852, height: 343, scale: 1 },
  units: { svh: 343, dvh: 343, lvh: 393, vw: 852 },
  media: [
    ['LANDSCAPE_PHONE', true],
    ['hover none', false],
  ],
  map,
  flipped: false,
  frameOn: true,
};

describe('readout', () => {
  test('barOf: installed none; every corner hidden; top pair square top; bottom pair square bottom; else unknown', () => {
    const all = { tl: true, tr: true, br: true, bl: true };
    expect(barOf('standalone', all)).toBe('none');
    expect(barOf('browser', all)).toBe('hidden');
    expect(barOf('browser', reading.reach)).toBe('top');
    expect(barOf('browser', { tl: true, tr: true, br: false, bl: false })).toBe('bottom');
    expect(barOf('browser', { tl: false, tr: false, br: false, bl: false })).toBe('unknown');
    expect(Object.keys(BAR_COPY)).toHaveLength(5);
  });

  test('the lines: the matched row, the bar at the top, the corners, the map, the media', () => {
    expect(matchedDevice(reading)?.id).toBe('iphone-393x852');
    const lines = readoutLines(readout);
    expect(lines[0]).toContain('iphone-393x852');
    expect(lines[1]).toContain('126pt island');
    expect(lines).toContain(BAR_COPY.top);
    expect(lines.find((l) => l.startsWith('reaches'))).toBe(
      'reaches tl square  tr square  br 55  bl 55',
    );
    expect(lines.find((l) => l.startsWith('cut side'))).toContain(
      'cut side left  at 83.5-209.5 (126)',
    );
    expect(lines.find((l) => l.startsWith('safe left'))).toContain(', ');
    expect(lines.filter((l) => l.startsWith('match'))).toHaveLength(1);
    const unknown = readoutLines({
      ...readout,
      reading: { ...reading, inputs: null, viewport: null, full: null },
      type: null,
      typeForced: true,
      visual: null,
      frameOn: false,
      flipped: true,
      map: safeAreaMap({
        ...map,
        corners: reading.corners,
        cut: null,
        type: 'portrait-primary',
        insets: reading.insets,
        viewport: { width: 1, height: 1 },
        full: null,
      }),
    });
    expect(unknown[0]).toContain('unknown: heuristic');
    expect(unknown.find((l) => l.startsWith('display-mode'))).toContain(
      'type unavailable (forced by ?type=)',
    );
    expect(unknown.find((l) => l.startsWith('frame'))).toBe('frame off  flip on');
    expect(unknown.find((l) => l.startsWith('cut side'))).toBe('cut side none  ear 0');
  });

  test('the examples: nine ids, the fallback, the report over measured boxes', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual([
      'cover',
      'side',
      'sides',
      'top',
      'strips',
      'board',
      'rail',
      'ears',
      'gutters',
      'dice',
    ]);
    expect(exampleById('dice').label).toBe('(j) Dice in the Dynamic Island');
    expect(exampleById('dice').markup.markup).toContain('id="islandRollBtn"');
    expect(exampleById('dice').markup.markup).toContain('target="_blank"');
    expect(exampleById('dice').markup.markup.match(/class="die"/g)).toHaveLength(2);
    expect(exampleById('rail').label).toContain('(g)');
    const viewport = { width: 852, height: 343 };
    const r = exampleReport(
      [
        { name: 'content', rect: { left: 70, top: 11, width: 700, height: 300 }, fixed: false },
        { name: 'rail', rect: { left: 800, top: 60, width: 44, height: 200 }, fixed: true },
        { name: 'ear1', rect: { left: 7, top: 10, width: 44, height: 60 }, fixed: true },
      ],
      viewport,
      map,
      false,
    );
    expect(r.fits).toBe(true);
    expect(r.gaps).toEqual({ top: 11, left: 70, right: 82, bottom: 32 });
    expect(r.placements).toEqual(['rail: right segment 1', 'ear1: left segment 1']);
    expect(r.lines[0]).toBe('fits without scroll');
    // No room given: the boxes should reach the viewport's edge, and these do not.
    expect(r.fills).toBe(false);
    expect(r.room).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(r.lines[2]).toBe(
      'SHORT OF THE FRAME: top 11px (room 0)  right 82px (room 0)  bottom 32px (room 0)  left 70px (room 0)',
    );
    // The room sideways on an island phone: 11px of frame, the side insets 59 and the home indicator 21.
    const room = { clearance: 11, insets: { top: 0, right: 59, bottom: 21, left: 59 } };
    const full = exampleReport(
      [
        {
          name: 'content',
          rect: { left: 59, top: 11, width: 852 - 118, height: 343 - 32 },
          fixed: false,
        },
      ],
      viewport,
      map,
      false,
      room,
    );
    expect(full.fills).toBe(true);
    expect(full.room).toEqual({ top: 11, right: 59, bottom: 21, left: 59 });
    expect(full.lines[2]).toBe('fills the room the frame leaves');
    expect(full.lines[3]).toBe(
      'right held off by the 59px inset (the notch, the status bar or the home indicator), not the frame',
    );
    expect(full.lines[4]).toContain('bottom held off by the 21px inset');
    expect(full.lines[5]).toContain('left held off by the 59px inset');
    // A pixel of slack passes; two do not; a box past the room (into the inset) fails too.
    const shifted = (dx: number, dw: number): boolean =>
      exampleReport(
        [
          {
            name: 'content',
            rect: { left: 59 + dx, top: 11, width: 852 - 118 + dw, height: 343 - 32 },
            fixed: false,
          },
        ],
        viewport,
        map,
        false,
        room,
      ).fills;
    expect(shifted(1, -1)).toBe(true);
    expect(shifted(2, -2)).toBe(false);
    expect(shifted(-3, 3)).toBe(false);
    expect(shifted(0, 40)).toBe(false);
    const bad = exampleReport(
      [
        { name: 'x', rect: { left: -2, top: 0, width: 10, height: 10 }, fixed: false },
        { name: 'over', rect: { left: 7, top: 200, width: 44, height: 44 }, fixed: true },
      ],
      viewport,
      map,
      true,
    );
    expect(bad.fits).toBe(false);
    expect(bad.lines[0]).toBe('SCROLLS');
    expect(bad.placements[0]).toContain('OVER AN ARC OR THE CUT');
    const none = exampleReport([], viewport, map, false);
    expect(none.lines).toContain('uses no map segment');
    expect(none.lines[1]).toContain('top -');
    expect(
      exampleReport(
        [{ name: 'x', rect: { left: 0, top: 0, width: 10, height: 400 }, fixed: false }],
        viewport,
        map,
        false,
      ).lines[0],
    ).toBe('a box leaves the viewport');
  });

  test('the SVG: the glass, four arcs where the corners round, the hatched cut, one green rect per segment; the table one row per variable', () => {
    const svg = drawMap(map, { width: 852, height: 343 }, reading.corners);
    expect(svg).toContain('class="glass"');
    expect((svg.match(/class="arc"/g) ?? []).length).toBe(2);
    expect(svg).toContain('class="cut"');
    expect((svg.match(/class="seg"/g) ?? []).length).toBe(5);
    const noCut = drawMap(
      { ...map, cut: null, cutEdge: 'none' },
      { width: 852, height: 343 },
      { tl: 0, tr: 0, br: 0, bl: 0 },
    );
    expect(noCut).not.toContain('class="cut"');
    expect(noCut).not.toContain('class="arc"');
    const notch = drawMap(
      safeAreaMap({
        corners: reading.corners,
        cut: { length: 209, island: false },
        type: 'landscape-secondary',
        insets: reading.insets,
        viewport: { width: 852, height: 343 },
        full: reading.full,
      }),
      { width: 852, height: 343 },
      reading.corners,
    );
    expect(notch).toContain('rx="6"');
    ['portrait-primary', 'portrait-secondary'].forEach((type) => {
      const up = drawMap(
        safeAreaMap({
          corners: reading.corners,
          cut: { length: 126, island: true },
          type: type as 'portrait-primary',
          insets: { top: 59, right: 0, bottom: 34, left: 0 },
          viewport: { width: 393, height: 852 },
          full: { width: 393, height: 852 },
        }),
        { width: 393, height: 852 },
        reading.corners,
      );
      expect(up).toContain('class="cut"');
    });
    expect(mapRows({ '--a': '1px', '--b': 'left' })).toBe(
      '<tr><td>--a</td><td>1px</td></tr><tr><td>--b</td><td>left</td></tr>',
    );
  });
});

describe('diceLine: where example (j) seats its dice, for the report', () => {
  test('two ears on a vertical edge: one seat each; under 44px: flanking the cut; a horizontal cut edge: along it; no cut on the page: the corners', () => {
    expect(diceLine(map)).toBe('dice: one seat in each ear of the island on the left');
    const notch = safeAreaMap({
      corners: { tl: 0, tr: 0, br: 47.33, bl: 47.33 },
      cut: { length: 209, island: false },
      type: 'landscape-secondary',
      insets: { top: 0, right: 47, bottom: 21, left: 47 },
      viewport: { width: 844, height: 340 },
      full: { width: 844, height: 390 },
    });
    expect(notch.edges.right).toHaveLength(0);
    expect(diceLine(notch)).toBe(
      'dice: the ears beside this notch are under 44px: the seats flank the cut and overlap the arcs',
    );
    const upright = safeAreaMap({
      corners: { tl: 55, tr: 55, br: 55, bl: 55 },
      cut: { length: 126, island: true },
      type: 'portrait-primary',
      insets: { top: 59, right: 0, bottom: 34, left: 0 },
      viewport: { width: 393, height: 852 },
      full: { width: 393, height: 852 },
    });
    expect(upright.cutEdge).toBe('top');
    expect(diceLine(upright)).toBe(
      'dice: the cut is on the top edge: the seats flank it along that edge',
    );
    const underBar = safeAreaMap({
      corners: { tl: 0, tr: 0, br: 0, bl: 0 },
      cut: { length: 126, island: true },
      type: 'portrait-primary',
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      viewport: { width: 393, height: 660 },
      full: { width: 393, height: 852 },
    });
    expect(underBar.cut).toBeNull();
    expect(diceLine(underBar)).toContain('the seats sit in the top corners');
  });
});
