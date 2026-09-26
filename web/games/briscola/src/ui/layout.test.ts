import { describe, expect, test } from 'vitest';

import { packByName, packsFor } from '../../../../shared/lib/cards/packs.ts';
import { resolveAspect } from '../../../../shared/lib/cards/resolve.ts';
import type { Seat, SeatCount } from '../engine/index.ts';
import {
  AREAS,
  ASPECT_RANGE,
  BRISCOLA_SHIFT,
  CELLS,
  CELL_POS,
  CHIP_H,
  CHIP_STEP,
  DEFAULT_ASPECT,
  DESKTOP_GEOMETRY,
  DESKTOP_TEMPLATE,
  FAN_OVERLAP,
  MAX_TRICKS,
  PHONE_GEOMETRY,
  PHONE_TEMPLATE,
  ROW_HEIGHTS,
  STRIP_WIDTHS,
  areaOrder,
  bandHeight,
  briscolaBox,
  cardHeight,
  cardWidth,
  cellId,
  cellOf,
  chipStep,
  chipWidth,
  columnHeight,
  coveredFraction,
  fanAngle,
  fanStep,
  fanWidth,
  fits,
  layoutFor,
  midWidth,
  relativeOf,
  sameAspect,
  seatCells,
  stockAreaWidth,
  stripWidth,
  templateFor,
  tinyWidth,
} from './layout.ts';

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const PHONE_SHORT = { width: 375, height: 667 };
/** The shipped packs' boxes: linea (the default), napoletane's printed 51 × 83 and american (gin's 100 × 144). */
const ASPECTS = [DEFAULT_ASPECT, 51 / 83, 100 / 144];
const COUNTS: ReadonlyArray<SeatCount> = [2, 3, 4];

describe('the card clamps (theme.css #tableScreen --card-w)', () => {
  test('a phone is width-bound: three cards in the 334px between the gutters', () => {
    expect(layoutFor(PHONE.width)).toBe('phone');
    expect(cardWidth(PHONE)).toBeCloseTo((390 - PHONE_GEOMETRY.gutters) / 3, 3);
    expect(cardHeight(cardWidth(PHONE))).toBeCloseTo(214.9, 1);
    expect(midWidth(cardWidth(PHONE))).toBeCloseTo(69.0, 1);
    expect(tinyWidth('phone')).toBe(26);
  });

  test('the desktop reaches the 132px ceiling at 1280x800 at every shipped aspect', () => {
    expect(layoutFor(DESKTOP.width)).toBe('desktop');
    ASPECTS.forEach((aspect) => {
      expect(cardWidth(DESKTOP, aspect)).toBe(DESKTOP_GEOMETRY.maxCardW);
    });
    expect(tinyWidth('desktop')).toBe(30);
  });

  test('a short phone floors at 72px: the height budget (91px * aspect) is under the floor', () => {
    expect(cardWidth(PHONE_SHORT)).toBe(PHONE_GEOMETRY.minCardW);
    expect(cardWidth({ width: 390, height: 720 })).toBeCloseTo(144 * DEFAULT_ASPECT, 3);
  });

  test('the column fits both design viewports at every shipped aspect, and the short phone at the floor', () => {
    ASPECTS.forEach((aspect) => {
      expect(columnHeight(PHONE, aspect)).toBeLessThanOrEqual(PHONE.height);
      expect(columnHeight(DESKTOP, aspect)).toBeLessThanOrEqual(DESKTOP.height);
      expect(fits(PHONE, aspect) && fits(DESKTOP, aspect)).toBe(true);
    });
    // 414 + 139 + 86 at the 72px floor with the default deck: the short phone does not scroll.
    expect(columnHeight(PHONE_SHORT)).toBeCloseTo(639, 0);
    expect(fits(PHONE_SHORT)).toBe(true);
    expect(fits({ width: 375, height: 600 })).toBe(false);
  });

  test('the column never overflows a viewport above the floors, at any aspect in range', () => {
    const heights = Array.from({ length: 40 }, (_, i) => 700 + i * 10);
    const widths = [360, 390, 430, 600, 900, 1024, 1280, 1600];
    [ASPECT_RANGE.min, 0.518, 0.577, 51 / 83, 0.66, 100 / 144, ASPECT_RANGE.max].forEach(
      (aspect) => {
        widths.forEach((width) => {
          heights.forEach((height) => {
            expect(
              fits({ width, height }, aspect),
              `${String(width)}x${String(height)} @ ${String(aspect)}`,
            ).toBe(true);
          });
        });
      },
    );
  });

  test('ASPECT_RANGE is [0.50, 0.70]: every pack a briscola table can choose sits inside it, and the floor is where the two clamps meet', () => {
    expect(ASPECT_RANGE).toEqual({ min: 0.5, max: 0.7 });
    packsFor('italian40').forEach((name) => {
      const aspect = resolveAspect(packByName(name), 'italian40');
      expect(aspect, name).toBeGreaterThanOrEqual(ASPECT_RANGE.min);
      expect(aspect, name).toBeLessThanOrEqual(ASPECT_RANGE.max);
    });
    // The default pack's box is the printed Napoletane card, 51 × 83 (design §2.1), not its scan's 0.577.
    expect(resolveAspect(packByName('napoletane'), 'italian40')).toBeCloseTo(0.6145, 4);
    // Below the floor the height budget still binds as the width cap arrives: a Trevigiane-shaped
    // card (0.47) overtops 1280×820 by 8px and 430×840 by 1px, where the floor itself fits.
    [0.47, 0.48].forEach((aspect) => {
      expect(fits({ width: 1280, height: 820 }, aspect), String(aspect)).toBe(false);
    });
    expect(fits({ width: 430, height: 840 }, 0.47)).toBe(false);
    expect(fits({ width: 1280, height: 820 }, ASPECT_RANGE.min)).toBe(true);
    expect(fits({ width: 430, height: 840 }, ASPECT_RANGE.min)).toBe(true);
  });

  test('the band is a mid card plus 46px; the fixed rows are the design heights', () => {
    expect(bandHeight(cardWidth(PHONE))).toBeCloseTo(69 / DEFAULT_ASPECT + 46, 0);
    expect(ROW_HEIGHTS).toEqual({ topbar: 44, score: 44, status: 22, handHeader: 24, actions: 54 });
    expect(PHONE_GEOMETRY.seatsH).toBe(86);
    expect(DESKTOP_GEOMETRY.seatsH).toBe(96);
  });
});

