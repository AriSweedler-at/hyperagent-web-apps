// The table (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html lines 2793-3077
// (bundle section "// src/view/screens/table.ts"); every id, class, tooltip and text is the
// bundle's. The turn bar and bid card; the public dice and the cup; for the holder, the numbered
// steps (call or accept, shuffle, bid with the fuzzy picker); the reveal with its countdown; the
// game-over card and scoreboard; and the pass-the-phone cover and confirm screens.
import { keepsScore, standings } from '../../domain/game.ts';
import { HAND_COUNT, TOP_RANK, asRank, handAt, rungOf, spokenName } from '../../domain/hands.ts';
import { publicCupIndices, publicTableIndices } from '../../domain/publicState.ts';
import { suggestHands } from '../../domain/search.ts';
import type { PublicRound, PublicState, Rank, Seat } from '../../domain/types.ts';
import { diceRow, die, logView, seatOptions, seats, stepHeader } from '../components.ts';
import type { Dispatch, Ui } from '../types.ts';
import { isHostUi, isMyTurn } from '../ui.ts';
import { cls, h, targetChecked, targetValue, type VNode } from '../vdom.ts';

const nameAt = (g: PublicState, i: Seat | null): string =>
  i === null ? '?' : (g.players[i]?.name ?? '?');

const turnBar = (ui: Ui, g: PublicState, r: PublicRound): VNode => {
  const mine = isMyTurn(ui);
  const holder = nameAt(g, r.holder);
  const text = g.reveal
    ? 'Round over — see the reveal below'
    : mine
      ? r.bid === null
        ? '\u{1F964} Your turn — you open the round. Look, shuffle, then bid.'
        : `\u{1F964} Your turn — ${nameAt(g, r.bidder)} bid ${spokenName(r.bid)}. Call it, or beat it.`
      : `${holder} has the cup${r.bid !== null ? ` \xB7 facing ${spokenName(r.bid)}` : ''}…`;
  return h('div', { class: cls('turnbar', !mine && 'wait') }, text);
};

const bidCard = (g: PublicState, r: PublicRound): VNode =>
  r.bid === null
    ? h(
        'div',
        { class: 'bidcard' },
        h(
          'div',
          {},
          h('div', { class: 'lbl' }, 'Current bid'),
          h('div', { class: 'val muted' }, 'None yet'),
          h('div', { class: 'who' }, 'The opener may bid anything.'),
        ),
      )
    : h(
        'div',
        { class: 'bidcard' },
        h(
          'div',
          {},
          h('div', { class: 'lbl' }, 'Current bid'),
          h('div', { class: 'val' }, spokenName(r.bid)),
          h(
            'div',
            { class: 'who' },
            `by ${nameAt(g, r.bidder)} \xB7 rung ${String(rungOf(r.bid))} of ${String(HAND_COUNT)}`,
          ),
        ),
        diceRow(handAt(r.bid).dice, 'sm'),
      );

const tableZone = (ui: Ui, r: PublicRound, dispatch: Dispatch): VNode => {
  const mine = isMyTurn(ui);
  const canPick = mine && !r.rolled && (r.bid === null || r.touched);
  const out = publicTableIndices(r);
  return h(
    'div',
    { class: 'zone', id: 'zoneTable' },
    h(
      'h3',
      {},
      'On the table ',
      h(
        'span',
        { class: 'small', style: 'text-transform:none;letter-spacing:0;opacity:.7' },
        '— everyone sees these',
      ),
    ),
    h(
      'div',
      { class: 'dice' },
      out.length === 0 && h('span', { class: 'hint' }, 'No dice out yet.'),
      out.map((i) =>
        die(r.dice[i]?.value ?? null, {
          clickable: canPick,
          selected: ui.rollSelection.has(i),
          ...(canPick
            ? {
                tip: ui.rollSelection.has(i)
                  ? 'Selected to roll — click to keep'
                  : 'Click to roll this die',
                onClick: () => {
                  dispatch({ type: 'roll.toggleDie', die: i });
                },
              }
            : {}),
        }),
      ),
    ),
  );
};

