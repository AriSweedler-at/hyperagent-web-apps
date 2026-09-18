// The spectator screen (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html lines
// 3172-3294 (bundle section "// src/view/screens/spectator.ts"); every id, class, tooltip and text
// is the bundle's. The cup card (public dice, the cup, an opt-in true-hand reveal), the ladder
// with the bid and cup marked, the bid card with this round's history, the log and the seats; a
// host watching a table of computers also gets the start / add-a-computer bar in the lobby.
import { HAND_COUNT, handAt, rankOf, rungOf, spokenName } from '../../domain/hands.ts';
import { publicCupIndices, publicTableIndices } from '../../domain/publicState.ts';
import type { DieValue, PublicRound, PublicState, Rank, Seat } from '../../domain/types.ts';
import { die, logView, seatOptions, seats } from '../components.ts';
import type { Dispatch, Marks, Ui } from '../types.ts';
import { isHostUi } from '../ui.ts';
import { cls, h, targetChecked, type VNode } from '../vdom.ts';
import { ladderView, noMarks } from './ladder.ts';

const nameAt = (g: PublicState, i: Seat | null): string =>
  i === null ? '?' : (g.players[i]?.name ?? '?');

/** The cup's real rank, when every die is visible to this viewer. */
const trueRank = (r: PublicRound): Rank | null => {
  const values = r.dice.map((d) => d.value);
  return values.every((v): v is DieValue => v !== null) ? rankOf(values) : null;
};

const spectatorMarks = (ui: Ui, g: PublicState): Marks => {
  const r = g.round;
  if (!r) return noMarks;
  const showTruth = ui.showTruth || g.reveal !== null;
  return { bid: r.bid, cup: showTruth ? trueRank(r) : null, dimAtOrBelow: r.bid };
};

const cupStage = (g: PublicState, r: PublicRound): string => {
  if (g.reveal) return `${nameAt(g, g.reveal.caller)} called ${nameAt(g, g.reveal.bidder)}`;
  if (r.bid === null) return 'Opening the round';
  return r.touched ? 'Accepted the cup — must raise' : 'Deciding: call or accept';
};

const cupCard = (ui: Ui, g: PublicState, dispatch: Dispatch): VNode => {
  const r = g.round;
  const showTruth = ui.showTruth || g.reveal !== null;
  const real = r ? trueRank(r) : null;
  const truthLine =
    r && showTruth && real !== null
      ? h(
          'div',
          { class: 'small', id: 'specTruth' },
          'True hand: ',
          h('b', {}, handAt(real).name),
          r.bid !== null &&
            (real >= r.bid
              ? h('span', { style: 'color:var(--pine)' }, ' — bid holds')
              : h('span', { style: 'color:var(--red)' }, ' — bid is a lie')),
        )
      : h('div', { class: 'small', id: 'specTruth' });
  const who =
    g.phase === 'over'
      ? `\u{1F3C6} ${g.winner === null ? '—' : nameAt(g, g.winner)}`
      : g.reveal
        ? 'Cup lifted!'
        : r
          ? `${nameAt(g, r.holder)} has the cup`
          : 'Waiting for the game to start';
  return h(
    'div',
    { class: 'card cup' },
    h('h3', {}, '\u{1F964} The cup'),
    h('div', { class: 'bigval', id: 'specCupWho' }, who),
    h(
      'div',
      { class: 'small muted', id: 'specCupStage' },
      r ? cupStage(g, r) : `${String(g.players.length)} players seated`,
    ),
    h(
      'div',
      {},
      h('div', { class: 'small muted', style: 'font-weight:800' }, 'Dice on the table (public)'),
      h(
        'div',
        { class: 'dice', id: 'specOutDice' },
        r && publicTableIndices(r).length
          ? publicTableIndices(r).map((i) => die(r.dice[i]?.value ?? null, { size: 'sm' }))
          : h('span', { class: 'small muted' }, 'none'),
      ),
    ),
    h(
      'div',
      {},
      h('div', { class: 'small muted', style: 'font-weight:800' }, 'Under the cup'),
      h(
        'div',
        { class: 'dice', id: 'specCupDice' },
        r && publicCupIndices(r).length
          ? publicCupIndices(r).map((i) =>
              die(showTruth ? (r.dice[i]?.value ?? null) : null, { size: 'sm' }),
            )
          : h('span', { class: 'small muted' }, 'empty'),
      ),
    ),
    h(
      'label',
      {
        class: 'toggle',
        tip: 'Reveals the real hand to spectators only. Players must NOT be looking at this screen!',
      },
      h('input', {
        id: 'truthToggle',
        attrs: { type: 'checkbox' },
        props: { checked: ui.showTruth },
        on: {
          change: (e) => {
            dispatch({ type: 'spec.truth', on: targetChecked(e) });
          },
        },
      }),
      ' Show the true hand',
    ),
    truthLine,
  );
};

