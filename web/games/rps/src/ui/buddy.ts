// The buddy's frame sets as the page draws them (docs/design/rps-buddy.md §3; the manifest
// web/public/games/rps/buddy/buddy.json): one loop per band and one hop between neighbouring bands,
// each a sheet `frames × 24` wide the CSS plays with `steps(frames)`. The numbers are the
// manifest's, spelled here because a page may not import from web/public (Vite serves it verbatim,
// a fetch would add a round trip and a loading state); buddy.test.ts pins this table to the file,
// so the two cannot drift. The static face (§3 step 5 of rps-island.md) is the first frame of the
// band's loop, drawn from the same sheet at `background-position: 0 0`.
import type { Mood } from '../engine/engine.ts';

/** The five sets, named as the folder names them. */
export type BuddySet = 'very-sad' | 'sad' | 'neutral' | 'happy' | 'very-happy';

export const BUDDY_SETS: ReadonlyArray<BuddySet> = [
  'very-sad',
  'sad',
  'neutral',
  'happy',
  'very-happy',
];

/** The band's set: the wire name onto the folder name. */
export const SET_OF: Readonly<Record<Mood, BuddySet>> = {
  verySad: 'very-sad',
  sad: 'sad',
  neutral: 'neutral',
  happy: 'happy',
  veryHappy: 'very-happy',
};

/** One sheet's facts: how many frames, how long each shows, the file, the body colour. */
export type Sheet = Readonly<{ frames: number; ms: number; sheet: string; colour: string }>;

/** A frame is 24 × 24 px; the page draws it at an integer multiple (2× the face, 3× the buddy). */
export const FRAME_PX = 24;

export const LOOPS: Readonly<Record<BuddySet, Sheet>> = {
  'very-sad': { frames: 6, ms: 220, sheet: 'very-sad.png', colour: '#3b6fd6' },
  sad: { frames: 6, ms: 240, sheet: 'sad.png', colour: '#6c9bea' },
  neutral: { frames: 4, ms: 160, sheet: 'neutral.png', colour: '#f2e6a8' },
  happy: { frames: 6, ms: 110, sheet: 'happy.png', colour: '#f5cd3b' },
  'very-happy': { frames: 6, ms: 90, sheet: 'very-happy.png', colour: '#ffd200' },
};

export type Hop = Readonly<{ from: BuddySet; to: BuddySet }> & Omit<Sheet, 'colour'>;

/** The four hops, each drawn upward (sadder to happier); the way down plays it in reverse. */
export const HOPS: ReadonlyArray<Hop> = [
  { from: 'very-sad', to: 'sad', frames: 4, ms: 120, sheet: 'very-sad-to-sad.png' },
  { from: 'sad', to: 'neutral', frames: 4, ms: 120, sheet: 'sad-to-neutral.png' },
  { from: 'neutral', to: 'happy', frames: 4, ms: 120, sheet: 'neutral-to-happy.png' },
  { from: 'happy', to: 'very-happy', frames: 4, ms: 120, sheet: 'happy-to-very-happy.png' },
];

/** The hop between two neighbouring sets and its direction; none for the same set or a jump of two (a Reset). */
export const hopBetween = (
  from: BuddySet,
  to: BuddySet,
): Readonly<{ hop: Hop; reverse: boolean }> | null => {
  const up = HOPS.find((h) => h.from === from && h.to === to);
  if (up !== undefined) return { hop: up, reverse: false };
  const down = HOPS.find((h) => h.from === to && h.to === from);
  return down === undefined ? null : { hop: down, reverse: true };
};

/** How long a hop plays once, in ms. */
export const hopMs = (hop: Hop): number => hop.frames * hop.ms;

/** The sheet's URL from the page: document-relative, so both origins serve it (`games/rps/buddy/`). */
export const sheetUrl = (sheet: string): string => `./buddy/${sheet}`;
