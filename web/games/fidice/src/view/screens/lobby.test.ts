// The lobby on the fake DOM: the code and links, the seats (data-seat, .me, bot controls), the
// host's controls and #startHint (which e2e/shell-online reads through fidice's row in
// e2e/fixtures/online-games.ts), and what each control dispatches.
import { describe, expect, test } from 'vitest';

import { describeProfile, strategyFor } from '../../bots/registry.ts';
import {
  all,
  byClass,
  byId,
  fire,
  hasClass,
  requireId,
} from '../../../../../shared/edge/dom.fake.ts';
import { renderApp } from '../render.fake.ts';
import { CODE, SCENARIOS, SHARE_BASE } from '../scenarios.ts';

const seatsIn = (root: ReturnType<typeof renderApp>['root']): ReadonlyArray<string | null> =>
  all(root, (el) => el.getAttribute('data-seat') !== null).map((el) =>
    el.getAttribute('data-seat'),
  );

describe('lobbyScreen for the host', () => {
  const ui = SCENARIOS['lobby: host'];

  test('the code, both share links and their copy buttons', () => {
    const { root, intents } = renderApp(ui);
    requireId(root, 'screen-lobby');
    expect(requireId(root, 'lobbyCode').textContent).toBe(CODE);
    expect(requireId(root, 'playerLink').value).toBe(`${SHARE_BASE}#join=${CODE}`);
    expect(requireId(root, 'playerLink').getAttribute('readonly')).toBe('readonly');
    expect(requireId(root, 'specLink').value).toBe(`${SHARE_BASE}#watch=${CODE}`);
    byClass(root, 'share').forEach((row) => {
      const copy = byClass(row, 'btn-secondary')[0];
      if (copy) fire(copy, 'click');
    });
    expect(intents()).toEqual([
      { type: 'copy', text: `${SHARE_BASE}#join=${CODE}` },
      { type: 'copy', text: `${SHARE_BASE}#watch=${CODE}` },
    ]);
    expect(byId(root, 'localBanner')).toBeNull();
  });

  test('the seats: four players, two open seats, me marked, bots with controls', () => {
    const { root, intents } = renderApp(ui);
    expect(seatsIn(root)).toEqual(['0', '1', '2', '3']);
    expect(byClass(root, 'empty-seat').map((s) => s.textContent)).toEqual([
      'Open seat',
      'Open seat',
    ]);
    const [me, guest, bot1, bot2] = byClass(root, 'seat').filter((s) => !hasClass(s, 'empty-seat'));
    expect(me && hasClass(me, 'me')).toBe(true);
    expect(me && byClass(me, 'nm')[0]?.textContent).toBe('Ari \u{1F451} (you)');
    expect(guest && byClass(guest, 'status')[0]?.textContent).toBe('Ready');
    expect(guest && byClass(guest, 'dot')[0]?.getAttribute('class')).toBe('dot');
    const summary = byClass(root, 'row')[0];
    expect(summary?.textContent).toContain('4/6 players \xB7 keeping score');
    expect(summary?.textContent).toContain('\u{1F440} 2 watching');
    // Bot controls for the host: rename, configure, remove.
    const rename = requireId(root, 'botName-2');
    expect(rename.value).toBe(ui.game?.players[2]?.name);
    expect(bot1 && byClass(bot1, 'bot-strategy')[0]?.textContent).toBe(
      strategyFor({ strategy: 'profiler', random: false }).name,
    );
    expect(bot2 && byClass(bot2, 'bot-strategy')[0]?.textContent).toBe(
      `\u{1F3B2} ${strategyFor({ strategy: 'gambler', random: true }).name}`,
    );
    fire(rename, 'change', { value: 'Loon' });
    fire(rename, 'keydown', { key: 'Enter' });
    fire(requireId(root, 'btnConfig-3'), 'click');
    const remove = bot2 && byClass(bot2, 'remove-bot')[0];
    if (remove) fire(remove, 'click');
    expect(intents()).toEqual([
      { type: 'lobby.renameBot', seat: 2, name: 'Loon' },
      { type: 'config.open', target: { kind: 'seat', seat: 3 } },
      { type: 'lobby.removeBot', seat: 3 },
    ]);
  });

  test('start, add a computer, watch, the hint and leave', () => {
    const { root, intents } = renderApp(ui);
    const start = requireId(root, 'btnStart');
    expect(start.disabled).toBe(false);
    expect(start.textContent).toBe('Start game');
    expect(requireId(root, 'btnAddBot').disabled).toBe(false);
    requireId(root, 'watchWrap');
    expect(requireId(root, 'watchCb').checked).toBe(false);
    expect(requireId(root, 'startHint').textContent).toBe('Everyone here? Hit start.');
    fire(start, 'click');
    fire(requireId(root, 'btnAddBot'), 'click');
    fire(requireId(root, 'watchCb'), 'change', { checked: true });
    fire(requireId(root, 'btnLeave'), 'click');
    expect(intents()).toEqual([
      { type: 'lobby.start' },
      { type: 'lobby.addBot' },
      { type: 'lobby.watch', watching: true },
      { type: 'leave' },
    ]);
  });

  test('alone: start disabled, the hint asks for a player, five seats wait', () => {
    const { root } = renderApp(SCENARIOS['lobby: host alone']);
    expect(requireId(root, 'btnStart').disabled).toBe(true);
    expect(requireId(root, 'startHint').textContent).toBe(
      'Share the player link — you need one more player.',
    );
    expect(byClass(root, 'empty-seat').map((s) => s.textContent)).toEqual([
      'Waiting for a player…',
      'Open seat',
      'Open seat',
      'Open seat',
      'Open seat',
    ]);
    expect(byClass(root, 'row')[0]?.textContent).toContain('1/6 players \xB7 3 lives each');
  });

  test('busy text replaces the hint; watching ticks the box', () => {
    expect(requireId(renderApp(SCENARIOS['lobby: host, busy']).root, 'startHint').textContent).toBe(
      'Starting…',
    );
    expect(requireId(renderApp(SCENARIOS['lobby: host watching']).root, 'watchCb').checked).toBe(
      true,
    );
  });

  test('pass the phone shows the banner instead of the code', () => {
    const { root } = renderApp(SCENARIOS['lobby: pass the phone']);
    requireId(root, 'localBanner');
    expect(byId(root, 'lobbyCode')).toBeNull();
    expect(byId(root, 'playerLink')).toBeNull();
  });
});

describe('lobbyScreen for a guest', () => {
  test('no host controls, the waiting hint, bots as plain seats', () => {
    const ui = SCENARIOS['lobby: guest'];
    const { root, intents } = renderApp(ui);
    expect(byId(root, 'btnStart')).toBeNull();
    expect(byId(root, 'btnAddBot')).toBeNull();
    expect(byId(root, 'watchCb')).toBeNull();
    expect(requireId(root, 'startHint').textContent).toBe(
      'Waiting for the host to start the game…',
    );
    expect(byClass(root, 'bot-controls')).toEqual([]);
    const bot = ui.game?.players[2]?.bot;
    expect(byClass(root, 'status').map((s) => s.textContent)).toEqual([
      'Ready',
      'Ready',
      `Computer \xB7 ${bot ? describeProfile(bot) : ''}`,
      `Computer \xB7 ${describeProfile({ strategy: 'gambler', random: true })}`,
    ]);
    const me = byClass(root, 'seat').find((s) => hasClass(s, 'me'));
    expect(me?.getAttribute('data-seat')).toBe('1');
    fire(requireId(root, 'btnLeave'), 'click');
    expect(intents()).toEqual([{ type: 'leave' }]);
  });
});
