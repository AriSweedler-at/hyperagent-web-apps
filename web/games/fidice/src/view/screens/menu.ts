// The menu and the name form (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html lines
// 2541-2682 (bundle section "// src/view/screens/menu.ts"); every id, class, tooltip and text is
// the bundle's. The name screen adapts to what the menu picked (`ui.pending`): a join code field,
// the pass-the-phone player list or the difficulty picker, and the scoring select for all but join.
import {
  DIFFICULTIES,
  choiceLabel,
  difficultyById,
  difficultyOfChoice,
} from '../../bots/registry.ts';
import { die } from '../components.ts';
import type { Dispatch, Ui } from '../types.ts';
import { cls, h, targetValue, type VNode } from '../vdom.ts';

const onEnter =
  (fn: () => void) =>
  (e: Readonly<KeyboardEvent>): void => {
    if (e.key === 'Enter') fn();
  };

const option = (
  id: string,
  icon: string,
  title: string,
  sub: string,
  tip: string,
  primary: boolean,
  onPick: () => void,
): VNode =>
  h(
    'button',
    { id, class: cls('opt', primary && 'primary'), tip, on: { click: onPick } },
    h('span', { class: 'opt-ic', attrs: { 'aria-hidden': 'true' } }, icon),
    h(
      'span',
      { class: 'opt-text' },
      h('span', { class: 'opt-t' }, title),
      h('span', { class: 'opt-s' }, sub),
    ),
    h('span', { class: 'opt-go', attrs: { 'aria-hidden': 'true' } }, '›'),
  );

const menuScreen = (_ui: Ui, dispatch: Dispatch): VNode =>
  h(
    'div',
    { class: 'menu', id: 'screen-menu' },
    h(
      'div',
      { class: 'dice-hero' },
      ([6, 6, 6, 5, 2] as const).map((v) => die(v, { size: 'sm' })),
    ),
    h('h1', {}, 'Fidice'),
    h('div', { class: 'where' }, 'Kezar Lake, Maine'),
    h('div', { class: 'tag' }, "One cup. Five dice. Don't get caught."),
    h(
      'div',
      { class: 'menu-options' },
      option(
        'btnLocal',
        '\u{1F4F1}',
        'Pass the phone',
        'Everyone on this device — it covers itself between turns',
        'Two to six people, one screen',
        true,
        () => {
          dispatch({ type: 'menu.local' });
        },
      ),
      option(
        'btnCreate',
        '\u{1F310}',
        'Host online',
        'Start a table and share a link with friends',
        'Friends join from their own phones',
        false,
        () => {
          dispatch({ type: 'menu.create' });
        },
      ),
      option(
        'btnJoin',
        '\u{1F511}',
        'Join with a code',
        "Type the host's five-letter code",
        "Sit down at a friend's table",
        false,
        () => {
          dispatch({ type: 'menu.join' });
        },
      ),
      option(
        'btnSolo',
        '\u{1F916}',
        'Play the computers',
        'You against two — Easy, Medium, Hard or your own mix',
        'Solo practice',
        false,
        () => {
          dispatch({ type: 'menu.solo' });
        },
      ),
      option(
        'btnWatchBots',
        '\u{1F37F}',
        'Watch the computers',
        'Four computers play; you watch the ladder',
        'Learn the game by watching',
        false,
        () => {
          dispatch({ type: 'menu.watchBots' });
        },
      ),
    ),
    h(
      'div',
      { class: 'links', style: 'margin-top:14px' },
      h(
        'button',
        {
          on: {
            click: () => {
              dispatch({ type: 'nav', tab: 'ladder' });
            },
          },
        },
        '\u{1F4DC} See the ladder',
      ),
      h(
        'button',
        {
          on: {
            click: () => {
              dispatch({ type: 'nav', tab: 'rules' });
            },
          },
        },
        '\u{1F4D6} Read the rules',
      ),
    ),
    h(
      'p',
      { class: 'small muted', style: 'margin-top:14px' },
      'Everything is in your browser — no accounts, no downloads.',
    ),
  );

const joinField = (ui: Ui, dispatch: Dispatch): VNode =>
  h(
    'div',
    { class: 'join', style: 'justify-content:center' },
    h('input', {
      id: 'joinCode',
      tip: "Ask the host for their 5-letter code — it's on their lobby screen",
      attrs: {
        maxlength: '5',
        placeholder: 'CODE',
        autocomplete: 'off',
        autocapitalize: 'characters',
      },
      props: { value: ui.joinCode },
      on: {
        input: (e) => {
          dispatch({ type: 'form.code', value: targetValue(e) });
        },
        keydown: onEnter(() => {
          dispatch({ type: 'form.submit' });
        }),
      },
    }),
  );

const titleFor = (ui: Ui): Readonly<{ title: string; sub: string }> => {
  const kind = ui.pending?.kind;
  if (kind === 'solo')
    return {
      title: 'You vs the computers',
      sub: 'Two computers will sit down with you. Add more, rename them or change their strategy in the lobby.',
    };
  if (kind === 'local')
    return { title: 'Pass the phone', sub: "Everyone plays on this device. Who's at the table?" };
  if (kind === 'join')
    return ui.joinCode.length === 5
      ? { title: `Joining ${ui.joinCode}`, sub: 'Your friends will see this name at the table.' }
      : {
          title: 'Join with a code',
          sub: "Enter the host's code and the name your friends will see.",
        };
  return {
    title: 'Host a table online',
    sub: 'Pick a name and how the table scores; then share the link.',
  };
};

