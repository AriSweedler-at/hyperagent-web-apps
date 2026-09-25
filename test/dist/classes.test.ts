// The contract parser's row scoping (test/dist/classes.ts): which CONTRACT.md rows apply to which
// page. Pure, so it runs without a build; class-contract.test.ts proves the rows against dist/.
import { expect, test } from 'vitest';

import { OWNERS, ownersOf, parseContract, rowsFor } from './classes.ts';

const TABLE = `
| Owner | Kind | Name | Toggled by (TS) | Styled in (CSS) | Notes |
| --- | --- | --- | --- | --- | --- |
| gin-rummy | class | \`m0 m1\` | \`a.ts\` | \`gin.css\` | own |
| fidice | class | \`app\` | \`b.ts\` | | own |
| shared | class | \`hidden\` | \`c.ts\` | \`base.css\` | every page |
| shell | class | \`on off\` | \`d.ts\` | \`gin.css\`, \`bg.css\` | the shell pages |
| \`--go\` | \`#c2d06d\` | \`#a6b85c\` | \`#a3b070\` | a five-column token row |
`;

test('parseContract reads the six-column class rows and skips the header, its rule and token rows', () => {
  expect(parseContract(TABLE).map((row) => [row.owner, row.names])).toEqual([
    ['gin-rummy', ['m0', 'm1']],
    ['fidice', ['app']],
    ['shared', ['hidden']],
    ['shell', ['on', 'off']],
  ]);
});

test('a shell row applies to the shell games and not to fidice (dry-round-2.md G3)', () => {
  const rows = parseContract(TABLE);
  const scoped = (game: 'gin-rummy' | 'fidice' | 'backgammon'): ReadonlyArray<string> =>
    rowsFor(rows, game).map((row) => row.owner);
  expect(ownersOf('gin-rummy')).toEqual(['gin-rummy', 'shared', 'shell']);
  expect(ownersOf('backgammon')).toEqual(['backgammon', 'shared', 'shell']);
  expect(ownersOf('fidice')).toEqual(['fidice', 'shared']);
  expect(scoped('gin-rummy')).toEqual(['gin-rummy', 'shared', 'shell']);
  expect(scoped('backgammon')).toEqual(['shared', 'shell']);
  expect(scoped('fidice')).toEqual(['fidice', 'shared']);
  expect(OWNERS).toEqual(['gin-rummy', 'fidice', 'backgammon', 'shared', 'shell']);
});