const cupZone = (ui: Ui, g: PublicState, r: PublicRound, dispatch: Dispatch): VNode => {
  const mine = isMyTurn(ui);
  const canTouch = mine && (r.bid === null || r.touched);
  const cup = publicCupIndices(r);
  const who = mine
    ? canTouch
      ? 'only you can see these'
      : 'accept the cup to peek'
    : `only ${nameAt(g, r.holder)} can see these`;
  return h(
    'div',
    { class: 'zone', id: 'zoneCup' },
    h(
      'h3',
      {},
      'Under the cup ',
      h(
        'span',
        { class: 'small', style: 'text-transform:none;letter-spacing:0;opacity:.7' },
        `— ${who}`,
      ),
    ),
    h(
      'div',
      { class: 'cup-visual' },
      h('div', { class: 'cup-icon' }, '\u{1F964}'),
      h(
        'div',
        { class: 'dice' },
        cup.length === 0 &&
          h('span', { class: 'hint' }, 'The cup is empty — every die is on the table.'),
        cup.map((i) =>
          die(r.dice[i]?.value ?? null, {
            clickable: canTouch,
            ...(canTouch
              ? {
                  tip: 'Click to pull this die out onto the table (it stays out)',
                  onClick: () => {
                    dispatch({ type: 'play', action: { type: 'pull', die: i } });
                  },
                }
              : {}),
          }),
        ),
      ),
    ),
  );
};

const decideStep = (g: PublicState, r: PublicRound, bid: Rank, dispatch: Dispatch): VNode =>
  h(
    'div',
    { class: 'step', id: 'stepDecide' },
    stepHeader(
      1,
      'Call or accept?',
      r.touched
        ? "You accepted the cup, so you're committed to raising the bid."
        : 'Decide blind: call liar and the cup is lifted now, or accept the cup and peek — then you must raise.',
    ),
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          class: 'btn-danger',
          id: 'btnCall',
          props: { disabled: r.touched },
          tip: 'If the real hand is at least the bid, YOU lose a life. Otherwise the bidder does.',
          on: {
            click: () => {
              dispatch({ type: 'play', action: { type: 'call' } });
            },
          },
        },
        `Call liar on ${nameAt(g, r.bidder)}`,
      ),
      !r.touched &&
        bid < TOP_RANK &&
        h(
          'button',
          {
            class: 'btn-primary',
            id: 'btnPeek',
            tip: 'Look under the cup. You can then pull, roll, and must bid higher.',
            on: {
              click: () => {
                dispatch({ type: 'play', action: { type: 'peek' } });
              },
            },
          },
          'Accept the cup & peek',
        ),
    ),
  );

const shuffleStep = (ui: Ui, r: PublicRound, n: number, dispatch: Dispatch): VNode => {
  const cupCount = publicCupIndices(r).length;
  const picked = ui.rollSelection.size;
  const tucking = ui.rollHidden && picked > 0;
  const pickedWord = `${String(picked)} table ${picked === 1 ? 'die' : 'dice'}`;
  const rollLabel = picked
    ? ui.rollHidden
      ? `Roll ${pickedWord} under the cup`
      : `Roll ${pickedWord}`
    : 'Roll';
  const shaken = cupCount + (tucking ? picked : 0);
  return h(
    'div',
    { class: 'step', id: 'stepShuffle' },
    stepHeader(
      n,
      'Shuffle (optional)',
      r.rolled
        ? 'You already rolled this turn. You can still pull dice out.'
        : 'Pull dice out by clicking them under the cup. Then roll: tick table dice above and/or shake the whole cup. Table dice can also go back under the cup so their roll stays secret. One roll per turn.',
    ),
    !r.rolled &&
      h(
        'div',
        { class: 'row' },
        h(
          'label',
          {
            class: 'toggle',
            tip: tucking
              ? 'Dice going back under the cup mean the whole cup gets shaken.'
              : 'Re-rolls every die still under the cup. You lose the hand you know.',
          },
          h('input', {
            id: 'rollCupCb',
            attrs: { type: 'checkbox' },
            props: {
              checked: ui.rollCup || tucking,
              disabled: tucking || (cupCount === 0 && !tucking),
            },
            on: {
              change: (e) => {
                dispatch({ type: 'roll.cup', on: targetChecked(e) });
              },
            },
          }),
          ` Shake the cup (${String(shaken)} ${shaken === 1 ? 'die' : 'dice'})`,
        ),
        picked > 0 &&
          h(
            'label',
            {
              class: 'toggle',
              tip: 'The selected table dice go back under the cup and the whole cup is shaken — nobody sees what comes up.',
            },
            h('input', {
              id: 'rollHiddenCb',
              attrs: { type: 'checkbox' },
              props: { checked: ui.rollHidden },
              on: {
                change: (e) => {
                  dispatch({ type: 'roll.hidden', on: targetChecked(e) });
                },
              },
            }),
            ' Roll them back under the cup',
          ),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn-secondary',
            id: 'btnRoll',
            tip: 'Rolls the selected table dice and, if ticked, the cup.',
            on: {
              click: () => {
                dispatch({ type: 'roll.go' });
              },
            },
          },
          rollLabel,
        ),
      ),
  );
};

