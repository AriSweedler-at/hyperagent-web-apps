import { describe, expect, test } from 'vitest';

import { HISTORY_IDS, SHELL_GAMES, SHELL_IDS } from './ids.ts';

describe('SHELL_IDS', () => {
  test('is a list of distinct, well-formed ids for the three shell games; the built pages are checked in test/dist', () => {
    expect(SHELL_GAMES).toEqual(['gin-rummy', 'fidice', 'backgammon', 'briscola']);
    expect(new Set(SHELL_IDS).size).toBe(SHELL_IDS.length);
    SHELL_IDS.forEach((id) => {
      expect(id).toMatch(/^[a-z][A-Za-z0-9]*$/);
    });
    // The five screens and the curtain, toast and waiting-room ids the shared painters write.
    expect(SHELL_IDS).toEqual(
      expect.arrayContaining([
        'homeScreen',
        'hostWaitScreen',
        'guestWaitScreen',
        'tableScreen',
        'endgameScreen',
        'roomCode',
        'hostWaitStatus',
        'guestWaitStatus',
        'startGameBtn',
        'toast',
        'soundBtn',
        'handoffBtn',
        'curtainOverlay',
        'curtainTitle',
        'curtainSub',
        'curtainLast',
        'curtainBtn',
      ]),
    );
  });

  test('the history sheet ids (web/shared/ui/history.ts paints the list) are all shell ids', () => {
    expect(HISTORY_IDS).toEqual({
      button: 'historyBtn',
      overlay: 'historyOverlay',
      list: 'historyList',
      recent: 'recentGames',
      close: 'closeHistoryBtn',
    });
    Object.values(HISTORY_IDS).forEach((id) => {
      expect(SHELL_IDS).toContain(id);
    });
  });
});