describe('the seats (design §5.2 seatCells)', () => {
  const SEATS: ReadonlyArray<Seat> = [0, 1, 2, 3];

  test('the cells are right, top, left, ids #seatR1..R3', () => {
    expect(CELLS.map((c) => CELL_POS[c])).toEqual(['right', 'top', 'left']);
    expect(CELLS.map(cellId)).toEqual(['seatR1', 'seatR2', 'seatR3']);
  });

  test('2: the opponent across; 3: next right, other left; 4: partner across', () => {
    expect(seatCells(2, 0)).toEqual({ R1: null, R2: 1, R3: null });
    expect(seatCells(2, 1)).toEqual({ R1: null, R2: 0, R3: null });
    expect(seatCells(3, 0)).toEqual({ R1: 1, R2: null, R3: 2 });
    expect(seatCells(3, 2)).toEqual({ R1: 0, R2: null, R3: 1 });
    expect(seatCells(4, 0)).toEqual({ R1: 1, R2: 2, R3: 3 });
    expect(seatCells(4, 3)).toEqual({ R1: 0, R2: 1, R3: 2 });
  });

  test('for all nine (n, me): every other seat has one cell, R1 plays next, and relativeOf inverts it', () => {
    COUNTS.forEach((n) => {
      SEATS.filter((me) => me < n).forEach((me) => {
        const cells = seatCells(n, me);
        const seated = CELLS.map((c) => cells[c]).filter((s): s is Seat => s !== null);
        expect([...seated].sort()).toEqual(SEATS.filter((s) => s < n && s !== me));
        expect(cells.R1 ?? cells.R2).toBe((me + 1) % n);
        CELLS.forEach((cell) => {
          const seat = cells[cell];
          if (seat !== null) expect(cellOf(n, relativeOf(n, me, seat))).toBe(cell);
        });
      });
    });
    expect([cellOf(2, 0), cellOf(2, 2), cellOf(4, 4)]).toEqual([null, null, null]);
  });
});

describe('the trick fan', () => {
  test('overlap by count, and a shallow fan about its middle', () => {
    expect(FAN_OVERLAP).toEqual({ 2: 0, 3: 0.35, 4: 0.45 });
    expect([fanAngle(0, 2), fanAngle(1, 2)]).toEqual([-2, 2]);
    expect([fanAngle(0, 3), fanAngle(1, 3), fanAngle(2, 3)]).toEqual([-4, 0, 4]);
    expect([0, 1, 2, 3].map((i) => fanAngle(i, 4))).toEqual([-6, -2, 2, 6]);
  });

  test('a full fan fits right of the stock on the phone at every count', () => {
    const mid = midWidth(cardWidth(PHONE));
    // The band: 390 less #app's 24px of gutters, the band's 20px of padding, the stock area and a 10px gap.
    const band = 390 - 24 - 20 - stockAreaWidth(mid) - 10;
    COUNTS.forEach((n) => {
      expect(fanWidth(n, mid)).toBeLessThan(band);
    });
    expect(fanWidth(2, 69)).toBeCloseTo(138, 5);
    expect(fanWidth(4, 69)).toBeCloseTo(69 + 3 * 69 * 0.55, 5);
    expect(fanStep(4, 69)).toBeCloseTo(37.95, 5);
  });
});

