// The page tree (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html lines 3478-3526
// (bundle section "// src/view/app.ts"); every id, class, tooltip and text is the bundle's. The
// header with the brand, the room pill and the three tabs; the play tab's screen for `ui.screen`
// (the bot configuration screen covers it while open); the ladder and rules tabs; the toast.
import { configScreen } from './screens/botConfig.ts';
import { ladderTab } from './screens/ladder.ts';
import { lobbyScreen } from './screens/lobby.ts';
import { menuScreen, nameScreen } from './screens/menu.ts';
import { rulesTab } from './screens/rules.ts';
import { spectatorScreen } from './screens/spectator.ts';
import { gameScreen } from './screens/table.ts';
import type { Dispatch, Tab, Ui } from './types.ts';
import { cls, h, type VNode } from './vdom.ts';

const TABS: ReadonlyArray<Readonly<{ tab: Tab; label: string; tip: string }>> = [
  { tab: 'play', label: 'Play', tip: 'Lobby, seats and the table' },
  { tab: 'ladder', label: 'The Ladder', tip: 'Every hand, strongest at the top' },
  { tab: 'rules', label: 'Rules', tip: 'How to play Fidice' },
];

const header = (ui: Ui, dispatch: Dispatch): VNode =>
  h(
    'header',
    {},
    h(
      'div',
      {
        class: 'brand',
        id: 'brandBtn',
        on: {
          click: () => {
            dispatch({ type: 'nav', tab: 'play' });
          },
        },
      },
      h('span', { class: 'cup' }, '\u{1F964}'),
      ' Fidice ',
      ui.game && h('span', { class: 'pill', id: 'roomPill' }, ui.game.code),
    ),
    h(
      'span',
      { class: 'badge', tip: 'House rules from the Crowe house on Kezar Lake' },
      'Kezar Lake, Maine',
    ),
    h(
      'nav',
      { class: 'tabs', id: 'tabs' },
      TABS.map((t) =>
        h(
          'button',
          {
            class: cls(ui.tab === t.tab && 'active'),
            attrs: { 'data-tab': t.tab },
            tip: t.tip,
            on: {
              click: () => {
                dispatch({ type: 'nav', tab: t.tab });
              },
            },
          },
          t.label,
        ),
      ),
    ),
  );

const playTab = (ui: Ui, dispatch: Dispatch): VNode => {
  const g = ui.game;
  const body = ((): VNode => {
    switch (ui.screen) {
      case 'menu':
        return menuScreen(ui, dispatch);
      case 'name':
        return nameScreen(ui, dispatch);
      case 'lobby':
        return g ? lobbyScreen(ui, g, dispatch) : menuScreen(ui, dispatch);
      case 'game':
        return g ? gameScreen(ui, g, dispatch) : menuScreen(ui, dispatch);
      case 'spec':
        return g ? spectatorScreen(ui, g, dispatch) : menuScreen(ui, dispatch);
    }
  })();
  return h(
    'section',
    { id: 'tab-play' },
    ui.configTarget ? configScreen(ui, ui.configTarget, dispatch) : body,
  );
};

const appView = (ui: Ui, dispatch: Dispatch): VNode =>
  h(
    'div',
    { class: 'app', id: 'app-root' },
    header(ui, dispatch),
    h(
      'main',
      {},
      ui.tab === 'play' && playTab(ui, dispatch),
      ui.tab === 'ladder' && ladderTab(ui, dispatch),
      ui.tab === 'rules' && rulesTab(),
    ),
    h('div', { class: cls('toast', ui.toast && 'show'), id: 'toast' }, ui.toast ?? ''),
  );

export { TABS, appView };
