// The table's builders as strings (docs/design/briscola.md §5.2, §5.5, §5.6): the faces come
// through the pack (`linea`'s picture, the glyph where a pack has none), the hand is always three
// slots with the button semantics on the held ones, the fan carries `data-seat` and a chip per
// play, the seats show what they hold and a chip per trick taken (the row growing, the arriving
// one laid for the flight), the stock empties to nothing, the score cells read per player or per
// team with one leader at most, and every key changes exactly when its container's picture does.
// Names are escaped.
import { describe, expect, test } from 'vitest';

import { packByName } from '../../../../shared/lib/cards/packs.ts';
import { cardById, type Card, type Player, type Seat } from '../engine/index.ts';
import {
  briscolaHtml,
  cardHtml,
  cardLabelEn,
  cellOfSeat,
  chipCount,
  chipsHtml,
  gameBadgeText,
  handHtml,
  handKey,
  leadCue,
  matchLabel,
  scoreCells,
  scoreKey,
  scoreMode,
  scoreStripHtml,
  seatCardsHtml,
  seatCellId,
  seatCells,
  seatHtml,
  seatKey,
  settleSlots,
  slotLabel,
  stockHtml,
  stockKey,
  stockLabel,
  stripKey,
  trickHtml,
  trickKey,
  tricksText,
  trumpBadge,
  whoName,
  withDataSeat,
} from './table.ts';

const LINEA = packByName('linea');
/** Gin's back over glyph faces: it draws no `italian40`, so every face is the glyph. */
const GLYPH = packByName('default');
const PLAYERS: ReadonlyArray<Player> = [
  { id: 'p1', name: 'Ari' },
  { id: 'p2', name: 'Jeff' },
  { id: 'p3', name: 'Cara' },
  { id: 'p4', name: 'Dan' },
];
const card = (id: string): Card => {
  const c = cardById(id);
  if (c === null) throw new Error(`no card ${id}`);
  return c;
};
const AC = card('AC');
const LINEA_AC = (extra: string): string =>
  `<div class="card face${extra}" data-card="AC" role="img" aria-label="asso di coppe" style="--face-inset:0;background-image:url(../../shared/cards/linea/italian40/AC.svg)"></div>`;
const GLYPH_RB =
  '<div class="card face glyph suit-B" data-card="RB"><span class="rank">R</span><svg class="suit" aria-hidden="true"><use href="#suit-B"/></svg><span class="rank br">R</span></div>';

describe('cards through the pack', () => {
  test('a face is the pack picture, the glyph where the pack has none, a back for a stranger', () => {
    expect(cardHtml(LINEA, 'AC')).toBe(LINEA_AC(''));
    expect(cardHtml(LINEA, 'AC', 'mid taking')).toBe(LINEA_AC(' mid taking'));
    expect(cardHtml(GLYPH, 'RB')).toBe(GLYPH_RB);
    expect(cardHtml(LINEA, 'ZZ', 'mid')).toBe('<div class="card back mid"></div>');
  });

  test('withDataSeat writes the seat into the opening tag and nowhere else', () => {
    expect(withDataSeat(LINEA_AC(' mid'), 3)).toBe(
      `<div data-seat="3" ${LINEA_AC(' mid').slice(5)}`,
    );
    expect(withDataSeat(GLYPH_RB, 0).match(/data-seat/g)).toHaveLength(1);
  });

  test('the English label keeps the figures Italian', () => {
    expect(cardLabelEn(card('7C'))).toBe('7 of cups');
    expect(cardLabelEn(card('RS'))).toBe('Re of swords');
    expect(cardLabelEn(card('CD'))).toBe('Cavallo of coins');
    expect(cardLabelEn(card('FB'))).toBe('Fante of batons');
    expect(cardLabelEn(AC)).toBe('Ace of cups');
    expect(slotLabel(AC, 'play')).toBe('Ace of cups, play');
    expect(slotLabel(AC, 'lifted')).toBe('Ace of cups, lifted');
    expect(slotLabel(AC, null)).toBe('Ace of cups');
  });
});

