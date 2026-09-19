// Ties test/fixtures/legacy/gin-wire/*.json to its recorder (docs/MIGRATION.md step 11): the
// corpus is re-recorded from the pinned legacy engine with the clock pinned and must equal the
// files on disk, key order included, and it must hold every frame tag the legacy UI sends and every
// position class the protocol tests rely on. A change here means the legacy engine fixture, the
// parity policy or the recorder changed; re-run `npm run fixtures:gin-wire` and say why.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { REPO_ROOT } from '../../../tools/legacy/extract.ts';
import {
  WIRE_DIR,
  corpusFile,
  recordGinWire,
  type Frame,
} from '../../../tools/legacy/record-gin-wire.ts';

const WIRE_TAGS = ['join', 'welcome', 'lobby', 'full', 'toast', 'state', 'action'] as const;
const GOLDEN_SIZE_LIMIT = 100 * 1024;

const onDisk = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    readdirSync(resolve(REPO_ROOT, WIRE_DIR))
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f.slice(0, -'.json'.length), readFileSync(corpusFile(f.slice(0, -5)), 'utf8')]),
  );

const files = onDisk();
const corpus = recordGinWire();
const frames: ReadonlyArray<Frame> = Object.values(files).flatMap(
  (text) => JSON.parse(text) as Frame[],
);

describe('the gin wire corpus', () => {
  test('is what the recorder produces from the pinned legacy engine (values and key order)', () => {
    expect(Object.keys(files).sort()).toEqual(Object.keys(corpus).sort());
    Object.entries(corpus).forEach(([name, recorded]) => {
      const text = files[name] ?? '';
      expect(JSON.parse(text), name).toEqual(recorded);
      expect(JSON.stringify(JSON.parse(text)), `${name}: key order`).toBe(JSON.stringify(recorded));
    });
  });

  test('holds every tag the legacy UI sends, and nothing else', () => {
    const tags = new Set(frames.map((f) => f['t']));
    expect([...tags].sort()).toEqual([...WIRE_TAGS].sort());
  });

  test('the state frames cover every phase, outcome and the marked positions', () => {
    const views = frames
      .filter((f) => f['t'] === 'state')
      .map((f) => f['view'] as Readonly<Record<string, unknown>>);
    const phases = new Set(views.map((v) => v['phase']));
    expect([...phases].sort()).toEqual(['discard', 'draw', 'gameOver', 'roundOver', 'upcard']);
    const results = views
      .map((v) => v['result'] as Readonly<Record<string, unknown>> | null)
      .filter((r): r is Readonly<Record<string, unknown>> => r !== null);
    expect(new Set(results.map((r) => (r['void'] === true ? 'void' : r['outcome'])))).toEqual(
      new Set(['gin', 'knock', 'undercut', 'void']),
    );
    expect(views.some((v) => v['forceStock'] === true)).toBe(true);
    expect(views.some((v) => v['canUndo'] === true)).toBe(true);
    expect(views.some((v) => v['lastDrawnId'] !== null)).toBe(true);
    expect(views.some((v) => (v['meldOptions'] as unknown[]).length > 1)).toBe(true);
    expect(
      views.some((v) =>
        Object.values(
          (v['discardOptions'] as Record<string, { locked?: boolean }> | null) ?? {},
        ).some((o) => o.locked === true),
      ),
    ).toBe(true);
    const lastActionShapes = new Set(
      views.map((v) => Object.keys((v['lastAction'] as object | null) ?? {}).join(',')),
    );
    expect(lastActionShapes).toEqual(new Set(['text', 'text,by', 'text,card,by']));
  });

  test('the action frames carry every action type the UI sends', () => {
    const types = frames
      .filter((f) => f['t'] === 'action')
      .map((f) => (f['action'] as Readonly<Record<string, unknown>>)['type']);
    expect([...types].sort()).toEqual(
      [
        'discard',
        'drawDiscard',
        'drawStock',
        'knock',
        'passUpcard',
        'ready',
        'setMelds',
        'takeUpcard',
        'undoDraw',
      ].sort(),
    );
  });

  test('every file stays under the golden size limit', () => {
    Object.entries(files).forEach(([name, text]) => {
      expect(Buffer.byteLength(text, 'utf8'), name).toBeLessThan(GOLDEN_SIZE_LIMIT);
    });
  });
});
