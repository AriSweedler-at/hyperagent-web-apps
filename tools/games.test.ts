import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { STORAGE_KEYS as BACKGAMMON_KEYS } from '../web/games/backgammon/src/storage.ts';
import { STORAGE_KEYS as BRISCOLA_KEYS } from '../web/games/briscola/src/storage.ts';
import { STORAGE_KEYS as GIN_KEYS } from '../web/games/gin-rummy/src/storage.ts';
import {
  ALIASES,
  GAMES,
  HOOKS,
  LANDING_HREFS,
  LEGACY_GAMES,
  PAGE_TITLES,
  REGISTRY,
  SHELL,
  SHELL_GAMES,
} from './games.ts';

describe('the games registry', () => {
  test('lists the four built games in landing order; the two migrated ones have a legacy page', () => {
    expect(GAMES).toEqual(['gin-rummy', 'fidice', 'backgammon', 'briscola']);
    expect(Object.keys(REGISTRY)).toEqual(GAMES);
    expect(LEGACY_GAMES).toEqual(['gin-rummy', 'fidice']);
  });

  test('pins every row', () => {
    expect(REGISTRY).toEqual({
      'gin-rummy': {
        title: 'Gin Rummy',
        hook: 'window.__gin',
        suite: 'gin',
        specs: ['**/gin-*.spec.ts'],
        storage: { saveKey: 'ginRummyMP_v1', prefix: 'ginRummy_' },
        debug: 0,
        pageShape: {
          ids: ['app', 'homeScreen', 'tableScreen', 'scResOverlay', 'toast'],
          rulesSlots: true,
        },
        contractFloors: { ts: 50, markup: 40 },
        shell: {
          heading: '♠ Gin Rummy',
          shareTitle: 'Gin Rummy',
          tabs: ['Play', 'Rules', 'Score', 'About'],
          modes: ['🌐 Online', '📱 Pass & Play', '🧪 Sandbox'],
          hostAnswered:
            /^Connected to .+'s room \(playing to \d+\)\. Waiting for the host to start/,
          connDot: '#connDot',
          localNames: ['Ari', 'Lavi'],
          localFields: [['localTargetInput', '100']],
          curtainButtons: 1,
        },
      },
      fidice: {
        title: "Fidice — one-cup liar's dice",
        hook: 'window.__fidice',
        suite: 'fidice',
        specs: [],
        debug: 1,
        pageShape: { ids: ['app'], rulesSlots: false },
        contractFloors: { ts: 50, markup: -1 },
      },
      backgammon: {
        title: 'Sheshbesh — backgammon',
        hook: 'window.__backgammon',
        suite: 'backgammon',
        specs: ['**/backgammon-*.spec.ts'],
        storage: { saveKey: 'backgammonMP_v1', prefix: 'backgammon_' },
        debug: 0,
        pageShape: {
          ids: [
            'app',
            'homeScreen',
            'tableScreen',
            'board',
            'toast',
            ...Array.from({ length: 24 }, (_, i) => `point-${String(i + 1)}`),
          ],
          rulesSlots: true,
        },
        contractFloors: { ts: 35, markup: 40 },
        shell: {
          heading: 'Sheshbesh',
          shareTitle: 'Sheshbesh',
          tabs: ['Play', 'Rules', 'About'],
          modes: ['Online', 'Pass the phone'],
          hostAnswered: /^Connected — waiting for .+ to start$/,
          connDot: '#oppDot',
          localNames: ['Ari', 'Ethan'],
          localFields: [
            ['localVariantSel', 'portes'],
            ['localMatchLengthSel', '5'],
          ],
          curtainButtons: 2,
        },
      },
      briscola: {
        title: 'Briscola — cards',
        hook: 'window.__briscola',
        suite: 'briscola',
        specs: ['**/briscola-*.spec.ts'],
        storage: { saveKey: 'briscolaMP_v1', prefix: 'briscola_' },
        debug: 0,
        pageShape: {
          ids: [
            'app',
            'homeScreen',
            'tableScreen',
            'hand',
            'trick',
            'stock',
            'briscola',
            'scoreStrip',
            'toast',
          ],
          rulesSlots: true,
        },
        contractFloors: { ts: 35, markup: 40 },
        shell: {
          heading: 'Briscola',
          shareTitle: 'Briscola',
          tabs: ['Play', 'Rules', 'About'],
          modes: ['Online', 'Pass the phone'],
          hostAnswered: /^Connected — waiting for .+ to deal$/,
          connDot: '#oppDot',
          localNames: ['Ari', 'Lavi'],
          localFields: [['localPlayersSel', '2']],
          curtainButtons: 2,
        },
      },
    });
  });

  test('the shell games are the rows with a shell, each carrying its SHELL row and a storage row', () => {
    // The shell specs (e2e/shell-*.spec.ts) iterate SHELL_GAMES and read the save and the
    // preference keys through the storage row, so a shell game must have both.
    expect(SHELL_GAMES).toEqual(GAMES.filter((game) => REGISTRY[game].shell !== undefined));
    expect(SHELL_GAMES).toEqual(['gin-rummy', 'backgammon', 'briscola']);
    SHELL_GAMES.forEach((game) => {
      expect(REGISTRY[game].shell).toBe(SHELL[game]);
      expect(REGISTRY[game].storage, game).toBeDefined();
    });
    expect(Object.keys(SHELL)).toEqual(SHELL_GAMES);
  });

  test("the storage rows are the games' own STORAGE_KEYS: the save key, and the prefix of the shell's preference keys", () => {
    // The shell's preferences (docs/design/shared-shell.md §5 A3): `<prefix><name>` in both games.
    // A game's other keys (gin's Score Counter save `ginRummyScorerState_v2`, backgammon's variant
    // and match length) are its own and need not carry the prefix.
    const SHELL_PREFS = ['name', 'p2Name', 'homeTab', 'playMode', 'sound', 'soundFont'];
    const pin = (
      storage: Readonly<{ saveKey: string; prefix: string }> | undefined,
      keys: Readonly<Record<string, string>>,
    ): void => {
      expect(storage?.saveKey).toBe(keys['save']);
      SHELL_PREFS.forEach((name) => {
        expect(keys[name], name).toBe(`${storage?.prefix ?? ''}${name}`);
      });
    };
    pin(REGISTRY['gin-rummy'].storage, GIN_KEYS);
    pin(REGISTRY.backgammon.storage, BACKGAMMON_KEYS);
    pin(REGISTRY.briscola.storage, BRISCOLA_KEYS);
    expect(REGISTRY.fidice.storage).toBeUndefined();
  });

  test('pins every page title, read off the rows', () => {
    expect(PAGE_TITLES).toEqual({
      landing: "Ari's web apps",
      'gin-rummy': 'Gin Rummy',
      fidice: "Fidice — one-cup liar's dice",
      backgammon: 'Sheshbesh — backgammon',
      briscola: 'Briscola — cards',
    });
  });

  test('pins every page hook, read off the rows', () => {
    expect(HOOKS).toEqual({
      'gin-rummy': 'window.__gin',
      fidice: 'window.__fidice',
      backgammon: 'window.__backgammon',
      briscola: 'window.__briscola',
    });
  });

  test('the landing hrefs are games/<g>/ in GAMES order', () => {
    expect(LANDING_HREFS).toEqual([
      'games/gin-rummy/',
      'games/fidice/',
      'games/backgammon/',
      'games/briscola/',
    ]);
  });

  test('sheshbesh is an alias of backgammon: a game folder, never a game or a landing link', () => {
    expect(ALIASES).toEqual({ sheshbesh: 'backgammon' });
    Object.entries(ALIASES).forEach(([alias, game]) => {
      expect(GAMES, `${alias} is an alias, not a game`).not.toContain(alias);
      expect(LANDING_HREFS).not.toContain(`games/${alias}/`);
      expect(existsSync(resolve(import.meta.dirname, '..', 'web', 'games', game)), game).toBe(true);
    });
  });
});
