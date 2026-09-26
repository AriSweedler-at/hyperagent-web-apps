// The About panel's copy (docs/design/fidice-shell-adoption.md §7 D12: a tab the legacy page never
// had, so the words are new), rendered by render.ts `renderAbout` with its jargon linked to the
// rules through web/shared/ui/glossary.ts (docs/design/glossary-links.md). Fidice's own voice, not
// another game's: the cup, the lake, the house rules.
import { linkJargon } from '../../../../shared/ui/glossary.ts';
import { GLOSSARY } from './rules.ts';

export const ABOUT_PARAGRAPHS: ReadonlyArray<string> = [
  "Fidice is one-cup liar's dice the way the Crowe house plays it on Kezar Lake, Maine: five dice under one cup that goes round the table, a hand declared from the ladder each time it moves, and one question for whoever gets it next — raise, or call liar? Lose a call and you lose a life (or a kayak, if the table is playing for stakes); keep score instead and the fewest rounds lost wins when the evening ends.",
  'This page seats two to six. Pass one phone around the table, or open a table online and share its code; computers can take any empty chair, play against you alone, or play each other while you watch. The ladder of all 252 hands is a tab of its own, and the bid box finds a hand from a few typed letters.',
];

/**
 * The panel's markup: one `<p>` per paragraph, the jargon linked to the rules across the whole
 * copy at once (a word's first occurrence alone; `linkJargon` never links inside a tag, so the
 * `<p>`s are safe).
 */
export const aboutHtml = (): string =>
  linkJargon(ABOUT_PARAGRAPHS.map((p) => `<p>${p}</p>`).join('\n'), GLOSSARY);
