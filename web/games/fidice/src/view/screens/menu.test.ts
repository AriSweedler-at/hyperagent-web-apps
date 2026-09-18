// The menu and the name form on the fake DOM: the ids the e2e specs click and fill (#btnCreate,
// #btnJoin, #nameInput, #joinCode, #btnNameGo), what each control dispatches, and how the form
// adapts to what the menu picked.
import { describe, expect, test } from 'vitest';

import { DIFFICULTIES, choiceLabel, difficultyById } from '../../bots/registry.ts';
import { byClass, byId, fire, hasClass, requireId } from '../../../../../shared/edge/dom.fake.ts';
import { renderApp } from '../render.fake.ts';
import { CODE, SCENARIOS } from '../scenarios.ts';

describe('menuScreen', () => {
  test('the five options, the hero dice and the links', () => {
    const { root, intents } = renderApp(SCENARIOS.menu);
    requireId(root, 'screen-menu');
    const hero = byClass(root, 'dice-hero')[0];
    expect(
      hero?.childNodes.map((d) => ('getAttribute' in d ? d.getAttribute('class') : '')),
    ).toEqual(['die sm v6', 'die sm v6', 'die sm v6', 'die sm v5', 'die sm v2']);
    const options = ['btnLocal', 'btnCreate', 'btnJoin', 'btnSolo', 'btnWatchBots'].map((id) =>
      requireId(root, id),
    );
    expect(options.map((o) => hasClass(o, 'primary'))).toEqual([true, false, false, false, false]);
    expect(options.map((o) => byClass(o, 'opt-t')[0]?.textContent)).toEqual([
      'Pass the phone',
      'Host online',
      'Join with a code',
      'Play the computers',
      'Watch the computers',
    ]);
    options.forEach((o) => {
      fire(o, 'click');
    });
    const links = byClass(root, 'links')[0];
    links?.childNodes.forEach((b) => {
      if ('tagName' in b) fire(b, 'click');
    });
    expect(intents()).toEqual([
      { type: 'menu.local' },
      { type: 'menu.create' },
      { type: 'menu.join' },
      { type: 'menu.solo' },
      { type: 'menu.watchBots' },
      { type: 'nav', tab: 'ladder' },
      { type: 'nav', tab: 'rules' },
    ]);
  });
});

