// affected.ts diffs, parses and formats; the rules it applies are tools/ci/suites.ts's and are
// tested beside them. Here: the flags, the three output shapes over a table of diffs (the two
// matrix lists ci.yml expands among them), and the git call against a base that is always present
// (HEAD itself: no paths).
import { describe, expect, test } from 'vitest';

import {
  DEFAULT_BASE,
  changedPaths,
  format,
  formatGithub,
  formatHuman,
  formatJson,
  matrices,
  parseArgs,
  reportFor,
} from './affected.ts';
import { GAME_SUITES, JOBS } from './suites.ts';

describe('parseArgs', () => {
  test('defaults: origin/main, a diff, the human format', () => {
    expect(parseArgs([])).toEqual({ base: 'origin/main', all: false, format: 'human' });
    expect(DEFAULT_BASE).toBe('origin/main');
  });

  test('every flag, in any order', () => {
    expect(parseArgs(['--all'])).toMatchObject({ all: true });
    expect(parseArgs(['--github'])).toMatchObject({ format: 'github' });
    expect(parseArgs(['--json'])).toMatchObject({ format: 'json' });
    expect(parseArgs(['--base', 'origin/release'])).toMatchObject({ base: 'origin/release' });
    expect(parseArgs(['--json', '--base', 'main', '--all'])).toEqual({
      base: 'main',
      all: true,
      format: 'json',
    });
    // The last format wins, as with any repeated flag.
    expect(parseArgs(['--github', '--json'])).toMatchObject({ format: 'json' });
  });

  test('an unknown flag or a bare --base is an error that prints the usage', () => {
    expect(() => parseArgs(['--verbose'])).toThrow(/unknown argument --verbose\nusage:/);
    expect(() => parseArgs(['--base'])).toThrow(/--base needs a ref/);
    expect(() => parseArgs(['--base', '--all'])).toThrow(/--base needs a ref/);
  });
});

describe('the three formats over a table of diffs', () => {
  const ginOnly = reportFor(['web/games/gin-rummy/src/fx.ts']);
  const docsOnly = reportFor(['README.md']);
  const everything = reportFor(null);
  const nothing = reportFor([]);

  test('--github: one line per job in graph order, the two matrix lists, then everything=', () => {
    expect(formatGithub(ginOnly).split('\n')).toEqual([
      'shared=false',
      'shared-integration=false',
      'gin=true',
      'fidice=false',
      'backgammon=false',
      'briscola=false',
      'site=true',
      'harness=true',
      'e2e-gin=true',
      'e2e-fidice=false',
      'e2e-backgammon=false',
      'e2e-briscola=false',
      'e2e-site=true',
      'games=["gin"]',
      'e2e-games=["gin"]',
      'everything=false',
    ]);
    expect(formatGithub(everything).split('\n')).toEqual([
      ...JOBS.map((job) => `${job}=true`),
      'games=["gin","fidice","backgammon","briscola"]',
      'e2e-games=["gin","fidice","backgammon","briscola"]',
      'everything=true',
    ]);
    expect(formatGithub(docsOnly).split('\n')).toEqual([
      ...JOBS.map((job) => `${job}=false`),
      'games=[]',
      'e2e-games=[]',
      'everything=false',
    ]);
    // Every line is a name GitHub accepts as an output (letters, digits, - and _) and a value on
    // that one line: a boolean, or a JSON array `fromJSON` reads (a multi-line value would need
    // the heredoc form of $GITHUB_OUTPUT).
    formatGithub(everything)
      .split('\n')
      .forEach((line) => {
        expect(line).toMatch(/^[A-Za-z][A-Za-z0-9_-]*=(true|false|\[.*\])$/);
      });
  });

  test('the matrix lists: the game suites among the selected jobs, in job order, each side on its own', () => {
    expect(matrices(ginOnly.jobs)).toEqual({ games: ['gin'], 'e2e-games': ['gin'] });
    expect(matrices(everything.jobs)).toEqual({ games: GAME_SUITES, 'e2e-games': GAME_SUITES });
    expect(matrices(docsOnly.jobs)).toEqual({ games: [], 'e2e-games': [] });
    expect(matrices(nothing.jobs)).toEqual({ games: [], 'e2e-games': [] });
    // A spec alone selects the e2e side only; a parity oracle alone the unit side only.
    expect(matrices(reportFor(['e2e/fidice-online.spec.ts']).jobs)).toEqual({
      games: [],
      'e2e-games': ['fidice'],
    });
    expect(matrices(reportFor(['test/parity/backgammon.legacy.test.ts']).jobs)).toEqual({
      games: ['backgammon'],
      'e2e-games': [],
    });
    // Job order, whatever the diff's order.
    expect(
      matrices(reportFor(['web/games/backgammon/src/x.ts', 'web/games/gin-rummy/src/y.ts']).jobs),
    ).toEqual({ games: ['gin', 'backgammon'], 'e2e-games': ['gin', 'backgammon'] });
    // The lists ci.yml reads back are the ones printed: parsed, they equal the helper's.
    const lines = Object.fromEntries(
      formatGithub(ginOnly)
        .split('\n')
        .map((line) => line.split('=') as [string, string]),
    );
    expect(JSON.parse(lines['games'] ?? '')).toEqual(['gin']);
    expect(JSON.parse(lines['e2e-games'] ?? '')).toEqual(['gin']);
  });

  test('--json: the paths, every job as a boolean, the two matrix lists, and everything', () => {
    expect(JSON.parse(formatJson(ginOnly))).toEqual({
      paths: ['web/games/gin-rummy/src/fx.ts'],
      jobs: {
        shared: false,
        'shared-integration': false,
        gin: true,
        fidice: false,
        backgammon: false,
        briscola: false,
        site: true,
        harness: true,
        'e2e-gin': true,
        'e2e-fidice': false,
        'e2e-backgammon': false,
        'e2e-briscola': false,
        'e2e-site': true,
      },
      games: ['gin'],
      'e2e-games': ['gin'],
      everything: false,
    });
    expect(JSON.parse(formatJson(everything))).toMatchObject({ paths: null, everything: true });
    expect(JSON.parse(formatJson(nothing))).toMatchObject({ paths: [], everything: false });
  });

  test('human: each path with the row that claimed it, then the jobs', () => {
    expect(formatHuman(ginOnly)).toBe(
      [
        'web/games/gin-rummy/src/fx.ts',
        "    -> gin, e2e-gin, site, e2e-site, harness (the page is built into dist and smoked, tokens/ratchet/the class contract read every game, and tools/games.test.ts pins the registry against the games' storage keys)",
        '',
        'jobs: gin, site, harness, e2e-gin, e2e-site',
      ].join('\n'),
    );
    expect(formatHuman(docsOnly)).toContain('-> nothing (');
    expect(formatHuman(docsOnly)).toContain('jobs: none (check only)');
    expect(formatHuman(reportFor(['tools/games.ts']))).toContain('-> everything (');
    expect(formatHuman(everything)).toBe(`--all: every job\n\njobs: ${JOBS.join(', ')}`);
    expect(formatHuman(nothing)).toBe('no changed paths\n\njobs: none (check only)');
  });

  test('format dispatches on the kind', () => {
    expect(format(ginOnly, 'github')).toBe(formatGithub(ginOnly));
    expect(format(ginOnly, 'json')).toBe(formatJson(ginOnly));
    expect(format(ginOnly, 'human')).toBe(formatHuman(ginOnly));
  });
});

describe('changedPaths', () => {
  test('HEAD against itself changes nothing (the git call and its parsing, on any checkout)', () => {
    expect(changedPaths('HEAD')).toEqual([]);
  });
});
