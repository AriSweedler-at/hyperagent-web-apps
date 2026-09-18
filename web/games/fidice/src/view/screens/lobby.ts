// The lobby (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html lines 2721-2790
// (bundle section "// src/view/screens/lobby.ts"); every id, class, tooltip and text is the
// bundle's. The code and share links (or the pass-the-phone banner), the seats, and the host's
// start / add-a-computer / watch controls with the hint the e2e specs read (#startHint).
import type { PublicState } from '../../domain/types.ts';
import { seatOptions, seats } from '../components.ts';
import type { Dispatch, Ui } from '../types.ts';
import { isHostUi, playerLink, spectatorLink } from '../ui.ts';
import { h, targetChecked, type VNode } from '../vdom.ts';

const shareRow = (
  icon: string,
  tip: string,
  label: string,
  id: string,
  link: string,
  dispatch: Dispatch,
): VNode =>
  h(
    'div',
    { class: 'share' },
    h('span', { tip, style: 'font-size:22px' }, icon),
    h(
      'div',
      { style: 'flex:1;text-align:left' },
      h('label', {}, label),
      h('input', { id, attrs: { readonly: 'readonly' }, props: { value: link } }),
    ),
    h(
      'button',
      {
        class: 'btn-secondary',
        on: {
          click: () => {
            dispatch({ type: 'copy', text: link });
          },
        },
      },
      'Copy',
    ),
  );

const startHint = (ui: Ui, game: PublicState): string => {
  if (ui.busy) return ui.busy;
  if (!isHostUi(ui)) return 'Waiting for the host to start the game…';
  return game.players.length < 2
    ? 'Share the player link — you need one more player.'
    : 'Everyone here? Hit start.';
};

const lobbyScreen = (ui: Ui, game: PublicState, dispatch: Dispatch): VNode => {
  const host = isHostUi(ui);
  return h(
    'div',
    { class: 'stack', id: 'screen-lobby' },
    ui.localTable
      ? h(
          'div',
          { class: 'panel center', id: 'localBanner' },
          h('div', { style: 'font-size:34px' }, '\u{1F4F1}'),
          h('h2', { style: 'font-size:22px;color:var(--pine)' }, 'Pass the phone'),
          h(
            'p',
            { class: 'muted', style: 'margin:4px auto 0;max-width:520px' },
            "Everyone plays on this device. When the cup reaches someone new, the screen covers itself until they confirm it's them — so hand it over freely. Add computers below if you like.",
          ),
        )
      : h(
          'div',
          { class: 'panel center' },
          h(
            'div',
            { class: 'small muted', style: 'font-weight:800;letter-spacing:1px' },
            'LOBBY CODE',
          ),
          h('div', { class: 'code', id: 'lobbyCode' }, game.code),
          h(
            'div',
            { class: 'stack', style: 'max-width:640px;margin:14px auto 0' },
            shareRow(
              '\u{1F3B2}',
              'Friends who open this link sit down at the table',
              'Player link',
              'playerLink',
              playerLink(ui, game.code),
              dispatch,
            ),
            shareRow(
              '\u{1F440}',
              'Watch-only: shows the ladder with the cup and the bid tracked live',
              'Spectator link',
              'specLink',
              spectatorLink(ui, game.code),
              dispatch,
            ),
          ),
        ),
    h(
      'div',
      { class: 'panel' },
      h(
        'div',
        { class: 'row', style: 'margin-bottom:12px' },
        h('h2', { style: 'font-size:22px' }, 'At the table'),
        h(
          'span',
          { class: 'muted small' },
          `${String(game.players.length)}/6 players \xB7 ${game.lives === 0 ? 'keeping score' : `${String(game.lives)} lives each`}`,
        ),
        h('span', { class: 'spacer' }),
        h(
          'span',
          { class: 'small muted' },
          game.spectators ? `\u{1F440} ${String(game.spectators)} watching` : '',
        ),
      ),
      seats(game, seatOptions(ui, dispatch), true),
      h(
        'div',
        { class: 'row', style: 'margin-top:16px' },
        host &&
          h(
            'button',
            {
              class: 'btn-primary btn-big',
              id: 'btnStart',
              tip: 'Needs at least 2 players. Late arrivals watch as spectators.',
              props: { disabled: game.players.length < 2 },
              on: {
                click: () => {
                  dispatch({ type: 'lobby.start' });
                },
              },
            },
            'Start game',
          ),
        host &&
          h(
            'button',
            {
              class: 'btn-secondary',
              id: 'btnAddBot',
              tip: 'Seat a computer player. They bluff, call, and shake the cup on their own.',
              props: { disabled: game.players.length >= 6 },
              on: {
                click: () => {
                  dispatch({ type: 'lobby.addBot' });
                },
              },
            },
            '\u{1F916} Add a computer',
          ),
        host &&
          h(
            'label',
            {
              class: 'toggle',
              id: 'watchWrap',
              tip: 'Give up your seat and watch the game instead',
            },
            h('input', {
              id: 'watchCb',
              attrs: { type: 'checkbox' },
              props: { checked: game.hostSeat === null },
              on: {
                change: (e) => {
                  dispatch({ type: 'lobby.watch', watching: targetChecked(e) });
                },
              },
            }),
            " I'll just watch",
          ),
        h('span', { class: 'muted small', id: 'startHint' }, startHint(ui, game)),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn-ghost',
            id: 'btnLeave',
            on: {
              click: () => {
                dispatch({ type: 'leave' });
              },
            },
          },
          'Leave lobby',
        ),
      ),
    ),
  );
};

export { shareRow, startHint, lobbyScreen };
