import { describe, expect, test } from 'vitest';

import {
  fakeEl,
  fakePage,
  fakeTarget,
  modeButtons,
  optionsFromMarkup,
  pageFromMarkup,
  shellPage,
} from './page.fake.ts';

describe('page.fake', () => {
  test('an element records classes, attributes, content, value and styles', () => {
    const el = fakeEl('toast', { classes: ['a'], attrs: { title: 't' }, text: 'hi', value: 'v' });
    expect(el.id).toBe('toast');
    expect(el.classes()).toEqual(['a']);
    expect(el.hasClass('a')).toBe(true);
    expect(el.hidden()).toBe(false);
    el.el.classList.add('hidden', 'b');
    el.el.classList.remove('a');
    expect(el.hidden()).toBe(true);
    expect(el.classes()).toEqual(['hidden', 'b']);
    expect(el.el.classList.toggle('b')).toBe(false);
    expect(el.el.classList.contains('b')).toBe(false);
    expect(el.attr('title')).toBe('t');
    el.el.setAttribute('title', 'u');
    expect(el.el.getAttribute('title')).toBe('u');
    el.el.removeAttribute('title');
    expect(el.attr('title')).toBeNull();
    expect(el.el.toggleAttribute('disabled')).toBe(true);
    expect(el.disabled()).toBe(true);
    expect(el.text()).toBe('hi');
    el.el.replaceChildren('a', 'b');
    expect(el.text()).toBe('ab');
    el.el.replaceChildren();
    el.el.insertAdjacentHTML('afterbegin', '<i>x</i>');
    expect(el.text()).toBe('<i>x</i>');
    expect(el.value()).toBe('v');
    expect(el.style('--x')).toBeNull();
    expect(el.el.querySelector('.q')).toBeNull();
    expect(el.el.closest('.q')).toBeNull();
    expect(el.el.contains(el.el)).toBe(true);
    expect(el.el.contains(fakeEl('z').el)).toBe(false);
  });

  test('a page finds elements by id, fires on the document, and refuses an unknown id', () => {
    const a = fakeEl('a');
    const page = fakePage([a]);
    expect(page.doc.getElementById('a')).toBe(a.el);
    expect(page.doc.getElementById('b')).toBeNull();
    expect(page.get('a')).toBe(a);
    expect(() => page.get('b')).toThrow('fake page has no #b');
    expect(page.doc.body).toBe(page.body.el);
    const fired: unknown[] = [];
    page.doc.addEventListener('click', (e) => {
      fired.push(e.target);
    });
    const target = fakeTarget({});
    page.fire('click', { target });
    page.fire('click');
    expect(fired).toEqual([target, null]);
    expect(fakeTarget({ id: 'i', value: 'w' })).toMatchObject({ id: 'i', value: 'w' });
  });
});

describe('page.fake, the members the painters and the drag helpers reach', () => {
  test('checked, inline styles, toggled attributes, queries (static or per call), children, containment, select and remove', () => {
    const a = fakeEl('a');
    const b = fakeEl('b');
    let round = 0;
    const box = fakeEl('box', {
      children: [a],
      queries: {
        '.static': [b],
        '.fresh': () => {
          round += 1;
          return [fakeEl(`fresh-${String(round)}`)];
        },
      },
    });
    expect(box.checked()).toBe(false);
    (box.el as HTMLInputElement).checked = true;
    expect(box.checked()).toBe(true);
    box.el.style.setProperty('--x', '1');
    expect(box.style('--x')).toBe('1');
    expect(box.el.toggleAttribute('hidden', true)).toBe(true);
    expect(box.el.hasAttribute('hidden')).toBe(true);
    expect(box.el.toggleAttribute('hidden', false)).toBe(false);
    expect(box.el.hasAttribute('hidden')).toBe(false);
    expect(box.el.querySelector('.static')).toBe(b.el);
    expect(box.el.querySelectorAll('.static')).toEqual([b.el]);
    expect(box.el.querySelector('.fresh')?.id).toBe('fresh-1');
    expect(box.el.querySelector('.fresh')?.id).toBe('fresh-2');
    expect([...box.el.children]).toEqual([a.el]);
    expect(box.el.contains(a.el)).toBe(true);
    expect(box.el.contains(b.el)).toBe(true);
    expect(box.el.contains(fakeEl('stranger').el)).toBe(false);
    const inner = fakeEl('inner');
    const nested = fakeEl('nested', { children: [inner] });
    const outer = fakeEl('outer', { children: [nested] });
    expect(outer.el.contains(inner.el)).toBe(true);
    expect(box.el.scrollHeight).toBe(0);
    (box.el as HTMLInputElement).select();
    expect(box.removed()).toBe(false);
    box.el.remove();
    expect(box.removed()).toBe(true);
  });

  test('a fired event carries what the test hands it, with the browser defaults otherwise; a delegated target answers closest', () => {
    const el = fakeEl('k');
    const full = el.fire('keydown', {
      key: 'a',
      inputType: 'insertText',
      data: 'a',
      clientX: 1,
      clientY: 2,
      pointerId: 3,
    });
    expect(full).toMatchObject({
      type: 'keydown',
      key: 'a',
      inputType: 'insertText',
      data: 'a',
      clientX: 1,
      clientY: 2,
      pointerId: 3,
    });
    expect(full.target).toBe(el.el);
    const bare = el.fire('click');
    expect(bare).toMatchObject({ key: '', inputType: '', data: null, clientX: 0, clientY: 0 });
    expect(bare.wasPrevented()).toBe(false);
    bare.preventDefault();
    expect(bare.wasPrevented()).toBe(true);
    expect(bare.wasStopped()).toBe(false);
    bare.stopPropagation();
    expect(bare.wasStopped()).toBe(true);
    expect(el.listenerTypes()).toEqual([]);
    const row = fakeEl('row');
    const target = fakeTarget({ closest: { '.row': row } }) as Readonly<{
      closest: (selector: string) => unknown;
      id: string;
      value: string;
    }>;
    expect(target.closest('.row')).toBe(row.el);
    expect(target.closest('.nope')).toBeNull();
    expect(target.id).toBe('');
    expect(target.value).toBe('');
    const empty = fakeTarget({}) as Readonly<{ closest: (selector: string) => unknown }>;
    expect(empty.closest('.row')).toBeNull();
  });
});

