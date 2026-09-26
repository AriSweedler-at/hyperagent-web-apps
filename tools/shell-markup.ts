// The shell pages composed from the shared partials (docs/design/dry-round-2.md §3 row G2, §5 Wave
// F row F2; README.md "Add a game" step 1). Each composed page (MARKUP_GAMES: the shell games'
// and fidice's) is web/games/<g>/index.html =
// web/shared/markup/shell/*.html filled with the game's web/games/<g>/page.ts (renderShell, pure)
// and then, when Prettier owns the file, formatted with the repo's config: .prettierignore decides,
// as it does for `npm run lint`, so gin's hand-owned legacy layout is emitted as the partials spell
// it and backgammon's page is Prettier's output of the same text, wrapped and indented as the
// committed file is. The composed page is committed (Vite's input glob reads web/**/index.html, and
// the dist guards, the class contract, the page fakes and the parity oracles read the committed
// file), so the tool is run when a partial or a page.ts changes and test/dist/shell-markup.test.ts
// pins the committed bytes to the render until it is:
//   node --experimental-strip-types tools/shell-markup.ts            # compare, exit 1 on a drift
//   node --experimental-strip-types tools/shell-markup.ts --write    # rewrite the pages
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { format, getFileInfo, resolveConfig } from 'prettier';

import { BACKGAMMON_PAGE } from '../web/games/backgammon/page.ts';
import { BRISCOLA_PAGE } from '../web/games/briscola/page.ts';
import { FIDICE_PAGE } from '../web/games/fidice/page.ts';
import { GIN_PAGE } from '../web/games/gin-rummy/page.ts';
import {
  PARTIALS,
  renderShell,
  type ShellPage,
  type ShellTemplates,
} from '../web/shared/markup/shell.ts';
import { SHELL_GAMES, type ShellGame } from './games.ts';
import { REPO_ROOT, isMain } from './legacy/extract.ts';

/** Where the partials live, one file per PARTIALS name. */
export const PARTIAL_DIR = 'web/shared/markup/shell';

/**
 * The games whose page this tool composes: the shell games and, from M2 of
 * docs/design/fidice-shell-adoption.md, fidice, whose composed page carries the shell's screens
 * dark while its legacy app still boots into `#app` (main.ts removes the nodes outside it). It is
 * not a shell game yet (no SHELL row, no shell specs), so it is not in SHELL_GAMES; MARKUP_GAMES
 * collapses to SHELL_GAMES at M5, when fidice joins them.
 */
export type MarkupGame = ShellGame | 'fidice';
export const MARKUP_GAMES: ReadonlyArray<MarkupGame> = [...SHELL_GAMES, 'fidice'];

/** The composed page's path, repo-relative. */
export const pagePath = (game: MarkupGame): string => `web/games/${game}/index.html`;

/** Each composed page's page.ts; a game in MARKUP_GAMES without one is a type error here. */
export const PAGES: Readonly<Record<MarkupGame, ShellPage>> = {
  'gin-rummy': GIN_PAGE,
  backgammon: BACKGAMMON_PAGE,
  briscola: BRISCOLA_PAGE,
  fidice: FIDICE_PAGE,
};

/** The six partials as committed. */
export const readTemplates = (): ShellTemplates =>
  Object.fromEntries(
    PARTIALS.map((name) => [
      name,
      readFileSync(resolve(REPO_ROOT, PARTIAL_DIR, `${name}.html`), 'utf8'),
    ]),
  ) as Record<(typeof PARTIALS)[number], string>;

/**
 * The page as its committed file must read: the partials filled with the game's page.ts, then
 * Prettier's output of that text when `prettier --check` covers the file (the repo's config, the
 * page's own path so the HTML parser and .prettierignore apply as in `npm run lint`).
 */
export const composePage = async (
  game: MarkupGame,
  templates: ShellTemplates = readTemplates(),
): Promise<string> => {
  const rendered = renderShell(templates, PAGES[game]);
  if (!rendered.ok) throw new Error(`${game}: ${rendered.error}`);
  const path = resolve(REPO_ROOT, pagePath(game));
  const info = await getFileInfo(path, { ignorePath: resolve(REPO_ROOT, '.prettierignore') });
  if (info.ignored) return rendered.value;
  const config = await resolveConfig(path);
  return format(rendered.value, { ...config, filepath: path });
};

/** The committed page. */
export const committedPage = (game: MarkupGame): string =>
  readFileSync(resolve(REPO_ROOT, pagePath(game)), 'utf8');

/** One line per game: written, up to date, or the first line that drifts. */
const report = (game: MarkupGame, composed: string, write: boolean): boolean => {
  const path = pagePath(game);
  const committed = committedPage(game);
  if (write) {
    writeFileSync(resolve(REPO_ROOT, path), composed);
    console.log(`${path}: written${composed === committed ? ' (unchanged)' : ''}`);
    return true;
  }
  if (composed === committed) {
    console.log(`${path}: up to date`);
    return true;
  }
  const a = composed.split('\n');
  const b = committed.split('\n');
  // Over the longer side: a page that only gained trailing lines differs at the render's end.
  const at =
    Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i).find((i) => a[i] !== b[i]) ??
    0;
  console.log(`${path}: differs from the render at line ${String(at + 1)}`);
  console.log(`  rendered:  ${a[at] ?? '<end>'}`);
  console.log(`  committed: ${b[at] ?? '<end>'}`);
  console.log(`  ${path} is composed: an edit made there is overwritten by --write`);
  return false;
};

const main = async (): Promise<void> => {
  const write = process.argv.includes('--write');
  const templates = readTemplates();
  const composed = await Promise.all(MARKUP_GAMES.map((game) => composePage(game, templates)));
  const fine = MARKUP_GAMES.map((game, i) => report(game, composed[i] ?? '', write));
  if (!fine.every(Boolean)) {
    console.log(
      'put the change in web/games/<g>/page.ts or web/shared/markup/shell/*.html, then run',
    );
    console.log('  node --experimental-strip-types tools/shell-markup.ts --write');
    process.exitCode = 1;
  }
};

if (isMain(import.meta.url)) await main();
