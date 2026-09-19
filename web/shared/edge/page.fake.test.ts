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
