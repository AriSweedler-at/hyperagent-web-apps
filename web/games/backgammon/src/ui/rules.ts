// The rules list (design §5.1: `#rulesPanel` from `rules.ts RULES_ITEMS[variant]`), the one
// source both slots render from (`#rulesList` on the home tab and `#rulesOverlayList` over the
// table, render.ts `renderRules`), so the two copies cannot drift as gin's legacy page let them.
// Plain English throughout (design §1 Q11): the only non-English word on this page is the name.
import type { ShippedVariant } from '../engine/index.ts';

/** What every tavli-family game shares: the board, the direction, hits, the bar and bearing off. */
const COMMON: ReadonlyArray<string> = [
  '<strong>Goal:</strong> Move all fifteen of your checkers round the board into your home (your six lowest points) and bear them off. The first to bear off all fifteen wins the game.',
  '<strong>Direction:</strong> Your checkers travel from the far corner (your 24-point) round to your home board and off; your opponent’s travel the opposite way. The point numbers you see are your own: 1 is nearest your tray.',
  '<strong>Rolling:</strong> Each turn you roll two dice and move one checker for each die, or one checker twice. Doubles are played four times. You must play both dice when you can, and the larger one when only one can be played.',
  '<strong>Blocks and hits:</strong> A point with two or more of your opponent’s checkers is closed to you. A lone checker (a blot) can be hit: it goes to the bar and must re-enter from the start before its owner does anything else.',
  '<strong>Bearing off:</strong> Once all your checkers are home you may bear them off with an exact die, or from your highest point with a larger die.',
];

/** Portes (rules §1 Q1): the first game of the Greek set, cube-less, a gammon doubles, no triple. */
const PORTES: ReadonlyArray<string> = [
  ...COMMON,
  '<strong>Opening:</strong> Each player rolls one die; the higher roll starts and rolls both dice again for the first turn (a tie is rolled again).',
  '<strong>Scoring:</strong> A win counts 1 point; 2 if the loser has borne off nothing yet (a gammon, "diplo"). There is no doubling cube and no triple game.',
  '<strong>The match:</strong> Games are played until one player reaches the match length chosen on the home screen.',
  '<strong>Online:</strong> The player who opened the table rolls for both seats, so both boards always show the same dice.',
];

/** Western backgammon: the cube, the triple for a backgammon, and the Crawford rule in a match. */
const WESTERN: ReadonlyArray<string> = [
  ...COMMON,
  '<strong>Opening:</strong> Each player rolls one die; the higher roll starts and plays those two dice as the first move (a tie is rolled again).',
  '<strong>Scoring:</strong> A win counts 1 point; 2 for a gammon (the loser has borne off nothing); 3 for a backgammon (the loser also has a checker on the bar or in your home board).',
  '<strong>The cube:</strong> Before rolling, a player may double the stakes. The other player takes (and then owns the cube, the only one who may double next) or passes and loses the game at the old value. The cube stops at 64.',
  '<strong>Crawford:</strong> In a match, once a player is one point from winning, the next game is played without the cube; after it, doubling is allowed again.',
  '<strong>The match:</strong> Games are played until one player reaches the match length chosen on the home screen.',
  '<strong>Online:</strong> The player who opened the table rolls for both seats, so both boards always show the same dice.',
];

/** The `<li>` bodies per ruleset, each starting with its bold heading. */
export const RULES_ITEMS: Readonly<Record<ShippedVariant, ReadonlyArray<string>>> = {
  portes: PORTES,
  backgammon: WESTERN,
};

/** The items of `variant`, one `<li>` per line (render.ts writes them into both slots). */
export const rulesItemsHtml = (variant: ShippedVariant): string =>
  RULES_ITEMS[variant].map((item) => `<li>${item}</li>`).join('\n');

/** The heading over the in-game overlay's copy. */
export const RULES_TITLE = 'Sheshbesh — Rules';
