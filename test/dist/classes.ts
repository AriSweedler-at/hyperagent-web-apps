// The class contract's three sources (docs/MIGRATION.md step 14; docs/ARCHITECTURE.md "Conventions
// for small diffs"): the class names a game's TypeScript spells out, the ones its page markup
// carries and the ones its built stylesheets style. The extraction is a handful of documented
// regular expressions over source text, not a parser: a name a helper builds (`cardClass`,
// `abs-${sym}`) is invisible here on purpose and is listed in web/shared/styles/CONTRACT.md
// instead, which test/dist/class-contract.test.ts reads through `parseContract`. The row scoping
// (`OWNERS`, `ownersOf`) and the stylesheet link-order policy (`OWN_SHEET`, `SHEETS_MAX`) that both
// dist guards apply live here too (docs/design/dry-round-2.md G3, G4).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { posix, resolve, sep } from 'node:path';

import { GAMES, SHELL_GAMES, type Game } from '../../tools/games.ts';
import { REPO_ROOT, readDist, referencesIn, type DistRoot } from './dist.ts';

export { GAMES, type Game };

const CLASS_NAME = /^[A-Za-z_][\w-]*$/;
const words = (text: string): ReadonlyArray<string> =>
  text.split(/\s+/).filter((word) => CLASS_NAME.test(word));
const captures = (text: string, pattern: RegExp): ReadonlyArray<string> =>
  [...text.matchAll(pattern)].flatMap((match) =>
    // An alternation's unmatched groups are undefined at runtime whatever the lib typing says.
    match.slice(1).flatMap((group: string | undefined) => (group === undefined ? [] : [group])),
  );
/** The `'...'` literals in a stretch of code (a `cls(...)` argument list, a `${...}` ternary). */
const quoted = (code: string): ReadonlyArray<string> => captures(code, /'([^']*)'/g).flatMap(words);
const unique = (names: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(names)].sort();

// ---- TypeScript ----------------------------------------------------------------------------------

/**
 * `toggleClass(el, 'a', on)`, `addClass(el, 'a', 'b')`, `removeClass(el, 'a')`, `hasClass(el, 'a')`
 * (web/shared/edge/dom.ts): the quoted names after the element, which may itself be one call with
 * no nested parentheses (`requireId(doc, 'toast')`). A name passed as a variable is not seen.
 */
const DOM_HELPER =
  /\b(?:toggleClass|addClass|removeClass|hasClass)\(\s*(?:[^,()]|\([^()]*\))*?,\s*('[\w-]+'(?:\s*,\s*'[\w-]+')*)/g;
/** The fidice vdom's `class: 'a b'` and `` class: `a` `` props; a template with `${}` yields nothing. */
const VDOM_CLASS = /\bclass:\s*(?:'([^']*)'|`([^`]*)`)/g;
/**
 * `cls('a', cond && 'b', ...)` (web/games/fidice/src/view/vdom.ts): every quoted literal among the
 * arguments, which may nest parentheses one level. A quoted condition (`phase !== 'lobby'`) is a
 * false positive that CONTRACT.md lists as such.
 */
const CLS_CALL = /\bcls\(((?:[^()]|\([^()]*\))*)\)/g;
/**
 * `class="a b ${cond ? 'c' : ''}"` in a template string (and in the page markup): the literal words
 * plus the quoted words of every `${...}` hole, so a ternary's branches count and a helper call
 * (`${cardClass(card, opts)}`) yields nothing.
 */
const CLASS_ATTR = /class="([^"]*)"/g;
const TEMPLATE_HOLE = /(\$\{[^}]*\})/g;

const attributeWords = (value: string): ReadonlyArray<string> => [
  ...words(value.replace(TEMPLATE_HOLE, ' ')),
  ...captures(value, TEMPLATE_HOLE).flatMap(quoted),
];

/** Every class name the rules above find in one TypeScript source. */
export const classesInSource = (source: string): ReadonlyArray<string> =>
  unique([
    ...captures(source, DOM_HELPER).flatMap(quoted),
    ...captures(source, VDOM_CLASS).flatMap(words),
    ...captures(source, CLS_CALL).flatMap(quoted),
    ...captures(source, CLASS_ATTR).flatMap(attributeWords),
  ]);

const filesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((path) => resolve(dir, path))
    .filter((path) => statSync(path).isFile());

/**
 * The `.ts` sources a game ships, its own tree plus web/shared, without the tests beside them and
 * without web/games/<g>/page.ts: that file is the page's markup (the slot values and the residue
 * blocks tools/shell-markup.ts composes the committed index.html from, docs/design/dry-round-2.md
 * G2), read here as markup already through the served page, not TypeScript that names a class.
 */
export const sourceFiles = (game: Game): ReadonlyArray<string> =>
  [resolve(REPO_ROOT, 'web', 'games', game), resolve(REPO_ROOT, 'web', 'shared')]
    .flatMap(filesUnder)
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
    .filter((path) => !path.endsWith(`${sep}page.ts`))
    .map((path) => path.split(sep).join('/'))
    .sort();

export type Named = Readonly<{ name: string; files: ReadonlyArray<string> }>;

/** Every class name the game's TypeScript spells out, with the files (repo-relative) that name it. */
export const tsClasses = (game: Game): ReadonlyArray<Named> => {
  const perFile = sourceFiles(game).map((path) => ({
    file: posix.relative(REPO_ROOT.split(sep).join('/'), path),
    names: classesInSource(readFileSync(path, 'utf8')),
  }));
  return unique(perFile.flatMap(({ names }) => names)).map((name) => ({
    name,
    files: perFile.filter(({ names }) => names.includes(name)).map(({ file }) => file),
  }));
};

