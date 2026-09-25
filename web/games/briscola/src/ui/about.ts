// The About panel's copy (two short paragraphs), rendered by render.ts `renderAbout` with its
// jargon linked to the rules through web/shared/ui/glossary.ts (docs/design/glossary-links.md:
// "Clicking jargon in the 'about' section will take you to the 'rules' section"). The first word
// linked is the game's own name, lower case, the way the shell's glossary spec taps it.
import { linkJargon } from '../../../../shared/ui/glossary.ts';
import { GLOSSARY } from './glossary.ts';

export const ABOUT_PARAGRAPHS: ReadonlyArray<string> = [
  'Named for its trump card, briscola is the card game of the Italian café: forty long cards in four suits (coppe, denari, spade, bastoni), three in each hand, one card turned up to name the suit that beats all the others. The asso and the tre are the carichi, the cards worth taking; the rest of a trick is often nothing at all, and the whole game is knowing when a trick is worth a briscola.',
  'This page plays plain briscola for two, three or four (the four in partners, sitting opposite). Pass one phone around the table, or open a table online and share its code. The score runs on the table as you play, every trick is written down in the history, and the packs of cards are the regional Italian ones. The colours are those of Oahu, where this page gets played: sand, shallow water and a honu at the foot of the page.',
];

/**
 * The panel's markup: one `<p>` per paragraph, the jargon linked to the rules across the whole
 * copy at once (a word's first occurrence alone, so "briscola" in the second paragraph stays
 * plain; `linkJargon` never links inside a tag, so the `<p>`s are safe).
 */
export const aboutHtml = (): string =>
  linkJargon(ABOUT_PARAGRAPHS.map((p) => `<p>${p}</p>`).join('\n'), GLOSSARY);
