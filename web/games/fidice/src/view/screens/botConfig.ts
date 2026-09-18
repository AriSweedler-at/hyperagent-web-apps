// The bot configuration screen (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html
// lines 3377-3475 (bundle section "// src/view/screens/botConfig.ts"); every id, class, tooltip
// and text is the bundle's. It edits one choice: the solo form's strategy, or a seated bot's. A
// quick pick of the three difficulties, a card per shipped strategy, the self-taught learner with
// its generations, and the random draw.
import { CHECKPOINTS } from '../../bots/strategies/learnerWeights.ts';
import {
  DIFFICULTIES,
  RANDOM_STRATEGY,
  SHIPPED,
  choiceLabel,
  difficultyOfChoice,
  learnerGeneration,
} from '../../bots/registry.ts';
import type { ConfigTarget, Dispatch, Ui } from '../types.ts';
import { cls, h, type Child, type VNode } from '../vdom.ts';

const currentChoice = (ui: Ui, target: ConfigTarget): string => {
  if (target.kind === 'solo') return ui.nameForm.botChoice;
  const bot = ui.game?.players[target.seat]?.bot;
  return !bot ? RANDOM_STRATEGY : bot.random ? RANDOM_STRATEGY : bot.strategy;
};

const title = (ui: Ui, target: ConfigTarget): Readonly<{ head: string; sub: string }> =>
  target.kind === 'solo'
    ? {
        head: 'Configure the computers',
        sub: 'Both computers at your table will play this. You can still change either one in the lobby.',
      }
    : {
        // The bundle read `ui.game.players` outright; a seat target only exists with a game, so
        // the optional chain changes nothing reachable.
        head: `Configure ${ui.game?.players[target.seat]?.name ?? 'the computer'}`,
        sub: 'Only this seat changes. Everyone in the lobby sees the new strategy.',
      };

const quickPick = (choice: string, dispatch: Dispatch): VNode => {
  const on = difficultyOfChoice(choice);
  return h(
    'div',
    { class: 'cfg-section' },
    h('h3', {}, 'Quick pick'),
    h(
      'div',
      { class: 'seg', attrs: { role: 'radiogroup' } },
      DIFFICULTIES.map((d) =>
        h(
          'button',
          {
            id: `cfg-${d.id}`,
            class: cls('seg-btn', d.id === on && 'on'),
            tip: d.blurb,
            attrs: { role: 'radio', 'aria-checked': String(d.id === on) },
            on: {
              click: () => {
                dispatch({ type: 'config.pick', choice: d.strategy.id });
              },
            },
          },
          d.label,
        ),
      ),
    ),
    h(
      'div',
      { class: 'small muted' },
      on
        ? (DIFFICULTIES.find((d) => d.id === on)?.blurb ?? '')
        : 'A custom choice is selected below.',
    ),
  );
};

const card = (
  id: string,
  selected: boolean,
  onPick: () => void,
  ...children: ReadonlyArray<Child>
): VNode =>
  h(
    'button',
    {
      id,
      class: cls('cfg-card', selected && 'on'),
      attrs: { 'aria-pressed': String(selected) },
      on: { click: onPick },
    },
    ...children,
  );

const learnerCard = (choice: string, dispatch: Dispatch): VNode => {
  const gens = CHECKPOINTS.map((c) => c.generation);
  const picked = learnerGeneration(choice);
  const selected = picked !== null;
  const shown = picked ?? gens[gens.length - 1] ?? 0;
  const cp = CHECKPOINTS.find((c) => c.generation === shown);
  return h(
    'div',
    {
      id: 'cfg-learner',
      class: cls('cfg-card', 'cfg-learner', selected && 'on'),
      attrs: { 'aria-pressed': String(selected) },
      on: {
        click: () => {
          dispatch({ type: 'config.pick', choice: `learner-${String(shown)}` });
        },
      },
    },
    h('div', { class: 'cfg-name' }, '\u{1F9E0} Self-taught'),
    h(
      'div',
      { class: 'cfg-blurb' },
      'Learned by playing: a genetic algorithm bred it against the other computers and against itself. Nothing was written down for it — more generations, more cunning.',
    ),
    gens.length > 0 &&
      h(
        'div',
        { class: 'cfg-gens', attrs: { role: 'radiogroup', 'aria-label': 'Generations' } },
        h('span', { class: 'small muted' }, 'Generations'),
        h(
          'div',
          { class: 'seg' },
          gens.map((g) =>
            h(
              'button',
              {
                id: `cfg-learner-${String(g)}`,
                class: cls('seg-btn', g === shown && 'on'),
                attrs: { role: 'radio', 'aria-checked': String(g === shown) },
                on: {
                  click: (e) => {
                    e.stopPropagation();
                    dispatch({ type: 'config.pick', choice: `learner-${String(g)}` });
                  },
                },
              },
              String(g),
            ),
          ),
        ),
      ),
    cp &&
      h(
        'div',
        { class: 'small muted' },
        `Won ${(cp.fitness * 100).toFixed(0)}% of its training games at generation ${String(cp.generation)}.`,
      ),
    gens.length === 0 &&
      h('div', { class: 'small muted' }, 'No trained checkpoints in this build.'),
  );
};

const strategyCards = (choice: string, dispatch: Dispatch): VNode =>
  h(
    'div',
    { class: 'cfg-section' },
    h('h3', {}, 'Strategy'),
    h(
      'div',
      { class: 'cfg-grid' },
      SHIPPED.map((s) =>
        card(
          `cfg-${s.id}`,
          choice === s.id,
          () => {
            dispatch({ type: 'config.pick', choice: s.id });
          },
          h('div', { class: 'cfg-name' }, s.name),
          h('div', { class: 'cfg-blurb' }, s.blurb),
          difficultyOfChoice(s.id) !== null &&
            h(
              'div',
              { class: 'cfg-tag' },
              DIFFICULTIES.find((d) => d.strategy.id === s.id)?.label ?? '',
            ),
        ),
      ),
      learnerCard(choice, dispatch),
      card(
        `cfg-${RANDOM_STRATEGY}`,
        choice === RANDOM_STRATEGY,
        () => {
          dispatch({ type: 'config.pick', choice: RANDOM_STRATEGY });
        },
        h('div', { class: 'cfg-name' }, '\u{1F3B2} Random'),
        h(
          'div',
          { class: 'cfg-blurb' },
          'Draws one of the three hand-written strategies when the computer sits down. The lobby shows which.',
        ),
      ),
    ),
  );

const configScreen = (ui: Ui, target: ConfigTarget, dispatch: Dispatch): VNode => {
  const choice = currentChoice(ui, target);
  const { head, sub } = title(ui, target);
  return h(
    'div',
    { class: 'stack cfg', id: 'screen-config' },
    h(
      'div',
      { class: 'panel' },
      h(
        'div',
        { class: 'row' },
        h(
          'div',
          {},
          h('h2', { style: 'font-size:26px;color:var(--pine)' }, head),
          h('p', { class: 'muted', style: 'margin:4px 0 0' }, sub),
        ),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn-primary',
            id: 'btnConfigDone',
            on: {
              click: () => {
                dispatch({ type: 'config.close' });
              },
            },
          },
          'Done',
        ),
      ),
      h(
        'div',
        { class: 'cfg-current', id: 'cfgCurrent' },
        'Playing: ',
        h('b', {}, choiceLabel(choice)),
      ),
      quickPick(choice, dispatch),
      strategyCards(choice, dispatch),
    ),
  );
};

export { currentChoice, configScreen };
