// The fake DOM's own contract (docs/design/test-partition.md "Coverage": shared code is measured by
// the shared suite alone, so the fake the view tests of three games render into is pinned here,
// not only through them). Every member a reconciler touches: the tree operations and their errors,
// the form properties by tag, bubbling and its two flags, the deterministic serialization.
import { describe, expect, test } from 'vitest';

import {
  all,
  byClass,
  byId,
  classesOf,
  fakeDocument,
  fire,
  hasClass,
  isElement,
  recorder,
  requireId,
  serialize,
  type FakeElement,
} from './dom.fake.ts';

const doc = fakeDocument();
const el = (tag: string, attrs: Readonly<Record<string, string>> = {}): FakeElement => {
  const node = doc.createElement(tag);
  Object.entries(attrs).forEach(([name, value]) => {
    node.setAttribute(name, value);
  });
  return node;
};

describe('nodes', () => {
  test('a text node has a writable textContent and no parent until appended', () => {
    const text = doc.createTextNode('hi');
    expect(text.nodeType).toBe(3);
    expect(text.parentNode).toBeNull();
    expect(text.textContent).toBe('hi');
    (text as unknown as Record<string, unknown>)['textContent'] = 'bye';
    expect(text.textContent).toBe('bye');
    expect(isElement(text)).toBe(false);
    expect(serialize(text)).toBe('bye');
  });

  test('an element upper-cases its tag, starts empty and concatenates its descendants text', () => {
    const div = el('div');
    expect(div.nodeType).toBe(1);
    expect(div.tagName).toBe('DIV');
    expect(div.parentNode).toBeNull();
    expect(div.childNodes).toEqual([]);
    expect(div.textContent).toBe('');
    expect(isElement(div)).toBe(true);
    const span = el('span');
    span.appendChild(doc.createTextNode('a'));
    div.appendChild(span);
    div.appendChild(doc.createTextNode('b'));
    expect(div.textContent).toBe('ab');
    expect(span.parentNode).toBe(div);
    div.focus();
    div.blur();
  });

  test('attributes: get, set, remove, and the live map in insertion order', () => {
    const div = el('div');
    expect(div.getAttribute('id')).toBeNull();
    div.setAttribute('id', 'x');
    div.setAttribute('class', 'a b');
    div.setAttribute('id', 'y');
    expect(div.getAttribute('id')).toBe('y');
    expect([...div.attributes().entries()]).toEqual([
      ['id', 'y'],
      ['class', 'a b'],
    ]);
    div.removeAttribute('id');
    expect(div.getAttribute('id')).toBeNull();
    div.removeAttribute('never-set');
    expect([...div.attributes().keys()]).toEqual(['class']);
  });

  test('form properties exist only on the tags a browser gives them, at their defaults', () => {
    expect(el('input')).toMatchObject({ value: '', checked: false, disabled: false });
    expect(el('select')).toMatchObject({ value: '', disabled: false });
    expect(el('option')).toMatchObject({ value: '', selected: false, disabled: false });
    expect(el('button')).toMatchObject({ value: '', disabled: false });
    expect(el('textarea')).toMatchObject({ value: '', disabled: false });
    const div = el('div');
    expect('value' in div).toBe(false);
    expect('checked' in div).toBe(false);
    expect('selected' in el('input')).toBe(false);
    expect('checked' in el('select')).toBe(false);
  });
});