describe('seatCells', () => {
  test('r1 right, r2 top, r3 left, relative to me, for every (n, me)', () => {
    expect(seatCells(2, 0)).toEqual({ R1: null, R2: 1, R3: null });
    expect(seatCells(2, 1)).toEqual({ R1: null, R2: 0, R3: null });
    expect(seatCells(3, 0)).toEqual({ R1: 1, R2: null, R3: 2 });
    expect(seatCells(3, 1)).toEqual({ R1: 2, R2: null, R3: 0 });
    expect(seatCells(3, 2)).toEqual({ R1: 0, R2: null, R3: 1 });
    expect(seatCells(4, 0)).toEqual({ R1: 1, R2: 2, R3: 3 });
    expect(seatCells(4, 1)).toEqual({ R1: 2, R2: 3, R3: 0 });
    expect(seatCells(4, 2)).toEqual({ R1: 3, R2: 0, R3: 1 });
    expect(seatCells(4, 3)).toEqual({ R1: 0, R2: 1, R3: 2 });
  });

  test('cellOfSeat inverts it; my own seat is in no cell; ids are seatR1..3', () => {
    expect(cellOfSeat(4, 1, 3)).toBe('R2');
    expect(cellOfSeat(2, 0, 1)).toBe('R2');
    expect(cellOfSeat(3, 0, 2)).toBe('R3');
    expect(cellOfSeat(3, 0, 0)).toBeNull();
    expect(seatCellId('R1')).toBe('seatR1');
  });
});

