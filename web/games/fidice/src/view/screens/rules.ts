// The rules tab (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html lines 3297-3374
// (bundle section "// src/view/screens/rules.ts"); the prose is the bundle's, word for word. Static
// apart from the strategy list, which reads the shipped bots' names and blurbs from the registry.
import { SHIPPED } from '../../bots/registry.ts';
import { h, type Child, type VNode } from '../vdom.ts';

const panel = (...children: ReadonlyArray<Child>): VNode =>
  h('div', { class: 'panel' }, ...children);
const li = (...children: ReadonlyArray<Child>): VNode => h('li', {}, ...children);
const b = (t: string): VNode => h('b', {}, t);
const i = (t: string): VNode => h('i', {}, t);

const rulesTab = (): VNode =>
  h(
    'section',
    { id: 'tab-rules' },
    h(
      'div',
      { class: 'rules' },
      panel(
        h(
          'h2',
          {},
          'How to play Fidice ',
          h(
            'span',
            {
              style:
                "font-family:'Caveat',cursive;font-size:22px;color:var(--lake-deep);font-weight:700",
            },
            '— Crowe house rules',
          ),
        ),
        h(
          'p',
          {},
          'Fidice is ',
          b("one-cup liar's dice"),
          '. Five dice live under a single cup that travels around the table. Whoever holds the cup declares a hand from ',
          b('the ladder'),
          ' — truthfully or not — and passes it on. The next player either ',
          b('raises'),
          ' the claim or ',
          b('calls liar'),
          '. Lose a call, lose a life. Last one standing wins.',
        ),
      ),
      panel(
        h('h3', {}, 'Setup'),
        h(
          'ul',
          {},
          li('2 to 6 players. Each starts with the same number of ', b('lives'), ' (default 3).'),
          li('All five dice start under the cup. The app rolls them for whoever begins the round.'),
          li(
            "Only the current cup holder can see what's under the cup. Dice that have been pulled ",
            b('out'),
            ' from under the cup sit on the table where everyone can see them.',
          ),
        ),
      ),
      panel(
        h('h3', {}, 'Your turn'),
        h(
          'ol',
          { class: 'steps' },
          li(
            b('Decide blind: call or accept.'),
            " If there's a bid on the table you may ",
            b('call liar'),
            ' right away — without looking. Or ',
            b('accept the cup'),
            ', which commits you to raising the bid.',
          ),
          li(b('Peek.'), " Once you've accepted, you alone see the dice under the cup."),
          li(
            b('Pull dice out.'),
            ' Slide any dice from under the cup onto the table. Once out, a die is public and stays out for the rest of the round.',
          ),
          li(
            b('Roll (once).'),
            ' You may roll ',
            b('all'),
            ' the dice still under the cup, and/or any set of the dice on the table — none, some, or all. Rolls on the table are public; the cup roll is your secret. You may also put table dice ',
            b('back under the cup'),
            ' — the whole cup is then shaken, tucked dice and all, so nobody learns what came up.',
          ),
          li(
            b('Bid.'),
            ' Pick any hand from the ladder that is ',
            b('higher'),
            ' than the current bid. Your bid does not have to be true! Then the cup passes left.',
          ),
        ),
      ),
      panel(
        h('h3', {}, 'Calling liar'),
        h(
          'p',
          {},
          'When you call, the cup is lifted and all five dice (under the cup plus the ones on the table) are read as one poker hand.',
        ),
        h(
          'ul',
          {},
          li(
            'If the real hand is ',
            b('equal to or better than'),
            ' the bid, the bid was honest — the ',
            b('caller'),
            ' loses a life.',
          ),
          li(
            'If the real hand is ',
            b('worse'),
            ' than the bid, the ',
            b('bidder'),
            ' loses a life.',
          ),
          li(
            'By default the table ',
            b('keeps score'),
            ": nobody is ever out, the loser of a round simply gets a mark, and the host ends the game whenever the evening does — fewest rounds lost wins. Prefer stakes? Set kayaks when you create the table: lose a call, lose a kayak; at zero you're out and the last one standing wins.",
          ),
          li('Whoever lost the round starts the next one with a fresh roll under the cup.'),
        ),
        h(
          'div',
          { class: 'ex' },
          b('Example.'),
          ' Andy opens with ',
          i('Three 4s with 6, 1'),
          ' and passes the cup. Tyler accepts, pulls a 6 out onto the table, shakes the cup, and raises to ',
          i('Three 5s with 6, 2'),
          '. Stephen calls liar. The cup is lifted: 5-5-5-6-1 — the real hand is ',
          i('Three 5s with 6, 1'),
          ', one rung ',
          b('below'),
          " Tyler's bid, so Tyler was bluffing and Tyler loses a life. Had Stephen simply raised instead, the bluff would have travelled on to Andy.",
        ),
      ),
      panel(
        h('h3', {}, 'The ladder (hand rankings)'),
        h(
          'p',
          {},
          'Five of a kind → Four of a kind → Full house → Straight → Three of a kind → Two pair → One pair → High die. Within a category, higher numbers win first, then kickers (the leftover dice) compared highest-first. There are exactly 252 distinct hands. If someone bids the very top (',
          i('Five 6s'),
          '), the next player can only call.',
        ),
        h(
          'p',
          {},
          "The Ladder tab is nested: fully collapsed it's just the eight poker hands. Open a category to see each hand (",
          i('Four 6s'),
          ', ',
          i('6s full'),
          ', ',
          i('Pair of 3s'),
          '…), and open a hand to see its exact variants — the kickers, or for a full house the pair. The bid box is a fuzzy search: type ',
          i('3s full'),
          ', ',
          i('4s and 1s'),
          ' or ',
          i('four 6s'),
          ' and pick the group to bid its top variant, or be exact with ',
          i('3s over 2'),
          ', ',
          i('three 4s with 6, 1'),
          ', or a rung number.',
        ),
      ),
      panel(
        h('h3', {}, 'Good to know'),
        h(
          'ul',
          {},
          li(
            "Pulling a die out is a promise you can't take back — and it tells the table something. Rolling it afterwards tells them something else.",
          ),
          li(
            "Rolling the cup dice throws away the hand you know for one you don't. Sometimes that's exactly the point.",
          ),
          li(
            'The ',
            b('spectator link'),
            ' shows the ladder with the bid tracked live, and an optional "true hand" reveal. Players should never look at it.',
          ),
          li(
            b('Computer players'),
            ' can fill any seat: add them in the lobby, or use ',
            i('Play the computers'),
            ' / ',
            i('Watch the computers'),
            ' from the menu. Each plays one of three strategies (pick one, or let it draw at random) — ',
            ...SHIPPED.flatMap((s, k): ReadonlyArray<Child> => [
              k > 0 ? '; ' : '',
              b(s.name),
              `: ${s.blurb.replace(/\.$/, '')}`,
            ]),
            '. They see exactly what a person in their chair would see, and they read the table the way a person does: how far each raise leapt, whether the cup has been shaken since the bidder looked, who has been caught before.',
          ),
          li(
            "The game runs in the host's browser. If the host closes their tab, the table closes with it.",
          ),
          li('House rules from the Crowe house on Kezar Lake, Maine.'),
        ),
      ),
    ),
  );

export { rulesTab };