describe('pageFromMarkup', () => {
  const MARKUP = `
<div id="app" class="app fixed">
  <button id="undoBtn" class="btn" disabled title="Undo">Undo</button>
  <input id="menuCurtainToggle" type="checkbox" checked data-next="never">
  <div id="point-8" class="point pt-near" data-abs="8" data-own="8"></div>
  <input id="nameInput" value="Ari">
  <div id="playModeSwitch"></div>
  <div id="toast"></div>
</div>`;

  test('optionsFromMarkup reads classes, value, title, data attributes and the boolean flags as written', () => {
    const options = optionsFromMarkup(MARKUP);
    expect([...options.keys()]).toEqual([
      'app',
      'undoBtn',
      'menuCurtainToggle',
      'point-8',
      'nameInput',
      'playModeSwitch',
      'toast',
    ]);
    expect(options.get('app')).toEqual({ classes: ['app', 'fixed'], attrs: {} });
    expect(options.get('undoBtn')).toEqual({
      classes: ['btn'],
      attrs: { disabled: '', title: 'Undo' },
    });
    expect(options.get('menuCurtainToggle')).toEqual({
      classes: [],
      attrs: { checked: '', 'data-next': 'never' },
    });
    expect(options.get('point-8')).toEqual({
      classes: ['point', 'pt-near'],
      attrs: { 'data-abs': '8', 'data-own': '8' },
    });
    expect(options.get('nameInput')).toEqual({ classes: [], value: 'Ari', attrs: {} });
  });

  test('modeButtons: one fake per mode, named by prefix, wearing data-mode and the classes given', () => {
    const plain = modeButtons('submenu', ['online', 'local']);
    expect(plain.map((b) => b.id)).toEqual(['submenu-online', 'submenu-local']);
    expect(plain.map((b) => b.classes())).toEqual([[], []]);
    expect(plain.map((b) => b.attr('data-mode'))).toEqual(['online', 'local']);
    const switchButtons = modeButtons('modeSwitch', ['online', 'local', 'sandbox'], (mode) => [
      'mode-btn',
      ...(mode === 'sandbox' ? ['hidden'] : []),
    ]);
    expect(switchButtons.map((b) => b.classes())).toEqual([
      ['mode-btn'],
      ['mode-btn'],
      ['mode-btn', 'hidden'],
    ]);
    expect(switchButtons[2]?.hidden()).toBe(true);
  });

  test('every id of the markup becomes an element; declared and extra add queries to an id, more adds the rest', () => {
    const buttons = modeButtons('modeSwitch', ['online', 'local']);
    const child = fakeEl('child');
    const page = pageFromMarkup(
      MARKUP,
      { playModeSwitch: { queries: { '.mode-btn': buttons } } },
      { toast: { children: [child] } },
      [...buttons, child],
    );
    expect(page.get('undoBtn').disabled()).toBe(true);
    expect(page.get('undoBtn').attr('title')).toBe('Undo');
    expect(page.get('nameInput').value()).toBe('Ari');
    expect(page.get('point-8').attr('data-abs')).toBe('8');
    // Declared queries and the markup's classes both hold on the composed element.
    expect(page.get('app').hasClass('fixed')).toBe(true);
    expect(page.get('playModeSwitch').el.querySelectorAll('.mode-btn')).toHaveLength(2);
    expect(page.get('toast').el.contains(child.el)).toBe(true);
    expect(page.get('modeSwitch-local').attr('data-mode')).toBe('local');
    expect(() => page.get('nope')).toThrow('fake page has no #nope');
    // Defaults: no extra, no more.
    const bare = pageFromMarkup(MARKUP, {});
    expect(bare.get('toast').el.contains(child.el)).toBe(false);
    expect(() => bare.get('modeSwitch-local')).toThrow();
  });
});

