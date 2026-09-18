// Migration ratchet (docs/ARCHITECTURE.md "tsconfig.base.json"; docs/MIGRATION.md step 6). During
// the migration tsconfig.web.json carries `allowJs` so the de-bundled fidice modules type-check as
// they are ported to .ts. The number of .js files under web/ may only go down: lower JS_FILE_COUNT
// in the same commit that ports a module, never raise it. Step 15 removes allowJs at zero.
import { readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { expect, test } from 'vitest';

const WEB = resolve(import.meta.dirname, '..', 'web');

/** 38 de-bundled modules under web/games/fidice/src plus web/games/fidice/main.js. */
const JS_FILE_COUNT = 33;

const jsFilesUnderWeb = (): ReadonlyArray<string> =>
  readdirSync(WEB, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split(sep).join('/'))
    .filter((path) => path.endsWith('.js') && statSync(resolve(WEB, path)).isFile())
    .sort();

test('the number of .js files under web/ never increases (lower JS_FILE_COUNT when porting)', () => {
  const files = jsFilesUnderWeb();
  expect(files.length, files.join('\n')).toBeLessThanOrEqual(JS_FILE_COUNT);
  expect(files.length, 'lower JS_FILE_COUNT in test/ratchet.test.ts to match').toBe(JS_FILE_COUNT);
});

test('every .js under web/ is a de-bundled fidice module or its entry', () => {
  jsFilesUnderWeb().forEach((file) => {
    expect(file === 'games/fidice/main.js' || file.startsWith('games/fidice/src/'), file).toBe(
      true,
    );
  });
});