describe('the tree', () => {
  test('appendChild moves a child out of its old parent', () => {
    const a = el('a');
    const b = el('b');
    const child = doc.createTextNode('t');
    expect(a.appendChild(child)).toBe(child);
    expect(a.childNodes).toEqual([child]);
    expect(child.parentNode).toBe(a);
    b.appendChild(child);
    expect(a.childNodes).toEqual([]);
    expect(b.childNodes).toEqual([child]);
    expect(child.parentNode).toBe(b);
  });

  test('insertBefore places before the reference, appends on null, moves an adopted child, refuses a stranger', () => {
    const list = el('ul');
    const first = el('li', { id: '1' });
    const second = el('li', { id: '2' });
    const third = el('li', { id: '3' });
    list.appendChild(second);
    expect(list.insertBefore(first, second)).toBe(first);
    expect(list.insertBefore(third, null)).toBe(third);
    expect(list.childNodes.map((c) => (isElement(c) ? c.getAttribute('id') : '?'))).toEqual([
      '1',
      '2',
      '3',
    ]);
    // A child already in the list is moved, not duplicated.
    list.insertBefore(third, first);
    expect(list.childNodes.map((c) => (isElement(c) ? c.getAttribute('id') : '?'))).toEqual([
      '3',
      '1',
      '2',
    ]);
    // From another parent.
    const other = el('ol');
    const moved = el('li', { id: 'm' });
    other.appendChild(moved);
    list.insertBefore(moved, second);
    expect(other.childNodes).toEqual([]);
    expect(moved.parentNode).toBe(list);
    expect(() => list.insertBefore(el('li'), el('li'))).toThrow(
      'insertBefore: reference is not a child of <ul>',
    );
  });

  test('removeChild detaches and returns the child; a stranger is an error', () => {
    const div = el('div');
    const child = el('span');
    div.appendChild(child);
    expect(div.removeChild(child)).toBe(child);
    expect(div.childNodes).toEqual([]);
    expect(child.parentNode).toBeNull();
    expect(() => div.removeChild(child)).toThrow('removeChild: not a child of <div>');
  });

  test('childNodes is the live list the reconciler copies with Array.from', () => {
    const div = el('div');
    const live = div.childNodes;
    div.appendChild(el('i'));
    expect(live.length).toBe(1);
    expect(Array.from(live)).toEqual([...div.childNodes]);
  });
});

describe('events', () => {
  test('listeners register once per function, are removed one at a time, and report their types in order', () => {
    const button = el('button');
    const seen: string[] = [];
    const onClick = (): void => {
      seen.push('click');
    };
    const onClick2 = (): void => {
      seen.push('click2');
    };
    button.addEventListener('click', onClick);
    button.addEventListener('click', onClick);
    button.addEventListener('click', onClick2);
    button.addEventListener('keydown', onClick);
    expect(button.listenerTypes()).toEqual(['click', 'keydown']);
    fire(button, 'click');
    expect(seen).toEqual(['click', 'click2']);
    button.removeEventListener('click', onClick);
    fire(button, 'click');
    expect(seen).toEqual(['click', 'click2', 'click2']);
    button.removeEventListener('click', onClick2);
    button.removeEventListener('click', onClick2);
    button.removeEventListener('never', onClick2);
    expect(button.listenerTypes()).toEqual(['keydown']);
  });

  test('fire bubbles to the ancestors in order until stopPropagation, carries key and the two flags', () => {
    const root = el('div', { id: 'root' });
    const mid = el('div', { id: 'mid' });
    const leaf = el('input');
    root.appendChild(mid);
    mid.appendChild(leaf);
    const path: string[] = [];
    leaf.addEventListener('keydown', (e) => {
      path.push(`leaf:${e.key}:${e.target.tagName}`);
      e.preventDefault();
    });
    mid.addEventListener('keydown', (e) => {
      path.push('mid');
      e.stopPropagation();
    });
    root.addEventListener('keydown', () => {
      path.push('root');
    });
    const event = fire(leaf, 'keydown', { key: 'Enter' });
    expect(path).toEqual(['leaf:Enter:INPUT', 'mid']);
    expect(event.type).toBe('keydown');
    expect(event.defaultPrevented()).toBe(true);
    expect(event.propagationStopped()).toBe(true);
    // Without a stop the root hears it; a plain fire has no key and neither flag.
    const plain = fire(mid, 'click');
    expect(plain.key).toBe('');
    expect(plain.defaultPrevented()).toBe(false);
    expect(plain.propagationStopped()).toBe(false);
    const heard: string[] = [];
    root.addEventListener('click', () => {
      heard.push('root');
    });
    fire(leaf, 'click');
    expect(heard).toEqual(['root']);
  });

  test('fire writes value and checked to the target first, as typing or ticking would', () => {
    const input = el('input');
    const seen: string[] = [];
    input.addEventListener('input', (e) => {
      seen.push(`${String(e.target.value)}/${String(e.target.checked)}`);
    });
    fire(input, 'input', { value: 'Ari' });
    fire(input, 'input', { checked: true });
    fire(input, 'input');
    expect(seen).toEqual(['Ari/false', 'Ari/true', 'Ari/true']);
    expect(input.value).toBe('Ari');
    expect(input.checked).toBe(true);
  });
});

