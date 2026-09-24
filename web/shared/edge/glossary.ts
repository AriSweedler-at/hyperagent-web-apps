// The glossary's edge (docs/design/glossary-links.md §3): one delegated click listener turns a tap
// on a `.jargon` link into the rule it names, and `revealRule` scrolls that rule into view and
// flashes it. The pure side (the links, the anchors, the hash) is web/shared/ui/glossary.ts; the
// reducer decides what a tap means (the Rules tab, or the rules overlay over a table) and raises
// `revealRule` as an effect, which main.ts runs through here.
import {
  addClass,
  closestFrom,
  dataOf,
  listen,
  nextFrame,
  preventDefault,
  queryIn,
  removeClass,
  requireId,
  scrollIntoView,
  type DocumentLike,
  type PageLike,
} from './dom.ts';
import { JARGON_CLASS, ruleAnchor } from '../ui/glossary.ts';

/** The class the revealed rule wears while its background fades (each theme's `@keyframes rule-flash`). */
export const RULE_FLASH_CLASS = 'rule-flash';
/** How long the flash lasts: the animation's duration, after which the class comes off so a second tap flashes again. */
export const FLASH_MS = 1200;

/**
 * Every tap on a jargon link, anywhere on the page, is `onRule(id)` instead of the anchor jump
 * (the rule's panel may be hidden at the time, and the reducer knows which one to open).
 */
export const bindJargon = (doc: PageLike, onRule: (id: string) => void): void => {
  listen(doc, 'click', (e) => {
    const link = closestFrom(e, `a.${JARGON_CLASS}`);
    if (link === null) return;
    const id = dataOf(link, 'rule');
    if (id === null) return;
    preventDefault(e);
    onRule(id);
  });
};

/** When the reveal runs: after the paint that shows the rule (a frame later), and when the flash ends. */
export type RevealTiming = Readonly<{
  afterPaint: (fn: () => void) => void;
  after: (fn: () => void, ms: number) => void;
}>;

/** The browser's: the next animation frame (the paint of this dispatch has run by then) and a timeout. */
export const browserTiming: RevealTiming = {
  afterPaint: nextFrame,
  after: (fn, ms) => {
    setTimeout(fn, ms);
  },
};

/**
 * Scroll the rule `ruleId` inside the rules slot `slotId` (the home tab's list or the overlay's,
 * whichever the reducer says is on screen) into view and flash it. A rule the slot lacks (a
 * Western-only rule while Portes is chosen) is a no-op: the tab still switched.
 */
export const revealRule = (
  doc: DocumentLike,
  slotId: string,
  ruleId: string,
  timing: RevealTiming = browserTiming,
): void => {
  timing.afterPaint(() => {
    const rule = queryIn(requireId(doc, slotId), `#${ruleAnchor(ruleId)}`);
    if (rule === null) return;
    scrollIntoView(rule, { block: 'center', behavior: 'smooth' });
    addClass(rule, RULE_FLASH_CLASS);
    timing.after(() => {
      removeClass(rule, RULE_FLASH_CLASS);
    }, FLASH_MS);
  });
};
