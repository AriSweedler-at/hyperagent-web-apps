import { describe, expect, test } from 'vitest';

import { globToRegExp, matchesAny } from './glob.ts';

describe('the suite table glob dialect', () => {
  test.each([
    // A trailing ** is everything below the directory, at any depth.
    ['web/shared/**', 'web/shared/lib/x.ts', true],
    ['web/shared/**', 'web/shared/x.ts', true],
    ['web/shared/**', 'web/sharedx/x.ts', false],
    ['web/shared/**', 'web/games/x.ts', false],
    // A ** in the middle is zero or more directories.
    ['web/**/*.test.ts', 'web/a.test.ts', true],
    ['web/**/*.test.ts', 'web/a/b/c.test.ts', true],
    ['web/**/*.test.ts', 'web/a/b/c.ts', false],
    ['**/*.md', 'README.md', true],
    ['**/*.md', 'docs/design/x.md', true],
    ['**/*.md', 'docs/x.mdx', false],
    ['**', 'anything/at/all', true],
    // * and ? never cross a slash.
    ['test/parity/gin.*', 'test/parity/gin.replay.1.test.ts', true],
    ['test/parity/gin.*', 'test/parity/gin/x.ts', false],
    ['test/parity/gin.*', 'test/parity/ginx.ts', false],
    ['tsconfig*.json', 'tsconfig.node.json', true],
    ['tsconfig*.json', 'tsconfig.json', true],
    ['tsconfig*.json', 'sub/tsconfig.json', false],
    ['e2e/gin-*.spec.ts', 'e2e/gin-online.spec.ts', true],
    ['e2e/gin-*.spec.ts', 'e2e/gin-online.spec.ts.bak', false],
    ['web/games/?in/x.ts', 'web/games/gin/x.ts', true],
    ['web/games/?in/x.ts', 'web/games/fidice/x.ts', false],
    // Braces are alternatives; the other characters are literal, dots included.
    ['test/tools/{serve-dist,proxy-dev}.test.ts', 'test/tools/serve-dist.test.ts', true],
    ['test/tools/{serve-dist,proxy-dev}.test.ts', 'test/tools/proxy-dev.test.ts', true],
    ['test/tools/{serve-dist,proxy-dev}.test.ts', 'test/tools/computed-styles.test.ts', false],
    ['a.b', 'axb', false],
    ['.prettierrc*', '.prettierrc', true],
    ['.prettierrc*', '.prettierrc.json', true],
    ['web/games/*/src/engine/**', 'web/games/gin-rummy/src/engine/game.ts', true],
    ['web/games/*/src/engine/**', 'web/games/gin-rummy/src/ui/game.ts', false],
  ])('%s matches %s: %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });

  test('matchesAny is any glob', () => {
    expect(matchesAny('docs/x.md', ['legacy/**', '**/*.md'])).toBe(true);
    expect(matchesAny('web/x.ts', ['legacy/**', '**/*.md'])).toBe(false);
    expect(matchesAny('web/x.ts', [])).toBe(false);
  });
});
