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
| shell | class | \`on off\` | \`d.ts\` | \`web/games/gin-rummy/theme.css\`, \`web/games/backgammon/theme.css\` | the shell pages |
| shell | class | \`pulse\` | \`e.ts\` | \`shell.css\` | the shell sheet |
| \`--go\` | \`#c2d06d\` | \`#a6b85c\` | \`#a3b070\` | a five-column token row |
`;

test('parseContract reads the six-column class rows and skips the header, its rule and token rows', () => {
  expect(parseContract(TABLE).map((row) => [row.owner, row.names])).toEqual([
    ['gin-rummy', ['m0', 'm1']],
    ['fidice', ['app']],
    ['shared', ['hidden']],
    ['shell', ['on', 'off']],
    ['shell', ['pulse']],
  ]);
});

test('a shell row applies to every shell game (fidice among them since M5 of fidice-shell-adoption.md) when the shell sheet styles it, and to the games whose theme it names otherwise (dry-round-2.md G3)', () => {
  const rows = parseContract(TABLE);
  const scoped = (
    game: 'gin-rummy' | 'fidice' | 'backgammon' | 'briscola',
  ): ReadonlyArray<string> => rowsFor(rows, game).map((row) => row.owner);
  expect(ownersOf('gin-rummy')).toEqual(['gin-rummy', 'shared', 'shell']);
  expect(ownersOf('fidice')).toEqual(['fidice', 'shared', 'shell']);
  expect(ownersOf('backgammon')).toEqual(['backgammon', 'shared', 'shell']);
  expect(ownersOf('briscola')).toEqual(['briscola', 'shared', 'shell']);
  expect(scoped('gin-rummy')).toEqual(['gin-rummy', 'shared', 'shell', 'shell']);
  expect(scoped('backgammon')).toEqual(['shared', 'shell', 'shell']);
  // The `on off` row names gin's and backgammon's themes alone: briscola's and fidice's pages get
  // the shell sheet's `pulse` row and not it.
  expect(scoped('briscola')).toEqual(['shared', 'shell']);
  expect(scoped('fidice')).toEqual(['fidice', 'shared', 'shell']);
  expect(rowsFor(rows, 'fidice').map((row) => row.names)).toEqual([['app'], ['hidden'], ['pulse']]);
  expect(OWNERS).toEqual(['gin-rummy', 'fidice', 'backgammon', 'briscola', 'shared', 'shell']);
});
