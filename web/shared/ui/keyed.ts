// The keyed slot: one element rebuilt from its markup only when the key it was last built under
// changes, so its children survive every other paint (backgammon's keyed board and rules slots,
// docs/design/backgammon-board.md §2.2; gin's piles, table melds and result body). Moved out of
// shellPaint.ts in docs/design/dry-round-2.md D1 (item E3) so a table painter reaches it without
// the shell's screen and sheet painters: it is the one shell helper the table halves of both
// render.ts files call, and the key lives in `data-key` on the element itself (the element is the
// memory, not a module cell), which is why the same function serves every site. Not lint-pure:
// it writes the document through dom.ts, carved out of the pure profile like shellPaint.ts.
import { dataOf, setAttr, setHtml, trustedHtml, type Element } from '../edge/dom.ts';

/**
 * Rebuild `el` from `markup` only when `key` differs from its `data-key`, so its children survive
 * a paint (backgammon's keyed board, docs/design/backgammon-board.md §2.2, and its rules slots;
 * gin's piles, table melds and result body since D1). Clearing `data-key` (`setAttr(el,
 * 'data-key', null)`) forgets the build, so the same key paints again when the slot returns.
 */
export const ensureKeyed = (el: Element, key: string, markup: () => string): void => {
  if (dataOf(el, 'key') === key) return;
  setAttr(el, 'data-key', key);
  setHtml(el, trustedHtml(markup()));
};