describe('shellPage', () => {
  // The two shell ids the mode buttons live under, and a few the markup reads as pageFromMarkup does.
  const MARKUP = `
<div id="homeScreen" class="screen">
  <div id="playModeSwitch"></div>
  <div id="playSubmenu" class="hidden"></div>
  <button id="hostBtn" class="btn" disabled>Host</button>
  <input id="p1" value="Ann">
  <div id="tableScreen"></div>
</div>`;
  const MODES = ['online', 'local', 'sandbox'] as const;

  test('the switch and the submenu hold one button per mode, in order, found by id and by the queries the paints use; the rest of the page still comes from the markup', () => {
    const page = shellPage(MARKUP, { modes: MODES });
    expect(page.modeButtons.map((b) => b.id)).toEqual([
      'modeSwitch-online',
      'modeSwitch-local',
      'modeSwitch-sandbox',
    ]);
    expect(page.submenuButtons.map((b) => b.id)).toEqual([
      'submenu-online',
      'submenu-local',
      'submenu-sandbox',
    ]);
    expect(page.modeButtons.map((b) => b.classes())).toEqual([
      ['mode-btn'],
      ['mode-btn'],
      ['mode-btn'],
    ]);
    expect(page.submenuButtons.map((b) => b.classes())).toEqual([[], [], []]);
    expect(page.submenuButtons.map((b) => b.attr('data-mode'))).toEqual([...MODES]);
    const els = (buttons: ReadonlyArray<{ el: HTMLElement }>): ReadonlyArray<HTMLElement> =>
      buttons.map((b) => b.el);
    const modeSwitch = page.get('playModeSwitch').el;
    const submenu = page.get('playSubmenu').el;
    expect(modeSwitch.querySelectorAll('.mode-btn')).toEqual(els(page.modeButtons));
    expect(submenu.querySelectorAll('button')).toEqual(els(page.submenuButtons));
    expect(submenu.querySelectorAll('button[data-mode]')).toEqual(els(page.submenuButtons));
    // Without a hidden mode there is no per-mode selector.
    expect(modeSwitch.querySelector('.mode-btn[data-mode="sandbox"]')).toBeNull();
    expect(submenu.querySelector('button[data-mode="sandbox"]')).toBeNull();
    expect(page.get('modeSwitch-local')).toBe(page.modeButtons[1]);
    expect(page.get('submenu-local')).toBe(page.submenuButtons[1]);
    // pageFromMarkup's own reading of the markup holds on the composed page.
    expect(page.get('playSubmenu').hidden()).toBe(true);
    expect(page.get('hostBtn').disabled()).toBe(true);
    expect(page.get('p1').value()).toBe('Ann');
    expect(() => page.get('nope')).toThrow('fake page has no #nope');
  });

  test('a hidden mode ships hidden in both and answers its per-mode selectors alone; the active switch mode wears active in the switch only', () => {
    const page = shellPage(MARKUP, {
      modes: MODES,
      hiddenModes: ['sandbox'],
      activeSwitchMode: 'online',
    });
    expect(page.modeButtons.map((b) => b.classes())).toEqual([
      ['mode-btn', 'active'],
      ['mode-btn'],
      ['mode-btn', 'hidden'],
    ]);
    expect(page.submenuButtons.map((b) => b.classes())).toEqual([[], [], ['hidden']]);
    const modeSwitch = page.get('playModeSwitch').el;
    const submenu = page.get('playSubmenu').el;
    expect(modeSwitch.querySelectorAll('.mode-btn[data-mode="sandbox"]')).toEqual([
      page.modeButtons[2]?.el,
    ]);
    expect(submenu.querySelectorAll('button[data-mode="sandbox"]')).toEqual([
      page.submenuButtons[2]?.el,
    ]);
    expect(modeSwitch.querySelector('.mode-btn[data-mode="online"]')).toBeNull();
    expect(submenu.querySelector('button[data-mode="online"]')).toBeNull();
  });

  test('declared, extra and more join the shell entries; a declared entry for a shell id replaces the shell one whole', () => {
    const strip = fakeEl('oppStrip', { classes: ['opp-strip'] });
    const child = fakeEl('child');
    const page = shellPage(
      MARKUP,
      { modes: MODES },
      { tableScreen: { queries: { '.opp-strip': [strip] } } },
      { homeScreen: { children: [child] } },
      [strip, child],
    );
    expect(page.get('tableScreen').el.querySelector('.opp-strip')).toBe(strip.el);
    expect(page.get('homeScreen').el.contains(child.el)).toBe(true);
    expect(page.get('homeScreen').hasClass('screen')).toBe(true);
    expect(page.get('oppStrip')).toBe(strip);
    expect(page.get('child')).toBe(child);
    expect(page.get('playModeSwitch').el.querySelectorAll('.mode-btn')).toHaveLength(3);
    const own = fakeEl('own');
    const replaced = shellPage(
      MARKUP,
      { modes: MODES },
      { playSubmenu: { queries: { button: [own] } } },
    );
    expect(replaced.get('playSubmenu').el.querySelectorAll('button')).toEqual([own.el]);
    expect(replaced.get('playSubmenu').el.querySelector('button[data-mode]')).toBeNull();
    expect(replaced.submenuButtons).toHaveLength(3);
  });
});