const bidPicker = (ui: Ui, current: Rank | null, dispatch: Dispatch): VNode => {
  const suggestions = suggestHands(ui.picker.query, current);
  const selected = ui.picker.selected === null ? null : handAt(ui.picker.selected);
  // One rung up is a rank whenever the picker shows: it is drawn only below the top of the ladder.
  const up = current === null ? null : asRank(current + 1);
  return h(
    'div',
    { class: 'bidpick' },
    h(
      'div',
      { class: 'bidsearch' },
      h('input', {
        id: 'bidSearch',
        attrs: {
          type: 'text',
          autocomplete: 'off',
          placeholder: 'Type a hand… e.g. "3s over 2", "4s and 1s", "four 6s", or a rung number',
        },
        tip: 'Fuzzy search. Pick a hand group to bid its top variant, or name the exact kickers.',
        props: { value: ui.picker.query },
        on: {
          input: (e) => {
            dispatch({ type: 'picker.query', value: targetValue(e) });
          },
          focus: () => {
            dispatch({ type: 'picker.focus' });
          },
          keydown: (e) => {
            const k = e.key;
            if (k === 'ArrowDown') {
              e.preventDefault();
              dispatch({ type: 'picker.move', delta: 1 });
            } else if (k === 'ArrowUp') {
              e.preventDefault();
              dispatch({ type: 'picker.move', delta: -1 });
            } else if (k === 'Enter') {
              e.preventDefault();
              dispatch({ type: 'picker.enter' });
            } else if (k === 'Escape') dispatch({ type: 'picker.close' });
          },
        },
      }),
      ui.picker.listOpen &&
        suggestions.length > 0 &&
        h(
          'div',
          { class: 'bidlist', id: 'bidList' },
          suggestions.map((s, i) =>
            h(
              'div',
              {
                class: cls('bidopt', i === ui.picker.highlight && 'hi'),
                key: `${s.group ? 'g' : 'h'}${String(s.rank)}`,
                on: {
                  mousedown: (e) => {
                    e.preventDefault();
                    dispatch({ type: 'picker.choose', rank: s.rank });
                  },
                },
              },
              h(
                'div',
                {},
                h(
                  'div',
                  { class: 'nm' },
                  s.label,
                  s.group && h('span', { class: 'tag-g' }, 'group'),
                ),
                h(
                  'div',
                  { class: 'sub' },
                  s.group
                    ? `${String(s.variants)} variants \xB7 bids the top one: ${handAt(s.rank).variant} \xB7 rung ${String(rungOf(s.rank))}`
                    : `rung ${String(rungOf(s.rank))} \xB7 ${handAt(s.rank).catLabel}`,
                ),
              ),
              diceRow(handAt(s.rank).dice, 'xs'),
            ),
          ),
        ),
    ),
    h(
      'div',
      { class: 'bidsel', id: 'bidSel' },
      selected
        ? [
            h(
              'div',
              {},
              h('div', { class: 'lbl' }, "You're bidding"),
              h('div', { class: 'val' }, spokenName(selected.rank)),
              h(
                'div',
                { class: 'who' },
                `rung ${String(rungOf(selected.rank))} of ${String(HAND_COUNT)} \xB7 ${selected.catLabel}`,
              ),
            ),
            diceRow(selected.dice, 'sm'),
          ]
        : h(
            'span',
            { class: 'muted small' },
            'Pick a hand above — a group bids its top variant, or name the exact kickers.',
          ),
    ),
    h(
      'div',
      { class: 'row' },
      up !== null &&
        h(
          'button',
          {
            class: 'btn-secondary',
            id: 'btnMinRaise',
            tip: `One rung up: ${spokenName(up)}`,
            on: {
              click: () => {
                dispatch({ type: 'play', action: { type: 'bid', rank: up } });
              },
            },
          },
          'Minimum raise',
        ),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'btn-primary',
          id: 'btnPlaceBid',
          props: { disabled: selected === null },
          on: {
            click: () => {
              dispatch({ type: 'picker.place' });
            },
          },
        },
        'Place bid',
      ),
    ),
  );
};

