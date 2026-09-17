// Page-side script installed by Playwright (context.addInitScript) before any page script runs.
// Replaces Math.random with mulberry32 seeded from window.__e2eSeed, the same sequence as
// web/shared/lib/rng.algorithms.ts, so deals, dice and room codes repeat from run to run without
// any edit to the pages (docs/MIGRATION.md step 3). Plain JS: it executes in the browser, not node.
(() => {
  let a = window.__e2eSeed | 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