const bidCard = (g: PublicState): VNode => {
  const r = g.round;
  const bid = r?.bid ?? null;
  const history = r ? [...r.history].reverse() : [];
  return h(
    'div',
    { class: 'card bid' },
    h('h3', {}, '\u{1F4E3} The bid'),
    h('div', { class: 'bigval', id: 'specBidName' }, bid === null ? 'No bid yet' : spokenName(bid)),
    h(
      'div',
      { class: 'small muted', id: 'specBidWho' },
      bid === null || !r
        ? ''
        : `by ${nameAt(g, r.bidder)} \xB7 rung ${String(rungOf(bid))} of ${String(HAND_COUNT)}`,
    ),
    h(
      'div',
      { class: 'dice', id: 'specBidDice' },
      bid === null ? [] : handAt(bid).dice.map((v) => die(v, { size: 'sm' })),
    ),
    h('div', { class: 'small muted', style: 'font-weight:800' }, "This round's bids"),
    h(
      'div',
      { class: 'bidhist', id: 'specBidHist' },
      history.length === 0
        ? h('div', {}, h('span', { class: 'muted' }, '—'))
        : history.map((b, i) =>
            h(
              'div',
              { class: cls(i === 0 && 'cur') },
              h('span', {}, nameAt(g, b.seat)),
              h('span', {}, spokenName(b.rank)),
            ),
          ),
    ),
  );
};

const spectatorScreen = (ui: Ui, g: PublicState, dispatch: Dispatch): VNode => {
  const host = isHostUi(ui);
  return h(
    'div',
    { id: 'screen-spec' },
    h(
      'div',
      { class: 'row', style: 'margin-bottom:14px' },
      h(
        'div',
        { class: 'banner', style: 'flex:1', id: 'specBanner' },
        ui.busy ?? "\u{1F440} You're watching. Nothing you do here affects the game.",
      ),
      h(
        'button',
        {
          class: 'btn-ghost',
          id: 'btnLeaveSpec',
          on: {
            click: () => {
              dispatch({ type: 'leave' });
            },
          },
        },
        host ? 'Close table' : 'Leave',
      ),
    ),
    host &&
      g.phase === 'lobby' &&
      h(
        'div',
        { class: 'panel', id: 'specHostBar', style: 'margin-bottom:14px;padding:12px 16px' },
        h(
          'div',
          { class: 'row' },
          h('b', {}, "You're hosting this table of computers."),
          h(
            'span',
            { class: 'small muted' },
            `${String(g.players.length)}/6 seated \xB7 code ${g.code}`,
          ),
          h('span', { class: 'spacer' }),
          h(
            'button',
            {
              class: 'btn-secondary',
              props: { disabled: g.players.length >= 6 },
              on: {
                click: () => {
                  dispatch({ type: 'lobby.addBot' });
                },
              },
            },
            '+ Add a computer',
          ),
          h(
            'button',
            {
              class: 'btn-primary',
              props: { disabled: g.players.length < 2 },
              on: {
                click: () => {
                  dispatch({ type: 'lobby.start' });
                },
              },
            },
            'Start game',
          ),
        ),
      ),
    h(
      'div',
      { class: 'spec' },
      h('div', { class: 'ticker' }, cupCard(ui, g, dispatch)),
      h(
        'div',
        {},
        h(
          'div',
          { class: 'ladder-head' },
          h('h2', { style: 'font-size:22px;color:var(--pine)' }, 'The Ladder'),
          h(
            'span',
            { class: 'small muted' },
            'Strongest at the top \xB7 ',
            h('span', { style: 'color:var(--accent);font-weight:800' }, '▮ bid'),
            ' on the right \xB7 ',
            h('span', { style: 'color:var(--lake);font-weight:800' }, '▮ cup'),
            ' on the left',
          ),
        ),
        ladderView(
          'spec',
          ui.ladders.spec,
          spectatorMarks(ui, g),
          dispatch,
          undefined,
          'max-height:78vh;overflow:auto',
        ),
      ),
      h(
        'div',
        { class: 'ticker' },
        bidCard(g),
        h(
          'div',
          { class: 'card', id: 'specTalk' },
          h('h3', {}, 'Table talk'),
          logView(g.log, 'spec-log'),
        ),
        h(
          'div',
          { class: 'card', id: 'specPlayers' },
          h('h3', {}, 'Players'),
          seats(g, seatOptions(ui, dispatch), false),
        ),
      ),
    ),
  );
};

export { trueRank, spectatorMarks, spectatorScreen };
