import { describe, expect, test } from 'vitest';

import { fakeEl, fakePage, fakeTarget } from './page.fake.ts';

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
