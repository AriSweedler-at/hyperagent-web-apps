// The gin scorer/ helpers against the legacy Score Counter (docs/MIGRATION.md step 11): the
// round maths, the running totals, the CSV export text and the voice parser each run beside their
// legacy cut (test/fixtures/legacy/gin-ui.cjs) over seeded inputs and must agree exactly, the CSV
// character for character and the parser's result as JSON text (key order included).
import { describe, expect, test } from 'vitest';

import { csvEscape, csvFileName, exportCsv } from '../../web/games/gin-rummy/src/scorer/csv.ts';
import {
  computeRoundScores,
  totalFor,
  type KnockType,
  type ScorerPlayer,
  type ScorerRound,
  type ScorerState,
} from '../../web/games/gin-rummy/src/scorer/scores.ts';
import {
  extractNumber,
  parseVoiceScores,
  wordsToNumber,
} from '../../web/games/gin-rummy/src/scorer/voice.ts';
import { mulberry32, type Rng } from '../../web/shared/lib/rng.ts';
import { loadLegacyGin } from './gin.api.ts';
import { loadLegacyGinUi } from './gin.fixtures.ts';

/** What the legacy `exportGame` hands the browser: the Blob's text and the link's file name. */
const exported = { csv: '', download: '' };
const ui = loadLegacyGinUi({
  engine: loadLegacyGin(),
  app: { selectedCard: null, role: null },
  fx: {},
  $: () => null,
  document: {
    getElementById: () => null,
    body: { appendChild: () => undefined, removeChild: () => undefined },
    createElement: () => ({
      set download(name: string) {
        exported.download = name;
      },
      click: () => undefined,
    }),
  },
  toast: () => undefined,
  Blob: class FakeBlob {
    readonly text: string;
    constructor(parts: ReadonlyArray<string>) {
      this.text = parts.join('');
      exported.csv = this.text;
    }
  },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined },
  setTimeout: () => 0,
  state: null,
});

const pick = <T>(rng: Rng, xs: ReadonlyArray<T>): T => {
  const x = xs[Math.floor(rng() * xs.length)];
  if (x === undefined) throw new Error('empty');
  return x;
};
const NAMES = ['Ann', 'Bob', 'Cy', 'Dee', 'Zoë', "O'Neil", 'Ann, Jr', 'Q"t', 'Jeff Two'];

