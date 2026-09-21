// No jsdom in this repo (docs/ARCHITECTURE.md lists it for *.dom.test.ts only when installed), so
// these run against a structural fake of the members dom.ts touches. Nothing here needs layout.
import { describe, expect, test } from 'vitest';

import {
  addClass,
  appendHtml,
  byId,
  childCount,
  clear,
  closestFrom,
  dataOf,
  escapeHtml,
  hasClass,
  inputDataOf,
  inputTypeOf,
  isDisabled,
  isWithin,
  keyOf,
  listen,
  listenId,
  preventDefault,
  queryAllIn,
  queryIn,
  readValue,
  removeElement,
  safeHtml,
  selectText,
  setValue,
  removeClass,
  requireId,
  setAttr,
  setDisabled,
  setHidden,
  setHtml,
  setText,
  stopPropagation,
  targetIdOf,
  targetValueOf,
  toggleClass,
  trustedHtml,
  type DocumentLike,
} from './dom.ts';
import { fakeEl, fakePage, fakeTarget } from './page.fake.ts';

type FakeEl = Readonly<{
  el: HTMLElement;
  classes: Set<string>;
  attrs: Map<string, string>;
  /** What the element holds: text nodes as strings, parsed markup as `html:` entries. */
  children: string[];
}>;

const fakeElement = (): FakeEl => {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const children: string[] = ['<existing>'];
  const el = {
    replaceChildren: (...nodes: string[]) => {
      children.splice(0, children.length, ...nodes);
    },
    insertAdjacentHTML: (position: string, markup: string) => {
      children.splice(position === 'afterbegin' ? 0 : children.length, 0, `html:${markup}`);
    },
    classList: {
      add: (...names: string[]) => {
        names.forEach((n) => classes.add(n));
      },
      remove: (...names: string[]) => {
        names.forEach((n) => classes.delete(n));
      },
      toggle: (name: string, force?: boolean) => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name: string) => classes.has(name),
    },
    toggleAttribute: (name: string, force?: boolean) => {
      const on = force ?? !attrs.has(name);
      if (on) attrs.set(name, '');
      else attrs.delete(name);
      return on;
    },
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
    removeAttribute: (name: string) => {
      attrs.delete(name);
    },
  };
  return { el: el as unknown as HTMLElement, classes, attrs, children };
};

const fakeDoc = (ids: Readonly<Record<string, HTMLElement>>): DocumentLike => ({
  getElementById: (id) => ids[id] ?? null,
});