// ---- markup and CSS ------------------------------------------------------------------------------

export const pagePath = (game: Game): string => `games/${game}/index.html`;

/** The class attributes of the served page (Vite keeps the markup of web/games/<g>/index.html). */
export const markupClasses = (root: DistRoot, game: Game): ReadonlyArray<string> =>
  unique(captures(readDist(root, pagePath(game)), CLASS_ATTR).flatMap(words));

/** The stylesheets the page links, relative to the tree (`../../shared/assets/<g>-<hash>.css`). */
export const stylesheets = (root: DistRoot, game: Game): ReadonlyArray<string> =>
  referencesIn(pagePath(game), readDist(root, pagePath(game)))
    .filter(({ kind, value }) => kind === 'href' && value.endsWith('.css') && !value.includes(':'))
    .map(({ value }) => posix.normalize(posix.join(posix.dirname(pagePath(game)), value)));

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_STRING = /"[^"]*"|'[^']*'/g;
/** `url(./x.jpg)`: an unquoted asset URL, whose extension would read as a class. */
const CSS_URL = /url\([^)]*\)/g;
/** `.name` in a selector; comments, strings (a data: URI's `w3.org`) and url() bodies are blanked first. */
const CSS_CLASS = /\.([A-Za-z_][\w-]*)/g;

export const classesInCss = (css: string): ReadonlyArray<string> =>
  unique(
    captures(
      css.replace(CSS_COMMENT, ' ').replace(CSS_STRING, '""').replace(CSS_URL, 'url()'),
      CSS_CLASS,
    ),
  );

export const cssClasses = (root: DistRoot, game: Game): ReadonlyArray<string> =>
  unique(stylesheets(root, game).flatMap((file) => classesInCss(readDist(root, file))));

// ---- CONTRACT.md ---------------------------------------------------------------------------------

export type Row = Readonly<{
  owner: string;
  kind: string;
  /** One row may list several names separated by spaces (`m0 m1 m2 m3 m4`). */
  names: ReadonlyArray<string>;
  toggledBy: string;
  styledIn: string;
  notes: string;
}>;

export const CONTRACT_PATH = resolve(REPO_ROOT, 'web', 'shared', 'styles', 'CONTRACT.md');

const cells = (line: string): ReadonlyArray<string> =>
  line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim().replace(/^`|`$/g, ''));

/** The rows of the first `| Owner | Kind | Name | ... |` table; the header and its rule are skipped. */
export const parseContract = (markdown: string): ReadonlyArray<Row> =>
  markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && line.trimEnd().endsWith('|'))
    .map(cells)
    .filter((row) => row.length === 6 && row[0] !== 'Owner' && !/^-+$/.test(row[0] ?? ''))
    .map(([owner = '', kind = '', name = '', toggledBy = '', styledIn = '', notes = '']) => ({
      owner,
      kind,
      names: words(name.replace(/`/g, ' ')),
      toggledBy,
      styledIn,
      notes,
    }));

export const readContract = (): ReadonlyArray<Row> =>
  parseContract(readFileSync(CONTRACT_PATH, 'utf8'));

/**
 * The owners a row may name: a game, `shared` (every page) or `shell` (the pages that link
 * shell.css: the shell games, tools/games.ts SHELL_GAMES, and LINKS_SHELL_CSS). `shared` carries no
 * shell class by policy: a class the shell sheet styles is a `shell` row (dry-round-2.md G3).
 */
export const OWNERS: ReadonlyArray<string> = [...GAMES, 'shared', 'shell'];

export const isShellGame = (game: Game): boolean =>
  (SHELL_GAMES as ReadonlyArray<Game>).includes(game);

/**
 * Fidice links shell.css from M1 of docs/design/fidice-shell-adoption.md without being a shell game
 * (its page is the vdom's until M2, its shell screens the shared markup's from M5): the shell
 * sheet's rows apply to it and its page may link three sheets. Retired at M5, when fidice joins
 * SHELL_GAMES.
 */
export const LINKS_SHELL_CSS: ReadonlyArray<Game> = ['fidice'];
export const linksShellCss = (game: Game): boolean =>
  isShellGame(game) || LINKS_SHELL_CSS.includes(game);

/**
 * A game's own theme under shared/assets/ (`<game>-<hash>.css`); every other sheet there is shared.
 * A page links the common chunk's sheet (web/shared/styles/{tokens,base}.css, and shell.css while
 * every page links it: Vite splits a sheet out only where the pages that link it differ), then a
 * second shared sheet where one is split out, then its theme: the dist guards allow that middle
 * sheet without requiring it (dry-round-2.md G4).
 */
export const OWN_SHEET = new RegExp(`shared/assets/(${GAMES.join('|')})-[\\w-]+\\.css$`);
export const SHEETS_MAX = (game: Game): number => (linksShellCss(game) ? 3 : 2);

/** The owners whose `class` rows apply to a game: itself, `shared` and, where shell.css is linked, `shell`. */
export const ownersOf = (game: Game): ReadonlyArray<string> => [
  game,
  'shared',
  ...(linksShellCss(game) ? ['shell'] : []),
];

/**
 * The `class` rows that apply to a game (`ownersOf`). A `shell` row styled in the shell games' own
 * themes (the drag ghost, the connection dot) names a rule a LINKS_SHELL_CSS page does not link:
 * only the rows the shell sheet styles reach it until it is a shell game.
 */
export const rowsFor = (rows: ReadonlyArray<Row>, game: Game): ReadonlyArray<Row> =>
  rows.filter(
    (row) =>
      row.kind === 'class' &&
      ownersOf(game).includes(row.owner) &&
      (row.owner !== 'shell' || isShellGame(game) || row.styledIn.includes('shell.css')),
  );
