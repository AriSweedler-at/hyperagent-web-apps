// The hand's sort order: the one vocabulary storage.ts (the `ginRummy_sort` key) and ui/hand/
// arrange.ts (the arrangement) share, at the src/ root because the lint zones let neither import
// the other.
export const SORT_MODES = ['suit', 'rank', 'manual'] as const;
/**
 * How the loose cards are ordered (the owner, 2026-09-22: "you arrange deadwood only, and melds
 * sit off to the side"): by suit then rank, by rank then suit, or `manual`, as the player left
 * them. The melds sit first in every mode, in the solver's order. A stored `melds` (the retired
 * solver-order mode) decodes as nothing and falls back to the default.
 */
export type SortMode = (typeof SORT_MODES)[number];
export const DEFAULT_SORT: SortMode = 'suit';