describe('escapeHtml', () => {
  test('escapes the five significant characters, in text and attribute positions', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  test('stringifies non-strings like the legacy esc()', () => {
    expect(escapeHtml(12)).toBe('12');
    expect(escapeHtml(null)).toBe('null');
    expect(escapeHtml(undefined)).toBe('undefined');
  });

  test('leaves safe text alone', () => {
    expect(escapeHtml('Ari & co')).toBe('Ari &amp; co');
    expect(escapeHtml('plain')).toBe('plain');
  });
});

describe('safeHtml tag', () => {
  test('escapes interpolations and keeps literal markup', () => {
    const name = '<script>alert(1)</script>';
    expect(safeHtml`<b class="n">${name}</b>`.markup).toBe(
      '<b class="n">&lt;script&gt;alert(1)&lt;/script&gt;</b>',
    );
  });

  test('nests SafeHtml without re-escaping and joins arrays', () => {
    const items = ['a<b', 'c'].map((s) => safeHtml`<li>${s}</li>`);
    expect(safeHtml`<ul>${items}</ul>`.markup).toBe('<ul><li>a&lt;b</li><li>c</li></ul>');
    expect(safeHtml`${trustedHtml('<hr>')}`.markup).toBe('<hr>');
  });

  test('a look-alike object is not trusted', () => {
    const forged = { kind: 'safe-html', markup: 5 };
    expect(safeHtml`${forged}`.markup).toBe('[object Object]');
    const partial = { kind: 'safe-html' };
    expect(safeHtml`${partial}`.markup).toBe('[object Object]');
  });

  test('numbers, booleans and null render as text', () => {
    expect(safeHtml`${1}${true}${null}`.markup).toBe('1truenull');
  });

  test('no interpolations, nested arrays', () => {
    expect(safeHtml`<hr>`.markup).toBe('<hr>');
    expect(safeHtml`${[['<', ['>']]]}`.markup).toBe('&lt;&gt;');
  });
});

describe('lookup', () => {
  test('byId returns the element or null', () => {
    const { el } = fakeElement();
    const doc = fakeDoc({ hand: el });
    expect(byId(doc, 'hand')).toBe(el);
    expect(byId(doc, 'nope')).toBeNull();
  });

  test('requireId throws a named error for a missing element', () => {
    const { el } = fakeElement();
    const doc = fakeDoc({ hand: el });
    expect(requireId(doc, 'hand')).toBe(el);
    expect(() => requireId(doc, 'statusBanner')).toThrow('missing element #statusBanner');
  });
});

describe('setters', () => {
  test('setText writes a text node, never markup', () => {
    const f = fakeElement();
    setText(f.el, '<b>x</b>');
    expect(f.children).toEqual(['<b>x</b>']);
  });

  test('setHtml replaces the content with parsed SafeHtml only', () => {
    const f = fakeElement();
    setHtml(f.el, safeHtml`<i>${'a&b'}</i>`);
    expect(f.children).toEqual(['html:<i>a&amp;b</i>']);
    // @ts-expect-error a bare string is not SafeHtml
    setHtml(f.el, '<i>raw</i>');
  });

  test('clear removes children', () => {
    const f = fakeElement();
    clear(f.el);
    expect(f.children).toEqual([]);
  });

  test('appendHtml adds after the last child; removeElement and childCount (over page.fake.ts)', () => {
    const row = fakeEl('row');
    const list = fakeEl('list', { text: '<p>a</p>', children: [row] });
    appendHtml(list.el, safeHtml`<p>${'b'}</p>`);
    expect(list.text()).toBe('<p>a</p><p>b</p>');
    expect(childCount(list.el)).toBe(1);
    expect(row.removed()).toBe(false);
    removeElement(row.el);
    expect(row.removed()).toBe(true);
  });

  test('class helpers', () => {
    const f = fakeElement();
    addClass(f.el, 'a', 'b');
    expect([...f.classes]).toEqual(['a', 'b']);
    toggleClass(f.el, 'a', false);
    toggleClass(f.el, 'c', true);
    expect([...f.classes]).toEqual(['b', 'c']);
    expect(hasClass(f.el, 'b')).toBe(true);
    removeClass(f.el, 'b', 'c');
    expect(hasClass(f.el, 'b')).toBe(false);
    expect(f.classes.size).toBe(0);
  });

  test('hidden, disabled and attributes', () => {
    const f = fakeElement();
    setHidden(f.el, true);
    expect(f.attrs.has('hidden')).toBe(true);
    setHidden(f.el, false);
    expect(f.attrs.has('hidden')).toBe(false);
    setDisabled(f.el, true);
    expect(f.attrs.has('disabled')).toBe(true);
    setDisabled(f.el, false);
    expect(f.attrs.has('disabled')).toBe(false);
    setAttr(f.el, 'aria-label', 'Hand');
    expect(f.attrs.get('aria-label')).toBe('Hand');
    setAttr(f.el, 'aria-label', null);
    expect(f.attrs.has('aria-label')).toBe(false);
  });
});

describe('values, styles and queries (over page.fake.ts)', () => {
  test('readValue/setValue write only when the value differs; selectText tolerates its absence', () => {
    const input = fakeEl('nameInput', { value: 'Ari' });
    expect(readValue(input.el)).toBe('Ari');
    setValue(input.el, 'Bob');
    expect(input.value()).toBe('Bob');
    setValue(input.el, 'Bob');
    expect(input.value()).toBe('Bob');
    selectText(input.el);
    selectText({} as unknown as HTMLElement);
  });

  test('style properties, data attributes, disabled, queries', () => {
    const label = fakeEl('label');
    const pile = fakeEl('stockPile', {
      attrs: { 'data-pile-key': 'back' },
      queries: { '.pile-label': [label] },
    });
    expect(dataOf(pile.el, 'pile-key')).toBe('back');
    expect(dataOf(pile.el, 'card')).toBeNull();
    expect(isDisabled(pile.el)).toBe(false);
    pile.el.toggleAttribute('disabled', true);
    expect(isDisabled(pile.el)).toBe(true);
    expect(queryIn(pile.el, '.pile-label')).toBe(label.el);
    expect(queryIn(pile.el, '.nope')).toBeNull();
    expect(queryAllIn(pile.el, '.pile-label')).toEqual([label.el]);
    expect(queryAllIn(pile.el, '.nope')).toEqual([]);
  });
});

describe('events (over page.fake.ts)', () => {
  test('listen/listenId register handlers; the target helpers read through the casts', () => {
    const card = fakeEl('card', { attrs: { 'data-card': 'AS' } });
    const hand = fakeEl('hand', { children: [card] });
    const page = fakePage([hand, card]);
    const seen: string[] = [];
    listen(hand.el, 'click', (e) => {
      seen.push(
        `hand:${targetIdOf(e)}:${closestFrom(e, '.card')?.getAttribute('data-card') ?? '-'}`,
      );
    });
    listenId(page.doc, 'card', 'input', (e) => {
      seen.push(`card:${targetValueOf(e)}:${inputTypeOf(e)}:${inputDataOf(e) ?? 'null'}`);
      preventDefault(e);
    });
    listen(page.doc, 'keydown', (e) => {
      seen.push(`doc:${keyOf(e)}`);
      stopPropagation(e);
    });
    hand.fire('click', { target: fakeTarget({ id: 'x', closest: { '.card': card } }) });
    hand.fire('click');
    const input = card.fire('input', { inputType: 'insertText', data: 'a' });
    const key = page.fire('keydown', { key: 'Enter' });
    expect(seen).toEqual(['hand:x:AS', 'hand:hand:-', 'card::insertText:a', 'doc:Enter']);
    expect(input.wasPrevented()).toBe(true);
    expect(key.wasStopped()).toBe(true);
    expect(hand.listenerTypes()).toEqual(['click']);
    // Containment: the element, its declared children, and nothing else.
    const stranger = fakeEl('stranger');
    expect(isWithin(hand.el, card.fire('pointerdown'))).toBe(true);
    expect(isWithin(hand.el, stranger.fire('pointerdown'))).toBe(false);
    expect(isWithin(hand.el, page.fire('click'))).toBe(false);
    // The target helpers on a bare event with no target.
    const bare = page.fire('click');
    expect(targetIdOf(bare)).toBe('');
    expect(targetValueOf(bare)).toBe('');
    expect(closestFrom(bare, '.card')).toBeNull();
    expect(keyOf(bare)).toBe('');
    expect(inputTypeOf(bare)).toBe('');
    expect(inputDataOf(bare)).toBeNull();
  });
});