const difficultyPicker = (ui: Ui, dispatch: Dispatch): VNode => {
  const choice = ui.nameForm.botChoice;
  const on = difficultyOfChoice(choice);
  const blurb = on ? difficultyById(on).blurb : `Custom: ${choiceLabel(choice)}`;
  return h(
    'div',
    { class: 'difficulty', id: 'difficulty' },
    h('label', {}, 'How good are the computers?'),
    h(
      'div',
      { class: 'row', style: 'gap:8px;justify-content:center' },
      h(
        'div',
        { class: 'seg', attrs: { role: 'radiogroup' } },
        DIFFICULTIES.map((d) =>
          h(
            'button',
            {
              id: `difficulty-${d.id}`,
              class: cls('seg-btn', d.id === on && 'on'),
              tip: d.blurb,
              attrs: { role: 'radio', 'aria-checked': String(d.id === on) },
              on: {
                click: () => {
                  dispatch({ type: 'form.difficulty', value: d.id });
                },
              },
            },
            d.label,
          ),
        ),
      ),
      h(
        'button',
        {
          class: 'btn-secondary',
          id: 'btnConfigSolo',
          tip: 'Pick an exact strategy, or the self-taught computer and how long it trained',
          on: {
            click: () => {
              dispatch({ type: 'config.open', target: { kind: 'solo' } });
            },
          },
        },
        '⚙ Settings',
      ),
    ),
    h('div', { class: 'small muted', id: 'difficultyBlurb' }, blurb),
  );
};

const localPlayers = (ui: Ui, dispatch: Dispatch): VNode =>
  h(
    'div',
    { class: 'locals', id: 'locals' },
    ui.nameForm.locals.map((name, i) =>
      h(
        'div',
        { class: 'row', key: `l${String(i)}`, style: 'gap:6px' },
        h('input', {
          id: `localName-${String(i)}`,
          attrs: { maxlength: '16', placeholder: `Player ${String(i + 2)}`, autocomplete: 'off' },
          props: { value: name },
          on: {
            input: (e) => {
              dispatch({ type: 'form.local.set', index: i, value: targetValue(e) });
            },
            keydown: onEnter(() => {
              dispatch({ type: 'form.submit' });
            }),
          },
        }),
        ui.nameForm.locals.length > 1 &&
          h(
            'button',
            {
              class: 'btn-ghost small',
              tip: 'Remove this player',
              on: {
                click: () => {
                  dispatch({ type: 'form.local.remove', index: i });
                },
              },
            },
            '✕',
          ),
      ),
    ),
    ui.nameForm.locals.length < 5 &&
      h(
        'button',
        {
          class: 'btn-ghost',
          id: 'btnAddLocal',
          on: {
            click: () => {
              dispatch({ type: 'form.local.add' });
            },
          },
        },
        '+ Add a player',
      ),
  );

const nameScreen = (ui: Ui, dispatch: Dispatch): VNode => {
  const { title, sub } = titleFor(ui);
  const showLives = ui.pending?.kind !== 'join';
  return h(
    'div',
    { class: 'menu', id: 'screen-name' },
    h('h2', { style: 'font-size:30px;color:var(--pine)' }, title),
    h('p', { class: 'muted' }, sub),
    h(
      'div',
      { class: 'stack', style: 'margin-top:14px' },
      h('input', {
        id: 'nameInput',
        attrs: { maxlength: '16', placeholder: 'Your name (e.g. Andy)', autocomplete: 'off' },
        props: { value: ui.nameForm.name },
        on: {
          input: (e) => {
            dispatch({ type: 'form.name', value: targetValue(e) });
          },
          keydown: onEnter(() => {
            dispatch({ type: 'form.submit' });
          }),
        },
      }),
      ui.pending?.kind === 'join' && joinField(ui, dispatch),
      ui.pending?.kind === 'local' && localPlayers(ui, dispatch),
      ui.pending?.kind === 'solo' && difficultyPicker(ui, dispatch),
      showLives &&
        h(
          'div',
          { class: 'row', style: 'justify-content:center' },
          h(
            'div',
            {},
            h('label', {}, 'Scoring'),
            h(
              'select',
              {
                id: 'livesSel',
                tip: 'Keep score (every round lost is a mark; the host ends the game) — or play for kayaks, where losing a call costs one and the last player standing wins.',
                props: { value: String(ui.nameForm.lives) },
                on: {
                  change: (e) => {
                    dispatch({ type: 'form.lives', value: Number(targetValue(e)) });
                  },
                },
              },
              h(
                'option',
                { attrs: { value: '0' }, props: { selected: ui.nameForm.lives === 0 } },
                'Keep score — no kayaks',
              ),
              [1, 2, 3, 4, 5].map((n) =>
                h(
                  'option',
                  { attrs: { value: String(n) }, props: { selected: n === ui.nameForm.lives } },
                  `${String(n)} kayak${n === 1 ? '' : 's'} each`,
                ),
              ),
            ),
          ),
        ),
      h(
        'button',
        {
          class: 'btn-go btn-big',
          id: 'btnNameGo',
          on: {
            click: () => {
              dispatch({ type: 'form.submit' });
            },
          },
        },
        "Let's go",
      ),
      h(
        'button',
        {
          class: 'btn-ghost',
          id: 'btnNameBack',
          on: {
            click: () => {
              dispatch({ type: 'form.back' });
            },
          },
        },
        '← Back',
      ),
    ),
    ui.error && h('div', { class: 'banner err', style: 'margin-top:14px' }, ui.error),
  );
};

export { onEnter, menuScreen, titleFor, nameScreen };
