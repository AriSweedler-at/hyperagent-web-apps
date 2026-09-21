// Loaders for the step 11 oracles (docs/MIGRATION.md): the wire corpus, the storage captures and
// the pinned legacy UI helpers, shared by the gin protocol, storage, ui and scorer parity suites.
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type { Capture } from '../../tools/legacy/capture-gin-storage.ts';
import { STORAGE_DIR } from '../../tools/legacy/capture-gin-storage.ts';
import { REPO_ROOT } from '../../tools/legacy/extract.ts';
import { WIRE_DIR } from '../../tools/legacy/record-gin-wire.ts';
import type { GinEngine } from './gin.api.ts';

const load = createRequire(import.meta.url);

export type WireFrame = Readonly<{ file: string; index: number; frame: Record<string, unknown> }>;

const jsonFiles = (dir: string): ReadonlyArray<string> =>
  readdirSync(resolve(REPO_ROOT, dir))
    .filter((f) => f.endsWith('.json'))
    .sort();

/** Every frame of test/fixtures/legacy/gin-wire/*.json, with where it came from. */
export const wireFrames = (): ReadonlyArray<WireFrame> =>
  jsonFiles(WIRE_DIR).flatMap((file) =>
    (
      JSON.parse(readFileSync(resolve(REPO_ROOT, WIRE_DIR, file), 'utf8')) as Record<
        string,
        unknown
      >[]
    ).map((frame, index) => ({ file, index, frame })),
  );

/** Every capture of test/fixtures/legacy/gin-storage/*.json. */
export const storageCaptures = (): ReadonlyArray<Capture> =>
  jsonFiles(STORAGE_DIR).map(
    (file) => JSON.parse(readFileSync(resolve(REPO_ROOT, STORAGE_DIR, file), 'utf8')) as Capture,
  );

/** The legacy `app` object's fields the cut helpers read. */
export type LegacyApp = { selectedCard: string | null; role: 'local' | 'host' | 'guest' | null };

/** The sound object as the cue machine calls it: each cue records its name. */
export type LegacyFx = Readonly<Record<string, () => void>>;

export type LegacyElement = {
  classList: { contains: (c: string) => boolean };
  style: { setProperty: (name: string, value: string) => void };
  scrollHeight: number;
  clientHeight: number;
};

export type LegacyUiDeps = {
  engine: GinEngine;
  app: LegacyApp;
  fx: LegacyFx;
  $: (id: string) => LegacyElement | null;
  document: {
    getElementById: (id: string) => LegacyElement | null;
    body?: unknown;
    createElement?: unknown;
  };
  toast: (msg: string) => void;
  Blob?: unknown;
  URL?: unknown;
  setTimeout?: unknown;
  state: unknown;
};

export type LegacyUi = {
  fmtDuration: (ms: number) => string;
  cueState: { key: string | null; turnKey: string | null };
  playCuesFor: (v: unknown) => void;
  cardHtml: (c: unknown, opts?: Record<string, boolean | undefined>) => string;
  backHtml: (cls?: string) => string;
  meldGroupsHtml: (melds: unknown, extra?: string, mini?: boolean) => string;
  legacyStatus: (v: unknown) => { status: string; sub: string };
  legacyDeadwoodText: (v: unknown) => string;
  legacyHandHtml: (v: unknown) => string;
  GIN_BONUS: number;
  UNDERCUT_BONUS: number;
  KNOCK_LABELS: Record<string, string>;
  totalFor: (id: string) => number;
  computeRoundScores: (
    deadwood: Record<string, number>,
    knockerId: string,
    knockType: string,
  ) => Record<string, number>;
  csvEscape: (v: unknown) => string;
  exportGame: () => void;
  wordsToNumber: (text: string) => number | null;
  extractNumber: (clause: string) => number | null;
  parseVoiceScores: (
    transcript: string,
    players: ReadonlyArray<{ id: string; name: string }>,
  ) => { heard: unknown; matches: string[] };
  setState: (s: unknown) => void;
};

type LegacyUiModule = ((deps: LegacyUiDeps) => LegacyUi) & { RULES_BLOCKS: string[] };

/** The sha256-pinned legacy UI helpers (test/fixtures/legacy/gin-ui.cjs) over `deps`. */
export const loadLegacyGinUi = (deps: LegacyUiDeps): LegacyUi =>
  (load('../fixtures/legacy/gin-ui.cjs') as LegacyUiModule)(deps);

/** The two legacy rules lists, verbatim page text. */
export const legacyRulesBlocks = (): ReadonlyArray<string> =>
  (load('../fixtures/legacy/gin-ui.cjs') as LegacyUiModule).RULES_BLOCKS;