describe('handHtml', () => {
  const slots = ['AC', null, 'RB'];
  test('three slots always: the held ones are buttons, the hole is empty, faces through the pack', () => {
    const html = handHtml(LINEA, slots, { selected: null, playable: ['AC', 'RB'] });
    expect(html.match(/class="slot/g)).toHaveLength(3);
    expect(html).toContain(
      `<div class="slot" role="button" tabindex="0" aria-pressed="false" aria-label="Ace of cups, play">${LINEA_AC(' playable')}</div>`,
    );
    expect(html).toContain('<div class="slot empty"></div>');
    expect(html).toContain('aria-label="Re of batons, play"');
    expect(html.indexOf('AC')).toBeLessThan(html.indexOf('slot empty'));
  });

  test('a lifted card is pressed and says so; not my turn, a card is neither a button nor playable', () => {
    const lifted = handHtml(LINEA, slots, { selected: 'AC', playable: ['AC', 'RB'] });
    expect(lifted).toContain(
      `role="button" tabindex="0" aria-pressed="true" aria-label="Ace of cups, lifted">${LINEA_AC(' selected playable')}`,
    );
    const inert = handHtml(LINEA, slots, { selected: null, playable: [] });
    expect(inert).toContain(`<div class="slot" aria-label="Ace of cups">${LINEA_AC('')}</div>`);
    expect(inert).not.toContain('role="button"');
    expect(inert).not.toContain('tabindex');
  });

  test('face down (the curtain): backs in the held slots, no ids, the hole kept', () => {
    const down = handHtml(LINEA, slots, { selected: 'AC', playable: ['AC'], faceDown: true });
    expect(down).toBe(
      '<div class="slot"><div class="card back "></div></div><div class="slot empty"></div><div class="slot"><div class="card back "></div></div>',
    );
  });

  test('handKey: the ids with ∅ for a hole, the pack, and `down` under the curtain', () => {
    expect(handKey(slots, 'linea')).toBe('AC,∅,RB|linea');
    expect(handKey(slots, 'linea', true)).toBe('AC,∅,RB|linea|down');
    expect(handKey([null, null, null], 'napoletane')).toBe('∅,∅,∅|napoletane');
    // A lift is outside the key.
    expect(handKey(slots, 'linea')).toBe(handKey(slots, 'linea', false));
  });
});

describe('settleSlots', () => {
  const cards = (...ids: ReadonlyArray<string>): ReadonlyArray<Card> => ids.map(card);
  test('a played card leaves a hole; the drawn card fills it; the others never move', () => {
    expect(settleSlots(['AC', '7D', 'RB'], cards('AC', 'RB'))).toEqual(['AC', null, 'RB']);
    expect(settleSlots(['AC', null, 'RB'], cards('AC', 'RB', '3S'))).toEqual(['AC', '3S', 'RB']);
    expect(settleSlots(['AC', null, 'RB'], cards('RB', '3S', 'AC'))).toEqual(['AC', '3S', 'RB']);
  });
  test('a deal, a resume or a hand that does not fit the picture fills left to right', () => {
    expect(settleSlots([null, null, null], cards('AC', '7D', 'RB'))).toEqual(['AC', '7D', 'RB']);
    expect(settleSlots(['AC', 'RB', null], cards('3S', '4S', '5S'))).toEqual(['3S', '4S', '5S']);
    expect(settleSlots(['AC', 'RB', '7D'], cards('AC'))).toEqual(['AC', null, null]);
    expect(settleSlots([], cards('AC', '7D'))).toEqual(['AC', '7D', null]);
  });
});

describe('trickHtml', () => {
  const trick = [
    { seat: 1 as Seat, card: AC },
    { seat: 0 as Seat, card: card('RB') },
  ];
  test('the fan in play order: a .play column per card with --i, data-seat on the card, a chip; the taker lifted', () => {
    const html = trickHtml(trick, { players: PLAYERS, me: 0, pack: LINEA, taking: 0 });
    expect(html).toBe(
      `<div class="play" role="group" aria-label="Ace of cups, played by Jeff" style="--i:0">${withDataSeat(
        LINEA_AC(' mid'),
        1,
      )}<span class="who">Jeff</span></div>` +
        `<div class="play" role="group" aria-label="Re of batons, played by you" style="--i:1">${withDataSeat(
          cardHtml(LINEA, 'RB', 'mid taking'),
          0,
        )}<span class="who">You</span></div>`,
    );
    expect(trickHtml([], { players: PLAYERS, me: 0, pack: LINEA, taking: null })).toBe('');
  });

  test('keys, cues and names', () => {
    expect(trickKey(trick)).toBe('1:AC,0:RB');
    expect(trickKey([])).toBe('');
    expect(leadCue(PLAYERS, 0, 0)).toBe('You lead');
    expect(leadCue(PLAYERS, 0, 2)).toBe('Cara leads');
    expect(whoName(PLAYERS, 1, 1)).toBe('You');
    expect(whoName(PLAYERS, 1, 3)).toBe('Dan');
  });

  test('a name is escaped in the chip and the label', () => {
    const html = trickHtml([{ seat: 1, card: AC }], {
      players: [PLAYERS[0] ?? { id: '', name: '' }, { id: 'p2', name: '<b>x</b>' }],
      me: 0,
      pack: GLYPH,
      taking: null,
    });
    expect(html).toContain('<span class="who">&lt;b&gt;x&lt;/b&gt;</span>');
    expect(html).toContain('aria-label="Ace of cups, played by &lt;b&gt;x&lt;/b&gt;"');
    expect(html).not.toContain('<b>');
  });
});

describe('seats', () => {
  const cell = {
    name: 'Jeff',
    handCount: 3,
    hand: null,
    tricks: 2,
    connected: true as boolean | null,
  };
  const CHIP = '<div class="card back chip"></div>';
  test('the cell: name, tiny backs per card held, the taken strip with a chip per trick and its count, the dot on/off/hidden', () => {
    expect(seatHtml(LINEA, cell)).toBe(
      `<span class="seat-name">Jeff</span><span class="seat-cards"><div class="card back tiny"></div><div class="card back tiny"></div><div class="card back tiny"></div></span><span class="seat-taken" data-count="2" style="--n:2">${CHIP}${CHIP}</span><span class="conn-dot on"></span>`,
    );
    expect(seatHtml(LINEA, { ...cell, connected: false, tricks: 1 })).toContain(
      `<span class="seat-taken" data-count="1" style="--n:1">${CHIP}</span><span class="conn-dot off"></span>`,
    );
    expect(seatHtml(LINEA, { ...cell, connected: null, tricks: 0 })).toContain(
      '<span class="seat-taken" data-count="0" style="--n:0"></span><span class="conn-dot" hidden></span>',
    );
    // The trick in flight: one chip more than the tricks, for the cards to land on.
    expect(seatHtml(LINEA, { ...cell, tricks: 0, arriving: true })).toContain(
      `<span class="seat-taken" data-count="1" style="--n:1">${CHIP}</span>`,
    );
    expect(seatHtml(LINEA, { ...cell, dotId: 'oppDot' })).toContain(
      '<span id="oppDot" class="conn-dot on"></span>',
    );
    expect(seatHtml(LINEA, { ...cell, name: 'a<b' })).toContain(
      '<span class="seat-name">a&lt;b</span>',
    );
  });

  test('a shown hand (scoperta, the partner peek) paints tiny faces through the pack', () => {
    expect(seatCardsHtml(LINEA, { handCount: 1, hand: [AC] })).toBe(LINEA_AC(' tiny'));
    expect(seatCardsHtml(GLYPH, { handCount: 0, hand: null })).toBe('');
  });

  test('seatKey changes with the name, what is held, the chips (an arriving one counts), the dot and the pack', () => {
    expect(seatKey(cell, 'linea')).toBe('Jeff|3|2|on|linea');
    expect(seatKey({ ...cell, hand: [AC] }, 'linea')).toBe('Jeff|AC|2|on|linea');
    expect(seatKey({ ...cell, connected: null }, 'linea')).toBe('Jeff|3|2|-|linea');
    expect(seatKey({ ...cell, connected: false }, 'napoletane')).toBe('Jeff|3|2|off|napoletane');
    expect(seatKey({ ...cell, arriving: true }, 'linea')).toBe('Jeff|3|3|on|linea');
    expect(tricksText(0)).toBe('');
    expect(tricksText(1)).toBe('1 trick');
    expect(tricksText(7)).toBe('7 tricks');
  });

  test('the chips: one back per trick, the arriving one appended, the row as long as the count at 0, 1, 7 and 20', () => {
    expect(chipsHtml(0)).toBe('');
    expect(chipsHtml(1)).toBe(CHIP);
    expect(chipsHtml(7).match(/class="card back chip"/g)).toHaveLength(7);
    expect(chipsHtml(20).match(/class="card back chip"/g)).toHaveLength(20);
    expect(chipsHtml(0, true)).toBe(CHIP);
    expect(chipsHtml(7, true).match(/class="card back chip"/g)).toHaveLength(8);
    // A chip is a plain back: no id, no face, nothing of the trick's cards on it.
    expect(chipsHtml(3)).not.toContain('data-card');
    expect(chipCount({ tricks: 7 })).toBe(7);
    expect(chipCount({ tricks: 7, arriving: true })).toBe(8);
    expect(chipCount({ tricks: 0, arriving: false })).toBe(0);
  });

  test('stripKey: the chips shown and the pack; a flight in progress is another key, a name is not', () => {
    expect(stripKey({ tricks: 2 }, 'linea')).toBe('2|linea');
    expect(stripKey({ tricks: 2, arriving: true }, 'linea')).toBe('3|linea');
    expect(stripKey({ tricks: 3 }, 'linea')).toBe(stripKey({ tricks: 2, arriving: true }, 'linea'));
    expect(stripKey({ tricks: 0 }, 'napoletane')).toBe('0|napoletane');
  });
});

describe('the stock and the briscola', () => {
  test('a mid back while cards lie over the trump card, the top face under scoperta, nothing at one or none', () => {
    expect(stockHtml(LINEA, 34, null)).toBe('<div class="card back mid"></div>');
    expect(stockHtml(LINEA, 2, AC)).toBe(LINEA_AC(' mid'));
    expect(stockHtml(LINEA, 1, null)).toBe('');
    expect(stockHtml(LINEA, 0, null)).toBe('');
    expect(briscolaHtml(LINEA, AC)).toBe(LINEA_AC(' mid'));
    expect(stockLabel(34)).toBe('Stock · 34');
    expect(stockKey(34, null)).toBe('34:');
    expect(stockKey(2, AC)).toBe('2:AC');
  });

  test('the trump badge names the suit in Italian on the badge and in English for assistive technology', () => {
    expect(trumpBadge('C')).toEqual({ cls: 's-coppe', name: 'coppe', aria: 'Briscola: cups' });
    expect(trumpBadge('D')).toEqual({ cls: 's-denari', name: 'denari', aria: 'Briscola: coins' });
    expect(trumpBadge('S').cls).toBe('s-spade');
    expect(trumpBadge('B').aria).toBe('Briscola: batons');
  });
});

describe('the score strip and the game badge', () => {
  const two = {
    players: PLAYERS.slice(0, 2),
    options: {
      seatCount: 2 as const,
      gamesToWin: 2 as const,
      removedTwo: 'C' as const,
      exchange: false,
      scoperta: false,
      partnerPeek: false,
    },
    taken: [25, 14],
    tricks: [2, 2],
    sides: [25, 14],
    me: { idx: 0 as Seat, side: 0 as const },
  };
  test('per player: "(you)" on mine, the strictly highest leading', () => {
    expect(scoreCells(two)).toEqual([
      { name: 'Ari (you)', points: 25, tricks: 2, mine: true, leading: true },
      { name: 'Jeff', points: 14, tricks: 2, mine: false, leading: false },
    ]);
    expect(
      scoreCells({ ...two, taken: [0, 0], sides: [0, 0], tricks: [0, 0] }).map((c) => c.leading),
    ).toEqual([false, false]);
    expect(scoreCells({ ...two, me: { idx: 1, side: 1 } }).map((c) => c.name)).toEqual([
      'Ari',
      'Jeff (you)',
    ]);
  });

  test('three players: three cells; four: two teams with the sides points and the seats tricks summed', () => {
    const three = {
      ...two,
      players: PLAYERS.slice(0, 3),
      options: { ...two.options, seatCount: 3 as const },
      taken: [10, 10, 20],
      tricks: [1, 1, 2],
      sides: [10, 10, 20],
    };
    expect(scoreCells(three).map((c) => [c.name, c.points, c.leading])).toEqual([
      ['Ari (you)', 10, false],
      ['Jeff', 10, false],
      ['Cara', 20, true],
    ]);
    const four = {
      ...two,
      players: PLAYERS,
      options: { ...two.options, seatCount: 4 as const },
      taken: [20, 10, 18, 7],
      tricks: [2, 1, 1, 1],
      sides: [38, 17],
      me: { idx: 2 as Seat, side: 0 as const },
    };
    expect(scoreCells(four)).toEqual([
      { name: 'Ari & Cara', points: 38, tricks: 3, mine: true, leading: true },
      { name: 'Jeff & Dan', points: 17, tricks: 2, mine: false, leading: false },
    ]);
    expect(scoreMode(4)).toBe('teams');
    expect(scoreMode(3)).toBe('players');
  });

  test('the markup and the key', () => {
    const cells = scoreCells(two);
    expect(scoreStripHtml(cells)).toBe(
      '<div class="score-cell mine leading"><span class="sc-name">Ari (you)</span><span class="sc-points">25</span><span class="sc-tricks">2 tricks</span></div><div class="score-cell"><span class="sc-name">Jeff</span><span class="sc-points">14</span><span class="sc-tricks">2 tricks</span></div>',
    );
    expect(scoreKey('players', cells)).toBe('players|25:2,14:2');
    expect(
      scoreStripHtml([{ name: 'a&b', points: 0, tricks: 0, mine: false, leading: false }]),
    ).toContain('a&amp;b');
  });

  test('the badge: game, wins in side order, the draws when any, the match length', () => {
    expect(gameBadgeText(1, { gamesToWin: 2, wins: [0, 0], draws: 0 })).toBe(
      'Game 1 · 0–0 · best of 3',
    );
    expect(gameBadgeText(3, { gamesToWin: 2, wins: [1, 0], draws: 1 })).toBe(
      'Game 3 · 1–0 · 1 draw · best of 3',
    );
    expect(gameBadgeText(4, { gamesToWin: 3, wins: [1, 0, 1], draws: 2 })).toBe(
      'Game 4 · 1–0–1 · 2 draws · best of 5',
    );
    expect(matchLabel(1)).toBe('one game');
  });
});