const actions = (ui: Ui, g: PublicState, r: PublicRound, dispatch: Dispatch): VNode => {
  const facingBid = r.bid !== null;
  const maxed = r.bid !== null && r.bid >= TOP_RANK;
  const mayBid = !maxed && (r.bid === null || r.touched);
  const n = facingBid ? 2 : 1;
  return h(
    'div',
    { class: 'actions', id: 'actions' },
    r.bid !== null && decideStep(g, r, r.bid, dispatch),
    mayBid && shuffleStep(ui, r, n, dispatch),
    mayBid &&
      h(
        'div',
        { class: 'step', id: 'stepBid' },
        stepHeader(
          n + 1,
          'Bid',
          "Type to find a hand — a group like 3s full or 4s and 1s bids its top variant; add kickers (3s over 2, four 6s with a 2) or a rung number to be exact. It doesn't have to be true.",
        ),
        bidPicker(ui, r.bid, dispatch),
      ),
    maxed &&
      h(
        'div',
        { class: 'step' },
        stepHeader(
          2,
          'Nothing beats Five 6s',
          'The ladder is maxed out — your only move is to call.',
        ),
      ),
  );
};

const revealCard = (ui: Ui, g: PublicState, dispatch: Dispatch): VNode | null => {
  const v = g.reveal;
  if (!v) return null;
  const meLost = v.loser === ui.mySeat;
  const secondsLeft =
    g.autoNextAt === null ? null : Math.max(0, Math.ceil((g.autoNextAt - ui.now) / 1e3));
  return h(
    'div',
    { class: 'reveal', id: 'reveal' },
    h(
      'div',
      { class: 'small muted', style: 'font-weight:800;letter-spacing:1px' },
      'THE CUP IS LIFTED',
    ),
    diceRow(v.dice),
    h(
      'div',
      { class: 'bigval' },
      h('b', {}, handAt(v.real).name),
      h('span', { class: 'muted' }, ' vs bid '),
      h('b', {}, spokenName(v.bid)),
    ),
    h(
      'div',
      { class: cls('res', meLost ? 'bad' : 'good') },
      `${v.holds ? `The bid holds — ${nameAt(g, v.caller)}` : `Busted! ${nameAt(g, v.bidder)}`} ${keepsScore(g) ? 'loses the round' : 'loses a life'}`,
    ),
    g.phase === 'playing' &&
      secondsLeft !== null &&
      h('div', { class: 'small muted' }, `Next round starts in ${String(secondsLeft)}s…`),
    g.phase === 'playing' &&
      h(
        'button',
        {
          class: 'btn-go btn-big',
          id: 'btnNext',
          on: {
            click: () => {
              dispatch({ type: 'play', action: { type: 'next' } });
            },
          },
        },
        'Next round',
      ),
  );
};

const scoreboard = (g: PublicState): VNode =>
  h(
    'div',
    { class: 'scoreboard', id: 'scoreboard' },
    standings(g).map((i, k) =>
      h(
        'div',
        { class: cls('score-row', k === 0 && 'top') },
        h('span', { class: 'place' }, k === 0 ? '\u{1F3C6}' : String(k + 1)),
        h('span', { class: 'who' }, nameAt(g, i)),
        h('span', { class: 'spacer' }),
        h('span', { class: 'n' }, `${String(g.players[i]?.losses ?? 0)} lost`),
      ),
    ),
  );

const gameOver = (ui: Ui, g: PublicState, dispatch: Dispatch): VNode =>
  h(
    'div',
    { class: 'reveal' },
    h('div', { style: 'font-size:48px' }, '\u{1F3C6}'),
    h(
      'div',
      { class: 'res good' },
      g.winner === null
        ? keepsScore(g)
          ? 'A tie at the top!'
          : 'Nobody wins!'
        : `${nameAt(g, g.winner)} wins!`,
    ),
    keepsScore(g) ? scoreboard(g) : h('div', { class: 'muted' }, 'Last kayak on the lake.'),
    h('div', { class: 'muted' }, 'Leave the table to start a new game.'),
    !keepsScore(g) && revealCard(ui, g, dispatch),
  );

