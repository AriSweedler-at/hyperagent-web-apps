// The four tavli-family rule rows (understand.md §5 R29-R31; panel E1 §5 `variants.ts`, with the
// judge's graft of `ownOf`/`absOf` on the rules). Portes and Western backgammon are implemented;
// plakoto and fevga are typed and framed so the engine's hooks (pinning in `isOpen`/`afterMove`,
// fevga's rotated frame) are exercised by tests without shipping the variants. `rulesOf` is typed
// on `ShippedVariant`, so no game can start under an `implemented: false` row.
import {
  POINTS,
  type PointIndex,
  type Seat,
  type ShippedVariant,
  type Variant,
  type VariantRules,
} from './types.ts';

/** The mirror frame (R2): Light counts own 1..24 from abs 0 upward, Dark from abs 23 downward. */
const mirrorOwnOf = (seat: Seat, abs: number): number => (seat === 0 ? abs + 1 : POINTS - abs);
/** Own 1..24 maps onto abs 0..23 one to one; the cast says so once for every frame function. */
const mirrorAbsOf = (seat: Seat, own: number): PointIndex =>
  (seat === 0 ? own - 1 : POINTS - own) as PointIndex;

/**
 * Fevga (R31): both seats travel the same way. In Light's frame Dark starts on abs 11 and travels
 * 11 -> 0 then 23 -> 12, so Dark's home is abs 12..17 and its own numbering is a rotation by 12.
 */
const fevgaOwnOf = (seat: Seat, abs: number): number =>
  seat === 0 ? abs + 1 : abs >= 12 ? abs - 11 : abs + 13;
const fevgaAbsOf = (seat: Seat, own: number): PointIndex =>
  (seat === 0 ? own - 1 : own <= 12 ? own + 11 : own - 13) as PointIndex;

/** R3, in own numbering: 24-point 2, 13-point 5, 8-point 3, 6-point 5. */
const STANDARD_START: ReadonlyArray<readonly [number, number]> = [
  [24, 2],
  [13, 5],
  [8, 3],
  [6, 5],
];
/** Plakoto and fevga start with all fifteen on the own 24-point. */
const STACKED_START: ReadonlyArray<readonly [number, number]> = [[24, 15]];

const portes: VariantRules = {
  implemented: true,
  name: 'Portes',
  hasBar: true,
  openingReroll: true,
  cube: false,
  maxMultiplier: 2,
  blocksAt: 2,
  onSingleOpponent: 'hit',
  sameDirection: false,
  start: STANDARD_START,
  ownOf: mirrorOwnOf,
  absOf: mirrorAbsOf,
  extraMoveConstraints: [],
  extraEndChecks: [],
};

export const VARIANTS: Readonly<Record<Variant, VariantRules>> = {
  portes,
  backgammon: {
    ...portes,
    name: 'Backgammon',
    openingReroll: false,
    cube: true,
    maxMultiplier: 3,
  },
  plakoto: {
    ...portes,
    implemented: false,
    name: 'Plakoto',
    hasBar: false,
    onSingleOpponent: 'pin',
    start: STACKED_START,
  },
  fevga: {
    ...portes,
    implemented: false,
    name: 'Fevga',
    hasBar: false,
    blocksAt: 1,
    onSingleOpponent: 'illegal',
    sameDirection: true,
    start: STACKED_START,
    ownOf: fevgaOwnOf,
    absOf: fevgaAbsOf,
  },
};

export const SHIPPED_VARIANTS: ReadonlyArray<ShippedVariant> = ['portes', 'backgammon'];

export const isShippedVariant = (x: string): x is ShippedVariant =>
  SHIPPED_VARIANTS.some((v) => v === x);

export const rulesOf = (variant: ShippedVariant): VariantRules => VARIANTS[variant];
