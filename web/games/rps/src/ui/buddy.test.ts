// The page's frame table against the manifest it mirrors (web/public/games/rps/buddy/buddy.json,
// docs/design/rps-buddy.md §3): every loop's frames, ms, sheet, colour and band, every hop's ends,
// so a regenerated manifest that changes a number fails here before the page draws it wrong.
import { describe, expect, test } from 'vitest';

import BUDDY_JSON from '../../../../public/games/rps/buddy/buddy.json?raw';
import { moodOf } from '../engine/engine.ts';
import {
  BUDDY_SETS,
  FRAME_PX,
  HOPS,
  LOOPS,
  SET_OF,
  hopBetween,
  hopMs,
  sheetUrl,
  type BuddySet,
} from './buddy.ts';

type Row = Readonly<{
  frames: number;
  ms: number;
  sheet: string;
  w: number;
  h: number;
  motion: string;
  band?: string;
  colour?: string;
  min?: number;
  max?: number;
  from?: string;
  to?: string;
}>;
type Manifest = Readonly<{
  size: number;
  moods: Readonly<Record<string, Row>>;
  transitions: Readonly<Record<string, Row>>;
}>;

const manifest = JSON.parse(BUDDY_JSON) as Manifest;

describe('the buddy table is the manifest', () => {
  test('one loop per set, with the manifest frames, ms, sheet and colour, 24 px square', () => {
    expect(manifest.size).toBe(FRAME_PX);
    expect(Object.keys(manifest.moods).sort()).toEqual([...BUDDY_SETS].sort());
    BUDDY_SETS.forEach((set) => {
      const row = manifest.moods[set];
      expect(row, set).toBeDefined();
      expect(LOOPS[set], set).toEqual({
        frames: row?.frames,
        ms: row?.ms,
        sheet: row?.sheet,
        colour: row?.colour,
      });
      expect(row?.w).toBe(FRAME_PX);
      expect(row?.h).toBe(FRAME_PX);
    });
  });

  test('each set is its band, and the band is the counter range the manifest says', () => {
    BUDDY_SETS.forEach((set) => {
      const row = manifest.moods[set];
      const mood = (Object.keys(SET_OF) as ReadonlyArray<keyof typeof SET_OF>).find(
        (m) => SET_OF[m] === set,
      );
      expect(mood, set).toBe(row?.band);
      const counters = Array.from(
        { length: (row?.max ?? 0) - (row?.min ?? 0) + 1 },
        (_, i) => (row?.min ?? 0) + i,
      );
      counters.forEach((counter) => {
        expect(SET_OF[moodOf(counter)], String(counter)).toBe(set);
      });
    });
  });

  test('the hops are the manifest transitions, from the sadder set to the happier', () => {
    const rows = Object.entries(manifest.transitions).map(([name, row]) => ({ name, ...row }));
    expect(rows).toHaveLength(HOPS.length);
    HOPS.forEach((hop) => {
      const row = rows.find((r) => r.sheet === hop.sheet);
      expect(row, hop.sheet).toMatchObject({
        frames: hop.frames,
        ms: hop.ms,
        from: hop.from,
        to: hop.to,
        motion: 'hop',
      });
      expect(row?.name).toBe(`${hop.from}-to-${hop.to}`);
      expect(BUDDY_SETS.indexOf(hop.to) - BUDDY_SETS.indexOf(hop.from)).toBe(1);
    });
  });
});

describe('choosing a hop', () => {
  test('up plays forward, down plays in reverse, the same set or a jump of two has none', () => {
    const up = hopBetween('neutral', 'happy');
    expect(up?.reverse).toBe(false);
    expect(up?.hop.sheet).toBe('neutral-to-happy.png');
    const down = hopBetween('happy', 'neutral');
    expect(down?.reverse).toBe(true);
    expect(down?.hop.sheet).toBe('neutral-to-happy.png');
    expect(hopBetween('happy', 'happy')).toBeNull();
    expect(hopBetween('very-sad', 'neutral')).toBeNull();
    expect(hopBetween('very-happy', 'sad')).toBeNull();
  });

  test('a hop plays once for frames × ms', () => {
    const hop = hopBetween('very-sad', 'sad');
    expect(hop === null ? 0 : hopMs(hop.hop)).toBe(480);
  });

  test('sheets are reached document-relative under the page, so both origins serve them', () => {
    const sets: ReadonlyArray<BuddySet> = BUDDY_SETS;
    sets.forEach((set) => {
      expect(sheetUrl(LOOPS[set].sheet)).toBe(`./buddy/${set}.png`);
    });
    expect(sheetUrl('x.png').startsWith('/')).toBe(false);
  });
});