const tableView = (ui: Ui, g: PublicState, dispatch: Dispatch): VNode => {
  const r = g.round;
  if (!r) return h('div', { class: 'table' });
  if (g.phase === 'over')
    return h('div', { class: 'table', id: 'tableEl' }, gameOver(ui, g, dispatch));
  return h(
    'div',
    { class: 'table', id: 'tableEl' },
    turnBar(ui, g, r),
    bidCard(g, r),
    g.reveal
      ? revealCard(ui, g, dispatch)
      : [
          tableZone(ui, r, dispatch),
          cupZone(ui, g, r, dispatch),
          isMyTurn(ui) && actions(ui, g, r, dispatch),
        ],
  );
};

const handoffScreen = (ui: Ui, g: PublicState, dispatch: Dispatch): VNode => {
  const who = ui.handoff ? nameAt(g, ui.handoff.seat) : '?';
  const stage = ui.handoff?.stage ?? 'cover';
  return h(
    'div',
    { id: 'screen-game' },
    stage === 'cover'
      ? h(
          'div',
          {
            class: 'handoff cover',
            id: 'handoffCover',
            attrs: { role: 'button', tabindex: '0' },
            on: {
              click: () => {
                dispatch({ type: 'handoff.tap' });
              },
            },
          },
          h('div', { class: 'hand' }, '\u{1F4F1}'),
          h('div', { class: 'big' }, `Pass the phone to ${who}`),
          h('div', { class: 'sub' }, `${who}: tap anywhere once it's in your hands.`),
        )
      : h(
          'div',
          { class: 'handoff confirm', id: 'handoffConfirmWrap' },
          h('div', { class: 'sub' }, `Only ${who} should see the next screen.`),
          h(
            'button',
            {
              class: 'btn-primary',
              id: 'handoffConfirm',
              on: {
                click: () => {
                  dispatch({ type: 'handoff.confirm' });
                },
              },
            },
            `I'm ${who} — show my turn`,
          ),
          h(
            'div',
            { class: 'small', style: 'opacity:.75' },
            'Not you? Do nothing — the cover comes back by itself.',
          ),
        ),
  );
};

const gameScreen = (ui: Ui, g: PublicState, dispatch: Dispatch): VNode =>
  ui.handoff
    ? handoffScreen(ui, g, dispatch)
    : h(
        'div',
        { id: 'screen-game' },
        h(
          'div',
          { class: 'game' },
          h(
            'div',
            { class: 'stack' },
            seats(g, seatOptions(ui, dispatch), false),
            tableView(ui, g, dispatch),
          ),
          h(
            'div',
            { class: 'side' },
            h(
              'div',
              { class: 'panel', style: 'padding:14px 16px' },
              h(
                'div',
                { class: 'row' },
                h('b', {}, `Round ${String(g.roundNo)}`),
                h('span', { class: 'spacer' }),
                h(
                  'button',
                  {
                    class: 'btn-ghost small',
                    tip: 'Jump to the ladder with the current bid highlighted',
                    on: {
                      click: () => {
                        dispatch({ type: 'ladder.showBid' });
                      },
                    },
                  },
                  'See on ladder →',
                ),
              ),
            ),
            h(
              'h3',
              {
                class: 'muted',
                style:
                  'font-family:Nunito;font-size:13px;letter-spacing:1px;text-transform:uppercase',
              },
              'Table talk',
            ),
            logView(g.log, 'log'),
            keepsScore(g) &&
              g.phase === 'playing' &&
              isHostUi(ui) &&
              h(
                'button',
                {
                  class: 'btn-secondary',
                  id: 'btnFinish',
                  tip: 'End the game now and show the standings (fewest rounds lost wins)',
                  on: {
                    click: () => {
                      dispatch({ type: 'play', action: { type: 'finish' } });
                    },
                  },
                },
                '\u{1F3C1} Finish & show scores',
              ),
            h(
              'button',
              {
                class: 'btn-ghost',
                id: 'btnLeaveGame',
                on: {
                  click: () => {
                    dispatch({ type: 'leave' });
                  },
                },
              },
              'Leave table',
            ),
          ),
        ),
      );

export { nameAt, tableView, handoffScreen, gameScreen };
