// Module evaluation order (docs/MIGRATION.md step 6). In the bundle every section ran in order
// inside one IIFE; as ES modules each one must be able to evaluate on its own, with only its
// imports before it. Every de-bundled module under src/ is imported standalone here (a fresh module
// registry each time) and every binding it exports is compared with the legacy fixture's binding of
// the same name: eager tables (HANDS, GROUPS, RANKS, BID_LADDER, POOL, ...) must come out populated
// and identical; functions must be functions on both sides.
import { describe, expect, test, vi } from 'vitest';

import { loadLegacyFidice, currentFidiceModules, importFidiceModule } from './fidice.api.ts';

const legacy = loadLegacyFidice() as unknown as Readonly<Record<string, unknown>>;

/** Tables the bundle built at evaluation time, by the module that owns them, with their sizes. */
const EAGER_TABLES: ReadonlyArray<readonly [string, string, number]> = [
  ['src/domain/hands.js', 'HANDS', 252],
  ['src/domain/hands.js', 'GROUPS', 48],
  ['src/domain/hands.js', 'CATEGORY_INFO', 8],
  ['src/domain/hands.js', 'BY_SHAPE', 252],
  ['src/domain/hands.js', 'GROUP_BY_KEY', 48],
  ['src/bots/strategies/gambler.js', 'GROUP_TOPS', 48],
  ['src/bots/strategies/pressure.js', 'RANKS', 252],
  ['src/bots/strategies/learner.js', 'BID_LADDER', 48],
  ['src/bots/registry.js', 'LEARNERS', 3],
  ['src/bots/registry.js', 'SHIPPED', 3],
  ['src/bots/registry.js', 'POOL', 10],
  ['src/bots/registry.js', 'byId', 10],
  ['src/bots/registry.js', 'DIFFICULTIES', 3],
];

/** Structural view of a binding: functions collapse to a tag, Maps and Sets to their entries. */
const shape = (value: unknown): unknown => {
  if (typeof value === 'function') return '[function]';
  if (value instanceof RegExp) return String(value);
  if (value instanceof Map)
    return { map: [...value.entries()].map(([k, v]) => [shape(k), shape(v)]) };
  if (value instanceof Set) return { set: [...value].map(shape) };
  if (Array.isArray(value)) return value.map(shape);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  return value;
};

const sizeOf = (value: unknown): number =>
  Array.isArray(value) ? value.length : value instanceof Map ? value.size : -1;

describe('each pure module evaluates standalone', () => {
  const modules = currentFidiceModules();

  test('the fixture range covers 25 modules, dice through search', () => {
    expect(modules).toHaveLength(25);
    expect(modules[0]).toBe('src/assets/diceImages.js');
    expect(modules.at(-1)).toBe('src/domain/search.js');
  });

  describe.each(modules.map((file) => [file] as const))('%s', (file) => {
    test('imports on a fresh registry and every export matches the legacy binding', async () => {
      vi.resetModules();
      const ns = await importFidiceModule(file);
      const names = Object.keys(ns);
      expect(names.length).toBeGreaterThan(0);
      names.forEach((name) => {
        expect(name in legacy, `${name} is a legacy binding`).toBe(true);
        expect(shape(ns[name]), name).toEqual(shape(legacy[name]));
      });
    });
  });

  test.each(EAGER_TABLES)(
    '%s builds %s (%i rows) when imported alone',
    async (file, name, rows) => {
      vi.resetModules();
      const ns = await importFidiceModule(file);
      expect(sizeOf(ns[name])).toBe(rows);
      expect(sizeOf(legacy[name])).toBe(rows);
      expect(shape(ns[name])).toEqual(shape(legacy[name]));
    },
  );
});