describe('the stock and the briscola (design §5.3, T3)', () => {
  const stock = { x: 100, y: 50, w: 69, h: 133 };

  test('the briscola is the stock swapped, slid 0.55 widths right about the same centre', () => {
    expect(BRISCOLA_SHIFT).toBe(0.55);
    const b = briscolaBox(stock);
    expect([b.w, b.h]).toEqual([stock.h, stock.w]);
    expect(b.x + b.w / 2).toBeCloseTo(stock.x + stock.w / 2 + 0.55 * stock.w, 5);
    expect(b.y + b.h / 2).toBeCloseTo(stock.y + stock.h / 2, 5);
  });

  test('the stock hides 40-60% of it at any aspect in range, and the area is wide enough for both', () => {
    [ASPECT_RANGE.min, 0.518, 51 / 83, 0.62, 100 / 144, ASPECT_RANGE.max].forEach((aspect) => {
      const s = { x: 0, y: 0, w: 69, h: 69 / aspect };
      const covered = coveredFraction(s, briscolaBox(s));
      expect(covered).toBeGreaterThan(0.4);
      expect(covered).toBeLessThan(0.6);
      expect(briscolaBox(s).x + briscolaBox(s).w).toBeLessThanOrEqual(
        stockAreaWidth(69, aspect) + 1e-9,
      );
    });
    expect(coveredFraction(stock, { x: 500, y: 0, w: 10, h: 10 })).toBe(0);
    expect(coveredFraction(stock, { x: 0, y: 0, w: 0, h: 0 })).toBe(0);
  });

  test('sameAspect reads a box against the pack within 2%', () => {
    expect(sameAspect({ x: 0, y: 0, w: 111.3, h: 214.9 }, DEFAULT_ASPECT)).toBe(true);
    expect(sameAspect({ x: 0, y: 0, w: 111.3, h: 200 }, DEFAULT_ASPECT)).toBe(false);
  });
});

describe('the grid', () => {
  test('the phone is one column, the desktop puts the score strip beside the band', () => {
    expect(PHONE_TEMPLATE).toEqual(AREAS.map((a) => [a]));
    expect(DESKTOP_TEMPLATE[2]).toEqual(['center', 'score']);
    expect(templateFor('phone')).toBe(PHONE_TEMPLATE);
    expect(areaOrder('phone')).toEqual(AREAS);
    expect(areaOrder('desktop')).toEqual(AREAS);
  });
});

describe('the taken strips (theme.css .seat-taken, .card.chip)', () => {
  test('a chip is the hand header row tall and the pack aspect wide; the design figures', () => {
    expect(CHIP_H).toBe(ROW_HEIGHTS.handHeader);
    expect(chipWidth()).toBeCloseTo(24 * 0.518, 6);
    expect(chipWidth(0.62)).toBeCloseTo(14.88, 6);
    expect(CHIP_STEP).toBe(6);
    expect(STRIP_WIDTHS).toEqual({
      phone: { seat: 48, mine: 132 },
      desktop: { seat: 96, mine: 240 },
    });
    expect(MAX_TRICKS).toEqual({ 2: 20, 3: 13, 4: 10 });
  });

  test('the row: nothing at 0, one chip at 1, a step more per chip, the step shrinking so the strip never overflows', () => {
    const seat = STRIP_WIDTHS.phone.seat;
    expect(stripWidth(0, seat)).toBe(0);
    expect(stripWidth(1, seat)).toBeCloseTo(chipWidth(), 6);
    expect(stripWidth(2, seat)).toBeCloseTo(chipWidth() + 6, 6);
    // Seven chips just fill a phone's seat strip at the full step (12.43 + 6 x 5.93 = 48).
    expect(chipStep(7, seat)).toBeCloseTo((48 - chipWidth()) / 6, 6);
    expect(stripWidth(7, seat)).toBeCloseTo(48, 6);
    // Twenty press together at under 2px a step and still fit.
    expect(chipStep(20, seat)).toBeCloseTo((48 - chipWidth()) / 19, 6);
    expect(stripWidth(20, seat)).toBeCloseTo(48, 6);
    // My header strip grows a full step for every trick of a two-player game.
    expect(chipStep(20, STRIP_WIDTHS.phone.mine)).toBe(6);
    expect(stripWidth(20, STRIP_WIDTHS.phone.mine)).toBeCloseTo(chipWidth() + 19 * 6, 6);
  });

  test('the row never shrinks as tricks are taken and fits its strip at every count a seat can reach, on both layouts', () => {
    (['phone', 'desktop'] as const).forEach((layout) => {
      const widths = STRIP_WIDTHS[layout];
      ([2, 3, 4] as const).forEach((n) => {
        [widths.seat, widths.mine].forEach((stripW) => {
          const rows = Array.from({ length: MAX_TRICKS[n] + 1 }, (_, k) => stripWidth(k, stripW));
          rows.forEach((w, k) => {
            expect(w, `${layout} ${String(stripW)} at ${String(k)}`).toBeLessThanOrEqual(
              stripW + 1e-9,
            );
            if (k > 0) expect(w).toBeGreaterThanOrEqual((rows[k - 1] ?? 0) - 1e-9);
          });
        });
      });
    });
  });
});
