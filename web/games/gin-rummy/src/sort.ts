// The hand's sort order: the one vocabulary storage.ts (the `ginRummy_sort` key) and ui/hand/
// arrange.ts (the arrangement) share, at the src/ root because the lint zones let neither import
// the other.
export const SORT_MODES = ['melds', 'rank', 'suit'] as const;
/** `melds`: the solver's order. `rank` and `suit`: every group by its lowest card, the loose cards likewise. */
export type SortMode = (typeof SORT_MODES)[number];
export const DEFAULT_SORT: SortMode = 'melds';