const players = (rng: Rng): ReadonlyArray<ScorerPlayer> => {
  const n = 2 + Math.floor(rng() * 3);
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i)}${Math.floor(rng() * 1e6).toString(36)}`,
    name: NAMES[i] ?? `P${String(i)}`,
  }));
};
const entry = (
  rng: Rng,
  ps: ReadonlyArray<ScorerPlayer>,
): { deadwood: Record<string, number>; knockerId: string; knockType: KnockType } => {
  const knockType: KnockType = rng() < 0.3 ? 'gin' : 'knock';
  const knocker = pick(rng, ps);
  const deadwood = Object.fromEntries(
    ps
      .filter(() => rng() < 0.9)
      .map((p) => [p.id, knockType === 'gin' && p.id === knocker.id ? 0 : Math.floor(rng() * 60)]),
  );
  return { deadwood, knockerId: knocker.id, knockType };
};

const session = (rng: Rng): ScorerState => {
  const ps = players(rng);
  const startedAt = 1_700_000_000_000 + Math.floor(rng() * 1e9);
  const hands = Math.floor(rng() * 6);
  const rounds = Array.from({ length: hands }).reduce<ReadonlyArray<ScorerRound>>((acc, _, i) => {
    const e = entry(rng, ps);
    return [
      ...acc,
      {
        ...e,
        scores: computeRoundScores(ps, e),
        ts: startedAt + (i + 1) * Math.floor(rng() * 4_000_000),
      },
    ];
  }, []);
  return { players: ps, target: pick(rng, [100, 150, 250]), rounds, startedAt };
};

describe('computeRoundScores / totalFor', () => {
  test('agree with the legacy over 2000 seeded hands of 2 to 4 players', () => {
    const rng = mulberry32(31);
    Array.from({ length: 2000 }).forEach(() => {
      const ps = players(rng);
      ui.setState({ players: ps, rounds: [] });
      const e = entry(rng, ps);
      const ours = computeRoundScores(ps, e);
      const theirs = ui.computeRoundScores(e.deadwood, e.knockerId, e.knockType);
      expect(JSON.stringify(ours)).toBe(JSON.stringify(theirs));
    });
  });

  test('totals agree over seeded sessions', () => {
    const rng = mulberry32(32);
    Array.from({ length: 300 }).forEach(() => {
      const s = session(rng);
      ui.setState(s);
      s.players.forEach((p) => {
        expect(totalFor(s.rounds, p.id)).toBe(ui.totalFor(p.id));
      });
    });
  });
});

describe('the CSV export', () => {
  const formatTime = (ts: number): string => new Date(ts).toLocaleString();

  test('is the legacy text character for character over seeded sessions with hands', () => {
    const rng = mulberry32(33);
    const checked = Array.from({ length: 300 }).reduce<number>((n) => {
      const s = session(rng);
      if (s.rounds.length === 0) return n;
      ui.setState(s);
      exported.csv = '';
      ui.exportGame();
      expect(exportCsv(s, formatTime)).toBe(exported.csv);
      // The file name, up to the minute stamp taken at export time.
      const stamp = /-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2})\.csv$/.exec(exported.download);
      expect(stamp).not.toBeNull();
      const at = Date.parse(
        `${(stamp?.[1] ?? '').slice(0, 10)}T${(stamp?.[1] ?? '').slice(11).replace('-', ':')}:00Z`,
      );
      expect(csvFileName(s.players, at)).toBe(exported.download);
      return n + 1;
    }, 0);
    expect(checked).toBeGreaterThan(200);
  });

  test('csvEscape agrees on quotes, commas, newlines, numbers and empties', () => {
    ['a', 'a,b', 'say "hi"', 'two\nlines', '', 'plain 1', "O'Neil", 12, 0].forEach((v) => {
      expect(csvEscape(v)).toBe(ui.csvEscape(v));
    });
    expect(csvEscape(null)).toBe(ui.csvEscape(null));
    expect(csvEscape(undefined)).toBe(ui.csvEscape(undefined));
  });
});

describe('the voice parser', () => {
  const WORDS = [
    'zero',
    'oh',
    'one',
    'two',
    'five',
    'nine',
    'ten',
    'twelve',
    'fifteen',
    'nineteen',
    'twenty',
    'thirty',
    'forty',
    'fourty',
    'ninety',
    'hundred',
    'twenty-five',
    'forty two',
    'one hundred',
    'a hundred',
    'for',
    'ate',
    'and',
    'with',
    'knocked',
    'knock',
    'knocks',
    'gin',
    'went gin',
    'constructor',
    'toString',
    'hasOwnProperty',
    '',
  ];
  const phrase = (rng: Rng, ps: ReadonlyArray<ScorerPlayer>): string => {
    const clauses = 1 + Math.floor(rng() * 4);
    return Array.from({ length: clauses }, () => {
      const who = rng() < 0.85 ? pick(rng, ps).name : pick(rng, ['Nobody', 'ann', 'someone']);
      const number = rng() < 0.5 ? String(Math.floor(rng() * 80)) : pick(rng, WORDS);
      const verb = pick(rng, ['', 'knocked with', 'gin', 'knock', 'has', 'with', 'went gin,']);
      return pick(rng, [
        `${who} ${verb} ${number}`,
        `${who} ${number}`,
        `${verb} ${who}`,
        `${who} ${verb}`,
      ]);
    }).join(pick(rng, [', ', ' and ', ' & ', ',', ' AND ']));
  };

  test('wordsToNumber and extractNumber agree over number phrases', () => {
    const rng = mulberry32(34);
    const phrases = [
      ...WORDS,
      ...Array.from({ length: 500 }, () =>
        Array.from({ length: 1 + Math.floor(rng() * 3) }, () => pick(rng, WORDS)).join(' '),
      ),
      'i have 12 points',
      'twenty 5',
      'Twenty-Five',
      'hundred twenty',
      'two hundred',
      'Player 1 knocked',
    ];
    phrases.forEach((p) => {
      expect(wordsToNumber(p)).toBe(ui.wordsToNumber(p));
      expect(extractNumber(p)).toBe(ui.extractNumber(p));
    });
  });

  test('parseVoiceScores agrees, heard and matches, over 1500 seeded transcripts', () => {
    const rng = mulberry32(35);
    const outcomes = new Set<string>();
    Array.from({ length: 1500 }).forEach(() => {
      const ps = players(rng);
      const transcript = phrase(rng, ps);
      const ours = parseVoiceScores(transcript, ps);
      const theirs = ui.parseVoiceScores(transcript, ps);
      expect(JSON.stringify(ours), transcript).toBe(JSON.stringify(theirs));
      outcomes.add(`${String(ours.heard.knockType)}:${String(ours.matches.length > 0)}`);
    });
    expect([...outcomes].sort()).toEqual(['gin:true', 'knock:true', 'null:false', 'null:true']);
  });

  test('the documented examples', () => {
    const ps = [
      { id: 'a', name: 'Ari' },
      { id: 'j', name: 'Jeff' },
    ];
    [
      'Ari knocked with five, Jeff twenty',
      'Jeff gin, Ari twelve',
      'ari 7 and jeff knocked with 3',
    ].forEach((t) => {
      expect(JSON.stringify(parseVoiceScores(t, ps))).toBe(
        JSON.stringify(ui.parseVoiceScores(t, ps)),
      );
    });
  });
});
