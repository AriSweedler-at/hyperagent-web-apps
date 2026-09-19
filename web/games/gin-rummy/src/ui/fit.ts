// The table-fit maths (docs/MIGRATION.md step 11; docs/ARCHITECTURE.md "Seams reserved": phone
// layout stability). The legacy `fitTable()` (legacy/gin-rummy/index.html, pinned in
// test/fixtures/legacy/gin-ui.cjs) sets `--tscale` to 1, then shrinks it by 0.05 while the table or
// the hand overflows and the scale is above 0.5, measuring the DOM after each step. The measuring
// stays in render.ts (step 12); the decision is here, pure over the measured sizes, so the
// layout-thrash loop can be replaced without touching the renderer. test/parity/gin.ui.test.ts runs
// `fitScale` beside the legacy loop over seeded measurement functions.

/** The four sizes `fitTable` read: `#app` and `#hand`, scroll and client heights. */
export type Measure = Readonly<{
  appScrollHeight: number;
  appClientHeight: number;
  handScrollHeight: number;
  handClientHeight: number;
}>;

export const MAX_SCALE = 1;
export const MIN_SCALE = 0.5;
export const SCALE_STEP = 0.05;

/** Either element's content is taller than its box (a 1px tolerance, as the legacy had). */
export const overflows = (m: Measure): boolean =>
  m.appScrollHeight > m.appClientHeight + 1 || m.handScrollHeight > m.handClientHeight + 1;

/** One step down, rounded to two decimals so `0.7 - 0.05` is `0.65` and not `0.6499…`. */
export const stepDown = (scale: number): number => Math.round((scale - SCALE_STEP) * 100) / 100;

/**
 * The scale to try next given what `scale` measured, or null when the loop stops: the table fits,
 * or the scale is already at the floor.
 */
export const nextScale = (scale: number, measured: Measure): number | null =>
  scale > MIN_SCALE && overflows(measured) ? stepDown(scale) : null;

/** The whole loop: `measureAt(scale)` is the DOM read after `--tscale` is set to `scale`. */
export const fitScale = (measureAt: (scale: number) => Measure, scale = MAX_SCALE): number => {
  const next = nextScale(scale, measureAt(scale));
  return next === null ? scale : fitScale(measureAt, next);
};
