import { describe, expect, test } from 'vitest';

import { csvEscape, csvFileName, csvRows, csvText, exportCsv } from './csv.ts';
import type { ScorerState } from './scores.ts';

const state: ScorerState = {
  players: [
    { id: 'a', name: 'Ann' },
    { id: 'b', name: 'Bob, Jr' },
  ],
  target: 100,
  rounds: [
    {
      deadwood: { a: 5, b: 20 },
      knockerId: 'a',
      knockType: 'knock',
      scores: { a: 15, b: 0 },
      ts: 1_700_000_090_000,
    },
    {
      deadwood: { a: 12, b: 0 },
      knockerId: 'b',
      knockType: 'gin',
      scores: { a: 0, b: 37 },
      ts: 1_700_003_700_000,
    },
  ],
  startedAt: 1_700_000_000_000,
};
const iso = (ts: number): string => new Date(ts).toISOString();

describe('csvEscape', () => {
  test('quotes only what needs it and doubles inner quotes', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('two\nlines')).toBe('"two\nlines"');
    expect(csvEscape(12)).toBe('12');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
});

describe('csvRows / csvText / exportCsv', () => {
  test('header, one row per hand with durations since the previous, a blank row and totals', () => {
    expect(csvRows(state, iso)).toEqual([
      [
        'Hand',
        'Time',
        'Duration',
        'Knocker',
        'Type',
        'Ann Deadwood',
        'Bob, Jr Deadwood',
        'Ann Score',
        'Bob, Jr Score',
      ],
      [1, '2023-11-14T22:14:50.000Z', '1m 30s', 'Ann', 'Knock', 5, 20, 15, 0],
      [2, '2023-11-14T23:15:00.000Z', '1h 0m', 'Bob, Jr', 'Gin', 12, 0, 0, 37],
      [],
      ['TOTAL', '', '', '', '', '', '', 15, 37],
    ]);
    expect(exportCsv(state, iso)).toBe(
      [
        'Hand,Time,Duration,Knocker,Type,Ann Deadwood,"Bob, Jr Deadwood",Ann Score,"Bob, Jr Score"',
        '1,2023-11-14T22:14:50.000Z,1m 30s,Ann,Knock,5,20,15,0',
        '2,2023-11-14T23:15:00.000Z,1h 0m,"Bob, Jr",Gin,12,0,0,37',
        '',
        'TOTAL,,,,,,,15,37',
      ].join('\r\n'),
    );
  });

  test('a missing knocker or count leaves the cell empty; a missing score is 0', () => {
    const odd: ScorerState = {
      ...state,
      rounds: [
        {
          deadwood: { a: 3 },
          knockerId: 'zz',
          knockType: 'knock',
          scores: { a: 1 },
          ts: 1_700_000_001_000,
        },
      ],
    };
    expect(csvRows(odd, iso)[1]).toEqual([
      1,
      '2023-11-14T22:13:21.000Z',
      '1s',
      '',
      'Knock',
      3,
      '',
      1,
      0,
    ]);
    expect(csvText([[]])).toBe('');
    expect(csvText([['a'], []])).toBe('a\r\n');
  });

  test('the file name joins the players with -vs-, letters and digits only, plus a minute stamp', () => {
    expect(csvFileName(state.players, Date.UTC(2026, 8, 18, 17, 30, 59))).toBe(
      'gin-rummy-Ann-vs-BobJr-2026-09-18-17-30.csv',
    );
    expect(csvFileName([{ id: 'x', name: 'Zoë 🃏' }], 0)).toBe('gin-rummy-Zo-1970-01-01-00-00.csv');
  });
});
