// The drag ghost's stillness in every game that binds the pointer-drag kernel (web/shared/edge/drag.ts;
// docs/design/dry-round-2.md E1). The ghost is a clone of the thing dragged, so it wears that thing's
// class and inherits its transform transition (gin's `.card` 120ms, backgammon's `.checker` 160ms,
// briscola's `.card` 160ms): left in place, every pointer move's `translate` is tweened and the ghost
// trails the finger (briscola shipped so and trailed by ~55px at a normal swipe, catching up ~100ms
// after the finger stopped: PR "Card dragging follows the finger"). Each theme's `.drag-ghost` rule
// resets it (`transition: none`) and gives the ghost its own layer (`will-change: transform`); the
// glide on release is `.drag-ghost.landing`'s alone. No unit test sees a stylesheet, so this reads
// the built themes (`dist/shared/assets/<game>-<hash>.css`) and pins both declarations for every
// game with a drag. Runs on dist/ after the build (npm run test:site).
import { expect, test } from 'vitest';

import { describeDist, distFiles, readDist } from './dist.ts';

/** The games whose ui binds `bindDrag` (gin's hand, backgammon's board, briscola's hand). */
const DRAG_GAMES: ReadonlyArray<string> = ['gin-rummy', 'backgammon', 'briscola'];

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
/** Every `<selector> { <declarations> }` in the sheet, at any nesting. */
const RULE = /([^{}]+)\{([^{}]*)\}/g;

type Rule = Readonly<{ selector: string; declarations: ReadonlyArray<string> }>;

const rulesIn = (css: string): ReadonlyArray<Rule> =>
  [...css.replace(CSS_COMMENT, ' ').matchAll(RULE)].map((m) => ({
    selector: (m[1] ?? '').trim().replace(/\s+/g, ' '),
    declarations: (m[2] ?? '')
      .split(';')
      .map((d) =>
        d
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\s*:\s*/, ': '),
      )
      .filter((d) => d !== ''),
  }));

/** The rules whose selector list is exactly `selector` (not `.drag-ghost.landing` for `.drag-ghost`). */
const rulesFor = (rules: ReadonlyArray<Rule>, selector: string): ReadonlyArray<Rule> =>
  rules.filter((r) => r.selector.split(',').some((s) => s.trim() === selector));

describeDist('drag ghost stillness', (root) => {
  DRAG_GAMES.forEach((game) => {
    test(`${game}: .drag-ghost resets the clone's transition and takes its own layer; .landing alone glides`, () => {
      const theme = new RegExp(`^shared/assets/${game}-[\\w-]+\\.css$`);
      const files = distFiles(root).filter((f) => theme.test(f));
      expect(files, `one built theme for ${game}`).toHaveLength(1);
      const rules = rulesIn(readDist(root, files[0] ?? ''));
      const ghost = rulesFor(rules, '.drag-ghost').flatMap((r) => r.declarations);
      expect(ghost, `a .drag-ghost rule in ${game}'s theme`).not.toHaveLength(0);
      expect(ghost).toContain('transition: none');
      expect(ghost).toContain('will-change: transform');
      const landing = rulesFor(rules, '.drag-ghost.landing').flatMap((r) => r.declarations);
      expect(landing.some((d) => /^transition: transform \d+ms/.test(d))).toBe(true);
    });
  });
});
