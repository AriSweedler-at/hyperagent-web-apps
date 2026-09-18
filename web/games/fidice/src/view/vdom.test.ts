// The reconciler on the structural fake DOM (web/shared/edge/dom.fake.ts; jsdom is not installed).
// What these pin is the legacy behaviour the screens rely on: children matched by position, an
// element reused only for the same tag and key, attributes and properties written on change and
// cleared when dropped, listeners rebound on every render, text nodes updated in place.
import { describe, expect, test } from 'vitest';

import {
  all,
  byId,
  fakeDocument,
  fire,
  isElement,
  serialize,
  type FakeElement,
  type FakeEvent,
  type FakeNode,
} from '../../../../shared/edge/dom.fake.ts';
import { blurTarget, cls, h, mount, targetChecked, targetValue, type VNode } from './vdom.ts';

/** A fake document and root, viewed as the DOM types the reconciler is written against. */
const setup = (): Readonly<{ doc: Document; root: Element; fakeRoot: FakeElement }> => {
  const fake = fakeDocument();
  const fakeRoot = fake.createElement('div');
  return { doc: fake as unknown as Document, root: fakeRoot as unknown as Element, fakeRoot };
};

/** Mount `tree` and print what the root holds. */
const render = (fixture: ReturnType<typeof setup>, tree: VNode): string => {
  mount(fixture.doc, fixture.root, tree);
  return fixture.fakeRoot.childNodes.map(serialize).join('');
};

/** The children of an element node; none for a text node or a missing one. */
const kids = (node: FakeNode | undefined): ReadonlyArray<FakeNode> =>
  node !== undefined && isElement(node) ? node.childNodes : [];

describe('h and cls', () => {
  test('flattens nested lists and drops false, null and undefined; numbers become text', () => {
    const tree = h(
      'ul',
      {},
      [h('li', {}, 1), [null, undefined, false, h('li', {}, 'two')]],
      'tail',
    );
    expect(tree.children.map((c) => (c.kind === 'text' ? c.text : c.tag))).toEqual([
      'li',
      'li',
      'tail',
    ]);
    expect(tree.children[0]).toEqual({
      kind: 'element',
      tag: 'li',
      props: {},
      children: [{ kind: 'text', text: '1' }],
    });
  });

  test('cls joins the truthy parts', () => {
    expect(cls('a', false, null, undefined, '', 'b')).toBe('a b');
    expect(cls()).toBe('');
  });
});

describe('mount: first render', () => {
  test('creates the tree with attributes, data-tip, properties and listeners', () => {
    const f = setup();
    const out = render(
      f,
      h(
        'div',
        { class: 'app', id: 'app-root' },
        h('input', {
          id: 'name',
          tip: 'Your name',
          attrs: { maxlength: '16', placeholder: 'Name' },
          props: { value: 'Ari', disabled: true },
          on: { input: () => undefined },
        }),
        'text',
      ),
    );
    expect(out).toBe(
      '<div class="app" id="app-root">' +
        '<input data-tip="Your name" id="name" maxlength="16" placeholder="Name" [value=Ari] [disabled] @input>' +
        '</input>text</div>',
    );
  });

  test('an empty class or style is not written', () => {
    const f = setup();
    expect(render(f, h('div', { class: cls(false), style: undefined }))).toBe('<div></div>');
  });
});

