// The rules list (docs/design/backgammon-board.md §5.1: `#rulesPanel` from `rules.ts
// RULES_ITEMS[variant]`), the one source both slots render from (`#rulesList` on the home tab and
// `#rulesOverlayList` over the table, render.ts `renderRules`), so the two copies cannot drift as
// gin's legacy page let them. Each item carries an id: the anchor a glossary link lands on
// (docs/design/glossary-links.md; ui/glossary.ts names the words that mean each rule). Plain
// English throughout (design §1 Q11): the only non-English words on this page are the name and
// "diplo", the Greek gammon.
import { rulesListHtml, type RuleItem } from '../../../../shared/ui/glossary.ts';
import type { ShippedVariant } from '../engine/index.ts';
import { GLOSSARY } from './glossary.ts';

/** The ids of the two `<ul class="rules-list">` slots: the home tab's and the in-game overlay's. */
export const RULES_SLOT_IDS = ['rulesList', 'rulesOverlayList'] as const;
export type RulesSlot = (typeof RULES_SLOT_IDS)[number];

/** What every tavli-family game shares: the board, the direction, hits, the bar and bearing off. */
const COMMON: ReadonlyArray<RuleItem> = [
  {
    id: 'goal',
    heading: 'Goal',
    body: 'Move all fifteen of your checkers round the board into your home board (your six lowest points) and bear them off. The first to bear off all fifteen wins the game.',
  },
  {
    id: 'direction',
    heading: 'Direction',
    body: 'Your checkers travel from the far corner (your 24-point) round to your home board and off; your opponent’s travel the opposite way. The point numbers you see are your own: 1 is nearest your tray.',
  },
  {
    id: 'rolling',
    heading: 'Rolling',
    body: 'Each turn you roll two dice and move one checker for each die, or one checker twice. Doubles are played four times. You must play both dice when you can, and the larger one when only one can be played.',
  },
  {
    id: 'blocks',
    heading: 'Blocks and hits',
    body: 'A point with two or more of your opponent’s checkers is closed to you. A lone checker (a blot) can be hit: it goes to the bar and must re-enter from the start before its owner does anything else.',
  },
  {
    id: 'bearing-off',
    heading: 'Bearing off',
    body: 'Once all your checkers are home you may bear them off with an exact die, or from your highest point with a larger die.',
  },
];

const MATCH: RuleItem = {
  id: 'match',
  heading: 'The match',
  body: 'Games are played until one player reaches the match length chosen on the home screen.',
};

const ONLINE: RuleItem = {
  id: 'online',
  heading: 'Online',
  body: 'The player who opened the table rolls for both seats, so both boards always show the same dice.',
};

/** Portes (rules §1 Q1): the first game of the Greek set, cube-less, a gammon doubles, no triple. */
const PORTES: ReadonlyArray<RuleItem> = [
  ...COMMON,
  {
    id: 'opening',
    heading: 'Opening',
    body: 'Each player rolls one die; the higher roll starts and rolls both dice again for the first turn (a tie is rolled again).',
  },
  {
    id: 'scoring',
    heading: 'Scoring',
    body: 'A win counts 1 point; 2 if the loser has borne off nothing yet (a gammon, "diplo"). There is no doubling cube and no triple game.',
  },
  MATCH,
  ONLINE,
];

/** Western backgammon: the cube, the triple for a backgammon, and the Crawford rule in a match. */
const WESTERN: ReadonlyArray<RuleItem> = [
  ...COMMON,
  {
    id: 'opening',
    heading: 'Opening',
    body: 'Each player rolls one die; the higher roll starts and plays those two dice as the first move (a tie is rolled again).',
  },
  {
    id: 'scoring',
    heading: 'Scoring',
    body: 'A win counts 1 point; 2 for a gammon (the loser has borne off nothing); 3 for a backgammon (the loser also has a checker on the bar or in your home board).',
  },
  {
    id: 'cube',
    heading: 'The cube',
    body: 'Before rolling, a player may double the stakes. The other player takes (and then owns the cube, the only one who may double next) or passes and loses the game at the old value. The cube stops at 64.',
  },
  {
    id: 'crawford',
    heading: 'Crawford',
    body: 'In a match, once a player is one point from winning, the next game is played without the cube; after it, doubling is allowed again.',
  },
  MATCH,
  ONLINE,
];

/** The rule items per ruleset, each with its anchor id, heading and body. */
export const RULES_ITEMS: Readonly<Record<ShippedVariant, ReadonlyArray<RuleItem>>> = {
  portes: PORTES,
  backgammon: WESTERN,
};

/**
 * The items of `variant`, one keyed `<li>` per line with the jargon inside each body linked to the
 * rule it names (render.ts writes them into both slots).
 */
export const rulesItemsHtml = (variant: ShippedVariant): string =>
  rulesListHtml(RULES_ITEMS[variant], GLOSSARY[variant]);

/** The heading over the in-game overlay's copy. */
export const RULES_TITLE = 'Sheshbesh — Rules';