describe('serialize', () => {
  test('attributes sorted, form properties when they differ from their defaults, listener types in order, children inline', () => {
    const form = el('form', { id: 'f', class: 'x' });
    const input = el('input', { type: 'checkbox' });
    fire(input, 'change', { checked: true, value: 'on' });
    input.addEventListener('change', () => undefined);
    input.addEventListener('blur', () => undefined);
    const option = el('option');
    (option as unknown as Record<string, unknown>)['selected'] = true;
    (option as unknown as Record<string, unknown>)['disabled'] = true;
    const label = el('label');
    label.appendChild(doc.createTextNode('Name'));
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(option);
    form.appendChild(el('button'));
    expect(serialize(form)).toBe(
      '<form class="x" id="f"><label>Name</label><input type="checkbox" [value=on] [checked] @change @blur></input><option [disabled] [selected]></option><button></button></form>',
    );
  });
});

describe('queries', () => {
  const tree = (): FakeElement => {
    const root = el('div', { id: 'root', class: 'screen' });
    const a = el('p', { id: 'a', class: 'row first' });
    const b = el('p', { id: 'b', class: 'row' });
    const c = el('span', { class: 'row' });
    a.appendChild(c);
    a.appendChild(doc.createTextNode('text'));
    root.appendChild(a);
    root.appendChild(b);
    return root;
  };

  test('all walks in document order, root included, text nodes skipped; the predicate filters', () => {
    const root = tree();
    expect(all(root).map((e) => e.getAttribute('id') ?? e.tagName)).toEqual([
      'root',
      'a',
      'SPAN',
      'b',
    ]);
    expect(all(root, (e) => e.tagName === 'P').map((e) => e.getAttribute('id'))).toEqual([
      'a',
      'b',
    ]);
    expect(all(doc.createTextNode('t'))).toEqual([]);
  });

  test('byId, requireId, classes', () => {
    const root = tree();
    expect(byId(root, 'b')?.tagName).toBe('P');
    expect(byId(root, 'zzz')).toBeNull();
    expect(requireId(root, 'a').getAttribute('class')).toBe('row first');
    expect(() => requireId(root, 'zzz')).toThrow('missing element #zzz');
    expect(classesOf(requireId(root, 'a'))).toEqual(['row', 'first']);
    expect(classesOf(el('i'))).toEqual([]);
    expect(classesOf(el('i', { class: '  a   b ' }))).toEqual(['a', 'b']);
    expect(hasClass(requireId(root, 'a'), 'first')).toBe(true);
    expect(hasClass(requireId(root, 'b'), 'first')).toBe(false);
    expect(byClass(root, 'row').map((e) => e.getAttribute('id') ?? e.tagName)).toEqual([
      'a',
      'SPAN',
      'b',
    ]);
  });
});

describe('recorder', () => {
  test('collects in order and hands back the live list', () => {
    const r = recorder<number>();
    expect(r.recorded()).toEqual([]);
    r.record(1);
    r.record(2);
    expect(r.recorded()).toEqual([1, 2]);
  });
});
