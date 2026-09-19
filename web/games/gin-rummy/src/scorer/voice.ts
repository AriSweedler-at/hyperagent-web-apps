// The Score Counter's spoken entry (docs/MIGRATION.md step 11): the best-effort parser behind
// the microphone button, from the legacy scorer IIFE (legacy/gin-rummy/index.html, pinned in
// test/fixtures/legacy/gin-ui.cjs). "Ari knocked with five, Jeff twenty" or "Jeff gin, Ari
// twelve" becomes deadwood per player and who knocked; nothing is submitted, the player reviews
// the board. The SpeechRecognition wiring stays with the screen (step 12); this is the text part,
// pure, and test/parity/gin.scorer.test.ts runs it beside the legacy over seeded transcripts.
import type { KnockType, ScorerPlayer } from './scores.ts';

const NUM_ONES: Readonly<Record<string, number>> = {
  zero: 0,
  oh: 0,
  o: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const NUM_TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** Own entries only (`hasOwnProperty` in the legacy): `constructor` is not a number word. */
const lookup = (table: Readonly<Record<string, number>>, word: string): number | undefined =>
  Object.hasOwn(table, word) ? table[word] : undefined;

type Tally = Readonly<{ total: number; found: boolean }>;

/** "twenty five" -> 25, "one hundred" -> 100, "hundred" -> 100; null when no number word appears. */
export const wordsToNumber = (text: string): number | null => {
  const tokens = text
    .toLowerCase()
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((t) => t !== '');
  const tally = tokens.reduce<Tally>(
    (acc, t) => {
      if (t === 'hundred') return { total: (acc.total === 0 ? 1 : acc.total) * 100, found: true };
      const tens = lookup(NUM_TENS, t);
      if (tens !== undefined) return { total: acc.total + tens, found: true };
      const ones = lookup(NUM_ONES, t);
      if (ones !== undefined) return { total: acc.total + ones, found: true };
      return acc;
    },
    { total: 0, found: false },
  );
  return tally.found ? tally.total : null;
};

/** Digits win over number words: "with 5" -> 5, "with five" -> 5, nothing -> null. */
export const extractNumber = (clause: string): number | null => {
  const digits = /\d+/.exec(clause);
  return digits === null ? wordsToNumber(clause) : parseInt(digits[0], 10);
};

export type Heard = Readonly<{
  knockerId: string | null;
  knockType: KnockType | null;
  deadwood: Readonly<Record<string, number>>;
}>;
export type VoiceParse = Readonly<{ heard: Heard; matches: ReadonlyArray<string> }>;

const EMPTY_HEARD: Heard = { knockerId: null, knockType: null, deadwood: {} };

/** The player whose name the clause contains; the longest name wins, earlier players on a tie. */
const playerIn = (clause: string, players: ReadonlyArray<ScorerPlayer>): ScorerPlayer | null =>
  players.reduce<ScorerPlayer | null>(
    (best, p) =>
      clause.includes(p.name.toLowerCase()) && (best === null || p.name.length > best.name.length)
        ? p
        : best,
    null,
  );

/**
 * Clauses split on commas, "and" and "&"; each names a player and then either "gin", "knock"
 * (with an optional count) or a bare count. Later clauses overwrite earlier ones for the same
 * player; `matches` says what was understood, for the toast.
 */
export const parseVoiceScores = (
  transcript: string,
  players: ReadonlyArray<ScorerPlayer>,
): VoiceParse => {
  const clauses = transcript
    .toLowerCase()
    .split(/,|\band\b|&/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return clauses.reduce<VoiceParse>(
    (acc, clause) => {
      const player = playerIn(clause, players);
      if (player === null) return acc;
      const { heard, matches } = acc;
      if (/\bgin\b/.test(clause)) {
        return {
          heard: {
            knockerId: player.id,
            knockType: 'gin',
            deadwood: { ...heard.deadwood, [player.id]: 0 },
          },
          matches: [...matches, `${player.name}: Gin`],
        };
      }
      const n = extractNumber(clause);
      if (/\bknock/.test(clause)) {
        return {
          heard: {
            knockerId: player.id,
            knockType: 'knock',
            deadwood: n === null ? heard.deadwood : { ...heard.deadwood, [player.id]: n },
          },
          matches: [...matches, `${player.name}: Knock${n === null ? '' : ` (${String(n)})`}`],
        };
      }
      if (n === null) return acc;
      return {
        heard: { ...heard, deadwood: { ...heard.deadwood, [player.id]: n } },
        matches: [...matches, `${player.name}: ${String(n)}`],
      };
    },
    { heard: EMPTY_HEARD, matches: [] },
  );
};