describe('mount: patching', () => {
  test('updates changed attributes, removes dropped ones, leaves the element in place', () => {
    const f = setup();
    render(
      f,
      h('div', {}, h('button', { class: 'a', id: 'b', tip: 't', attrs: { 'data-x': '1' } })),
    );
    const before = f.fakeRoot.childNodes[0];
    render(f, h('div', {}, h('button', { class: 'a on', attrs: { 'data-y': '2' } })));
    expect(f.fakeRoot.childNodes[0]).toBe(before);
    expect(f.fakeRoot.childNodes.map(serialize).join('')).toBe(
      '<div><button class="a on" data-y="2"></button></div>',
    );
  });

  test('a dropped property resets to blank, or false for a boolean, once the element has it', () => {
    const f = setup();
    render(
      f,
      h(
        'div',
        {},
        h('input', { props: { value: 'x', checked: true } }),
        h('div', { props: { value: 'ignored' } }),
      ),
    );
    // As in a browser, writing `value` on a div creates the property (an expando).
    expect(f.fakeRoot.childNodes.map(serialize).join('')).toBe(
      '<div><input [value=x] [checked]></input><div [value=ignored]></div></div>',
    );
    render(f, h('div', {}, h('input', {}), h('div', {})));
    expect(f.fakeRoot.childNodes.map(serialize).join('')).toBe(
      '<div><input></input><div></div></div>',
    );
    const [input, plain] = kids(f.fakeRoot.childNodes[0]);
    expect(input && isElement(input) && [input.value, input.checked]).toEqual(['', false]);
    expect(plain && isElement(plain) && plain.value).toBe('');
  });

  test('a property is written only when it differs from the element', () => {
    const f = setup();
    render(f, h('input', { props: { value: 'a' } }));
    const input = f.fakeRoot.childNodes[0] as FakeElement;
    fire(input, 'input', { value: 'typed' });
    // The next render says 'typed' too, so the element is left alone.
    render(f, h('input', { props: { value: 'typed' } }));
    expect(input.value).toBe('typed');
    render(f, h('input', { props: { value: 'reset' } }));
    expect(input.value).toBe('reset');
  });

  test('text nodes are updated in place', () => {
    const f = setup();
    render(f, h('p', {}, 'one'));
    const text = kids(f.fakeRoot.childNodes[0])[0];
    render(f, h('p', {}, 'two'));
    expect(kids(f.fakeRoot.childNodes[0])[0]).toBe(text);
    expect(f.fakeRoot.textContent).toBe('two');
  });

  test('appends new children and removes extra ones, by position', () => {
    const f = setup();
    render(f, h('ul', {}, h('li', {}, 'a'), h('li', {}, 'b'), h('li', {}, 'c')));
    const [a, b] = kids(f.fakeRoot.childNodes[0]);
    render(f, h('ul', {}, h('li', {}, 'a'), h('li', {}, 'B')));
    expect(f.fakeRoot.childNodes.map(serialize).join('')).toBe('<ul><li>a</li><li>B</li></ul>');
    expect(kids(f.fakeRoot.childNodes[0])[0]).toBe(a);
    expect(kids(f.fakeRoot.childNodes[0])[1]).toBe(b);
    render(f, h('ul', {}, h('li', {}, 'a'), h('li', {}, 'B'), h('li', {}, 'c'), h('li', {}, 'd')));
    expect(f.fakeRoot.childNodes.map(serialize).join('')).toBe(
      '<ul><li>a</li><li>B</li><li>c</li><li>d</li></ul>',
    );
  });

  test('a different tag, a different key or a text/element swap replaces the node in place', () => {
    const f = setup();
    render(f, h('div', {}, h('span', { key: 'k1' }, 'x'), 'text', h('i', {})));
    const [span, text, i] = kids(f.fakeRoot.childNodes[0]);
    render(f, h('div', {}, h('span', { key: 'k2' }, 'x'), h('b', {}, 'bold'), 'now text'));
    const after = kids(f.fakeRoot.childNodes[0]);
    expect(after[0]).not.toBe(span);
    expect(after[1]).not.toBe(text);
    expect(after[2]).not.toBe(i);
    expect(f.fakeRoot.childNodes.map(serialize).join('')).toBe(
      '<div><span>x</span><b>bold</b>now text</div>',
    );
    // The same key keeps the element.
    render(
      f,
      h('div', {}, h('span', { key: 'k2', class: 'on' }, 'y'), h('b', {}, 'bold'), 'now text'),
    );
    expect(kids(f.fakeRoot.childNodes[0])[0]).toBe(after[0]);
    expect(f.fakeRoot.childNodes.map(serialize).join('')).toBe(
      '<div><span class="on">y</span><b>bold</b>now text</div>',
    );
  });

  test('the root itself is patched by position too: a new top-level tag replaces the old', () => {
    const f = setup();
    render(f, h('section', { id: 'a' }));
    expect(render(f, h('main', { id: 'b' }))).toBe('<main id="b"></main>');
    expect(f.fakeRoot.childNodes).toHaveLength(1);
  });
});

describe('mount: listeners', () => {
  test('rebinds a handler on every render and removes a dropped one', () => {
    const f = setup();
    const calls: string[] = [];
    render(f, h('button', { id: 'go', on: { click: () => calls.push('first') } }));
    const button = byId(f.fakeRoot, 'go');
    if (button === null) throw new Error('no button');
    fire(button, 'click');
    render(f, h('button', { id: 'go', on: { click: () => calls.push('second') } }));
    fire(button, 'click');
    expect(button.listenerTypes()).toEqual(['click']);
    render(f, h('button', { id: 'go' }));
    fire(button, 'click');
    expect(calls).toEqual(['first', 'second']);
    expect(button.listenerTypes()).toEqual([]);
  });

  test('a handler reads the event it is handed', () => {
    const f = setup();
    const seen: FakeEvent[] = [];
    render(
      f,
      h('div', {}, h('input', { on: { keydown: (e) => seen.push(e as unknown as FakeEvent) } })),
    );
    const input = all(f.fakeRoot, (el) => el.tagName === 'INPUT')[0];
    if (input === undefined) throw new Error('no input');
    fire(input, 'keydown', { key: 'Enter' });
    expect(seen.map((e) => e.key)).toEqual(['Enter']);
  });
});

describe('target helpers', () => {
  test('read value and checked from the event target and blur it', () => {
    const f = setup();
    const values: string[] = [];
    const checks: boolean[] = [];
    render(
      f,
      h('input', {
        on: {
          input: (e) => values.push(targetValue(e)),
          change: (e) => checks.push(targetChecked(e)),
          keydown: (e) => {
            blurTarget(e);
          },
        },
      }),
    );
    const input = f.fakeRoot.childNodes[0] as FakeElement;
    const blurred: string[] = [];
    (input as unknown as Record<string, unknown>)['blur'] = () => blurred.push('blur');
    fire(input, 'input', { value: 'abc' });
    fire(input, 'change', { checked: true });
    fire(input, 'keydown', { key: 'Enter' });
    expect(values).toEqual(['abc']);
    expect(checks).toEqual([true]);
    expect(blurred).toEqual(['blur']);
  });
});
