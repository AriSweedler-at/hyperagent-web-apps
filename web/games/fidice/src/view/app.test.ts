// The page tree on the fake DOM: header, tabs, room pill, toast, and which screen the play tab
// shows (ids the e2e specs and theme.css rely on).
import { describe, expect, test } from 'vitest';

import { byId, classesOf, fire, requireId } from '../../../../shared/edge/dom.fake.ts';
import { renderApp } from './render.fake.ts';
import { CODE, SCENARIOS } from './scenarios.ts';

describe('appView', () => {
  test('the root, header, brand, badge and the three tabs', () => {
    const { root, intents } = renderApp(SCENARIOS.menu);
    const app = requireId(root, 'app-root');
    expect(classesOf(app)).toEqual(['app']);
    expect(app.childNodes.map((n) => ('tagName' in n ? n.tagName : 'text'))).toEqual([
      'HEADER',
      'MAIN',
      'DIV',
    ]);
    const brand = requireId(root, 'brandBtn');
    expect(brand.textContent).toBe('\u{1F964} Fidice ');
    expect(byId(root, 'roomPill')).toBeNull();
    const tabs = requireId(root, 'tabs');
    expect(
      tabs.childNodes.map((n) => ('getAttribute' in n ? n.getAttribute('data-tab') : '')),
    ).toEqual(['play', 'ladder', 'rules']);
    const [play, ladder, rules] = tabs.childNodes;
    expect(play && 'getAttribute' in play && play.getAttribute('class')).toBe('active');
    expect(ladder && 'getAttribute' in ladder && ladder.getAttribute('class')).toBeNull();
    if (ladder && 'tagName' in ladder) fire(ladder, 'click');
    if (rules && 'tagName' in rules) fire(rules, 'click');
    fire(brand, 'click');
    expect(intents()).toEqual([
      { type: 'nav', tab: 'ladder' },
      { type: 'nav', tab: 'rules' },
      { type: 'nav', tab: 'play' },
    ]);
  });

  test('the room pill shows the code once there is a game', () => {
    const { root } = renderApp(SCENARIOS['lobby: host']);
    expect(requireId(root, 'roomPill').textContent).toBe(CODE);
  });

  test('the toast is hidden until there is one', () => {
    const quiet = renderApp(SCENARIOS.menu);
    expect(requireId(quiet.root, 'toast').getAttribute('class')).toBe('toast');
    expect(requireId(quiet.root, 'toast').textContent).toBe('');
    const shown = renderApp(SCENARIOS['menu with a toast']);
    expect(requireId(shown.root, 'toast').getAttribute('class')).toBe('toast show');
    expect(requireId(shown.root, 'toast').textContent).toBe('Link copied');
  });

  test('each tab renders its section, and the config screen covers the play tab', () => {
    expect(byId(renderApp(SCENARIOS.menu).root, 'tab-play')).not.toBeNull();
    expect(byId(renderApp(SCENARIOS['ladder: collapsed']).root, 'tab-ladder')).not.toBeNull();
    expect(byId(renderApp(SCENARIOS['ladder: collapsed']).root, 'tab-play')).toBeNull();
    expect(byId(renderApp(SCENARIOS.rules).root, 'tab-rules')).not.toBeNull();
    const config = renderApp(SCENARIOS['config: the solo form']).root;
    expect(byId(config, 'screen-config')).not.toBeNull();
    expect(byId(config, 'screen-name')).toBeNull();
  });

  test('the play tab shows the screen for ui.screen, and the menu when a game is missing', () => {
    expect(byId(renderApp(SCENARIOS['name: host']).root, 'screen-name')).not.toBeNull();
    expect(byId(renderApp(SCENARIOS['lobby: host']).root, 'screen-lobby')).not.toBeNull();
    expect(byId(renderApp(SCENARIOS['game: opener, my turn']).root, 'screen-game')).not.toBeNull();
    expect(byId(renderApp(SCENARIOS['spec: lobby']).root, 'screen-spec')).not.toBeNull();
    const orphan = renderApp({ ...SCENARIOS.menu, screen: 'game' }).root;
    expect(byId(orphan, 'screen-menu')).not.toBeNull();
  });

  test('re-rendering patches the same root: menu to lobby to menu', () => {
    const r = renderApp(SCENARIOS.menu);
    const app = requireId(r.root, 'app-root');
    r.again(SCENARIOS['lobby: host']);
    expect(requireId(r.root, 'app-root')).toBe(app);
    expect(byId(r.root, 'screen-menu')).toBeNull();
    expect(byId(r.root, 'screen-lobby')).not.toBeNull();
    expect(requireId(r.root, 'roomPill').textContent).toBe(CODE);
    r.again(SCENARIOS.menu);
    expect(byId(r.root, 'screen-lobby')).toBeNull();
    expect(byId(r.root, 'roomPill')).toBeNull();
    expect(byId(r.root, 'screen-menu')).not.toBeNull();
  });
});
