// No JavaScript under web/ (docs/ARCHITECTURE.md "tsconfig.base.json"; docs/MIGRATION.md steps 6-9
// and 15). During the migration tsconfig.web.json carried `allowJs` and this file ratcheted the
// number of .js files down as the de-bundled fidice modules were typed; step 15 removed `allowJs`
// at zero, so a .js file under web/ would now be invisible to the compiler and this test refuses it.
import { readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { expect, test } from 'vitest';

const WEB = resolve(import.meta.dirname, '..', 'web');

const jsFilesUnderWeb = (): ReadonlyArray<string> =>
  readdirSync(WEB, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split(sep).join('/'))
    .filter((path) => path.endsWith('.js') && statSync(resolve(WEB, path)).isFile())
    .sort();

test('no .js file exists under web/ (every module is TypeScript; allowJs is gone)', () => {
  const files = jsFilesUnderWeb();
  expect(files, files.join('\n')).toEqual([]);
});
