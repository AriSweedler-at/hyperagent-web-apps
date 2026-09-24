// The About panel's copy (docs/design/glossary-links.md §2: two short paragraphs, the game in one
// breath and how this page plays it), rendered once at boot by render.ts `renderAbout` with its
// jargon linked to the rules through web/shared/ui/glossary.ts. The game's own name stays out of
// the prose: "gin" is a rule here (the hand), and the heading above already says Gin Rummy.
import { linkJargon } from '../../../../shared/ui/glossary.ts';
import { GLOSSARY } from './glossary.ts';

export const ABOUT_PARAGRAPHS: ReadonlyArray<string> = [
  'A two-player rummy: ten cards each, one draw and one discard a turn, arranging your hand into melds until someone knocks with little enough deadwood, or goes gin with none.',
  'This page plays it on one phone passed between you, or across two phones in a room you share by code. Knock when your hand is ready, or go gin; against a knock the other player lays off what fits, and an undercut turns the tables. First to the target score wins.',
];

/** The panel's markup: one `<p>` per paragraph, the jargon linked. */
export const aboutHtml = (): string =>
  ABOUT_PARAGRAPHS.map((p) => `<p>${linkJargon(p, GLOSSARY)}</p>`).join('\n');
