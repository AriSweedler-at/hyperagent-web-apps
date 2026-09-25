// The finished games under the history list over a FAKE page (web/shared/edge/page.fake.ts; the
// markup is kept as a string, so the lines are asserted as the markup a paint wrote): one line per
// game newest first with the local time, the names, the score and the mark, nothing for none, the
// key that survives a repaint and changes with a new game, and the names escaped.
import { describe, expect, test } from 'vitest';

import { setHtml, trustedHtml } from '../edge/dom.ts';
import { fakeEl, fakePage } from '../edge/page.fake.ts';
import type { RecentGame } from '../lib/recentGames.ts';
import { HISTORY_IDS } from './ids.ts';
import {
  OUTCOME_MARKS,
  RECENT_GAMES_TITLE,
  formatWhen,
  paintRecentGames,
  recentGameHtml,
  recentGamesHtml,
  recentGamesKey,
} from './recentGames.ts';

const AT = 1_700_000_000_000;
const win: RecentGame = {
  at: AT,
  mode: 'local',
  players: ['Ann', 'Bob'],
  score: '104–87',
  winner: 0,
  outcome: 'win',
};
const loss: RecentGame = {
  at: AT + 60_000,
  mode: 'online',
  players: ['Host <b>', 'Me'],
  score: '2–5',
  winner: 0,
  outcome: 'loss',
};
const draw: RecentGame = { ...win, at: AT + 120_000, winner: null, outcome: 'draw', score: '0–0' };

describe('recentGameHtml', () => {
  test('one line: the outcome and mode as data, the local time, the names joined, the score, the mark; names escaped', () => {
    expect(recentGameHtml(win).markup).toBe(
      `<li class="recent-game" data-outcome="win" data-mode="local"><span class="recent-game-when">${formatWhen(AT)}</span><span class="recent-game-players">Ann · Bob</span><span class="recent-game-score">104–87</span><span class="recent-game-outcome">W</span></li>`,
    );
    const escaped = recentGameHtml(loss).markup;
    expect(escaped).toContain('data-outcome="loss" data-mode="online"');
    expect(escaped).toContain('<span class="recent-game-players">Host &lt;b&gt; · Me</span>');
    expect(escaped).toContain('<span class="recent-game-outcome">L</span>');
    expect(recentGameHtml(draw).markup).toContain('<span class="recent-game-outcome">D</span>');
    expect(OUTCOME_MARKS).toEqual({ win: 'W', loss: 'L', draw: 'D' });
    // The line spells no `</div>`: the gin DOM-parity oracle drops the slot up to its first.
    expect(recentGamesHtml([win, loss, draw]).markup).not.toContain('</div>');
  });

  test('formatWhen is the device`s locale date and short time', () => {
    expect(formatWhen(AT)).toBe(
      new Date(AT).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    );
  });
});

describe('recentGamesHtml and recentGamesKey', () => {
  test('the heading and one line per game in the list`s order; nothing for none', () => {
    expect(recentGamesHtml([]).markup).toBe('');
    const markup = recentGamesHtml([loss, win]).markup;
    expect(
      markup.startsWith(
        `<h3 class="recent-games-title">${RECENT_GAMES_TITLE}</h3><ol class="recent-games-list"><li`,
      ),
    ).toBe(true);
    expect(markup.endsWith('</li></ol>')).toBe(true);
    expect(markup.match(/<li class="recent-game"/g)).toHaveLength(2);
    expect(markup.indexOf('data-outcome="loss"')).toBeLessThan(
      markup.indexOf('data-outcome="win"'),
    );
    expect(RECENT_GAMES_TITLE).toBe('Recent games');
  });

  test('the key is `-` for none, else the count and the newest clock', () => {
    expect(recentGamesKey([])).toBe('-');
    expect(recentGamesKey([win])).toBe(`1:${String(AT)}`);
    expect(recentGamesKey([loss, win])).toBe(`2:${String(AT + 60_000)}`);
  });
});

describe('paintRecentGames', () => {
  test('paints the slot under its key, leaves it alone under the same key, repaints for a new game and empties for none', () => {
    const slot = fakeEl(HISTORY_IDS.recent, { classes: ['recent-games'] });
    const page = fakePage([slot]);
    paintRecentGames(page.doc, [win]);
    expect(slot.attr('data-key')).toBe(`1:${String(AT)}`);
    expect(slot.text()).toBe(recentGamesHtml([win]).markup);
    // The same list again: the slot is not rebuilt (its content, had it changed, would stay).
    setHtml(slot.el, trustedHtml('kept'));
    paintRecentGames(page.doc, [win]);
    expect(slot.text()).toBe('kept');
    paintRecentGames(page.doc, [loss, win]);
    expect(slot.attr('data-key')).toBe(`2:${String(AT + 60_000)}`);
    expect(slot.text()).toBe(recentGamesHtml([loss, win]).markup);
    paintRecentGames(page.doc, []);
    expect(slot.attr('data-key')).toBe('-');
    expect(slot.text()).toBe('');
  });
});