describe('nameScreen', () => {
  test('hosting: title, the saved name, the scoring select and the two buttons', () => {
    const { root, intents } = renderApp(SCENARIOS['name: host']);
    requireId(root, 'screen-name');
    expect(byClass(root, 'menu')[0]?.childNodes[0]?.textContent).toBe('Host a table online');
    const name = requireId(root, 'nameInput');
    expect(name.value).toBe('Ari');
    expect(name.getAttribute('maxlength')).toBe('16');
    const lives = requireId(root, 'livesSel');
    expect(lives.value).toBe('0');
    expect(lives.childNodes).toHaveLength(6);
    expect(lives.childNodes.map((o) => ('selected' in o ? o.selected : null))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(lives.childNodes.map((o) => o.textContent)).toEqual([
      'Keep score — no kayaks',
      '1 kayak each',
      '2 kayaks each',
      '3 kayaks each',
      '4 kayaks each',
      '5 kayaks each',
    ]);
    expect(byId(root, 'joinCode')).toBeNull();
    expect(byId(root, 'locals')).toBeNull();
    expect(byId(root, 'difficulty')).toBeNull();
    fire(name, 'input', { value: 'Andy' });
    fire(name, 'keydown', { key: 'a' });
    fire(name, 'keydown', { key: 'Enter' });
    fire(lives, 'change', { value: '3' });
    fire(requireId(root, 'btnNameGo'), 'click');
    fire(requireId(root, 'btnNameBack'), 'click');
    expect(intents()).toEqual([
      { type: 'form.name', value: 'Andy' },
      { type: 'form.submit' },
      { type: 'form.lives', value: 3 },
      { type: 'form.submit' },
      { type: 'form.back' },
    ]);
  });

  test('joining: the code field, no scoring, and the title once the code is complete', () => {
    const typedIn = renderApp(SCENARIOS['name: join, code typed']);
    expect(byClass(typedIn.root, 'menu')[0]?.childNodes[0]?.textContent).toBe(`Joining ${CODE}`);
    const code = requireId(typedIn.root, 'joinCode');
    expect(code.value).toBe(CODE);
    expect(code.getAttribute('maxlength')).toBe('5');
    expect(code.getAttribute('autocapitalize')).toBe('characters');
    expect(byId(typedIn.root, 'livesSel')).toBeNull();
    fire(code, 'input', { value: 'KEZAX' });
    fire(code, 'keydown', { key: 'Enter' });
    expect(typedIn.intents()).toEqual([
      { type: 'form.code', value: 'KEZAX' },
      { type: 'form.submit' },
    ]);

    const short = renderApp(SCENARIOS['name: join, short code, with an error']);
    expect(byClass(short.root, 'menu')[0]?.childNodes[0]?.textContent).toBe('Join with a code');
    const banner = byClass(short.root, 'banner')[0];
    expect(banner && hasClass(banner, 'err')).toBe(true);
    expect(banner?.textContent).toBe('No lobby found with that code.');
    expect(byClass(typedIn.root, 'banner')).toEqual([]);
  });

  test('pass the phone: one field per extra player, remove buttons, and the add button up to five', () => {
    const two = renderApp(SCENARIOS['name: pass the phone, two more players']);
    requireId(two.root, 'locals');
    expect(requireId(two.root, 'localName-0').value).toBe('Bea');
    expect(requireId(two.root, 'localName-1').value).toBe('');
    expect(requireId(two.root, 'localName-1').getAttribute('placeholder')).toBe('Player 3');
    const removes = byClass(two.root, 'btn-ghost').filter((b) => b.textContent === '✕');
    expect(removes).toHaveLength(2);
    fire(requireId(two.root, 'localName-1'), 'input', { value: 'Cal' });
    if (removes[0]) fire(removes[0], 'click');
    fire(requireId(two.root, 'btnAddLocal'), 'click');
    expect(two.intents()).toEqual([
      { type: 'form.local.set', index: 1, value: 'Cal' },
      { type: 'form.local.remove', index: 0 },
      { type: 'form.local.add' },
    ]);

    const five = renderApp(SCENARIOS['name: pass the phone, five players']);
    expect(byId(five.root, 'btnAddLocal')).toBeNull();
    expect(byId(five.root, 'localName-4')?.value).toBe('Fay');
  });

  test('solo: the difficulty picker with a preset on, or the custom blurb', () => {
    const preset = renderApp(SCENARIOS['name: solo, a preset']);
    requireId(preset.root, 'difficulty');
    const buttons = DIFFICULTIES.map((d) => requireId(preset.root, `difficulty-${d.id}`));
    const on = DIFFICULTIES.find((d) => d.strategy.id === 'profiler');
    expect(on).toBeDefined();
    expect(buttons.map((b) => hasClass(b, 'on'))).toEqual(DIFFICULTIES.map((d) => d === on));
    expect(buttons.map((b) => b.getAttribute('aria-checked'))).toEqual(
      DIFFICULTIES.map((d) => String(d === on)),
    );
    expect(requireId(preset.root, 'difficultyBlurb').textContent).toBe(
      on ? difficultyById(on.id).blurb : '',
    );
    if (buttons[0]) fire(buttons[0], 'click');
    fire(requireId(preset.root, 'btnConfigSolo'), 'click');
    expect(preset.intents()).toEqual([
      { type: 'form.difficulty', value: DIFFICULTIES[0].id },
      { type: 'config.open', target: { kind: 'solo' } },
    ]);

    const custom = renderApp(SCENARIOS['name: solo, a custom choice']);
    expect(byClass(custom.root, 'seg-btn').some((b) => hasClass(b, 'on'))).toBe(false);
    expect(requireId(custom.root, 'difficultyBlurb').textContent).toBe(
      `Custom: ${choiceLabel('random')}`,
    );
    expect(requireId(custom.root, 'livesSel').value).toBe('3');
  });
});
