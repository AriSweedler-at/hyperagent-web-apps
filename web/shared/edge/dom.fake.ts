// A structural fake of the DOM members a virtual-DOM reconciler touches (docs/ARCHITECTURE.md
// "Testing pyramid": jsdom is not installed, so view tests run on this, as dom.test.ts runs on its
// own fake). It models a document that creates elements and text nodes; elements with a parent, a
// live child list, attributes, event listeners that bubble, and the four form properties the
// fidice reconciler writes (`value`, `checked`, `disabled`, `selected`) on the tags a browser gives
// them; text nodes with a writable `textContent`. `serialize` prints a tree deterministically
// (attributes sorted, form properties and listener names shown) so two renders can be compared as
// strings; `fire` dispatches an event with bubbling and returns it. Nothing here needs layout.
// Mutable state lives in closures and a WeakMap behind readonly records, as in transport.fake.ts.

export type FakeEvent = Readonly<{
  type: string;
  target: FakeElement;
  /** `KeyboardEvent.key`; '' for other events. */
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
  defaultPrevented: () => boolean;
  propagationStopped: () => boolean;
}>;

export type FakeListener = (e: FakeEvent) => void;

export type FakeText = Readonly<{
  nodeType: 3;
  parentNode: FakeElement | null;
  /** Readable and, as on a DOM Text node, writable. */
  textContent: string;
}>;

/** The form properties the reconciler may write; present only on the tags a browser gives them. */
export type FormProps = Readonly<{
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  selected?: boolean;
}>;

export type FakeElement = Readonly<{
  nodeType: 1;
  /** Upper-case, as `Element.tagName`. */
  tagName: string;
  parentNode: FakeElement | null;
  /** The live child list (`Array.from` copies it, as the reconciler does). */
  childNodes: ReadonlyArray<FakeNode>;
  /** The concatenated text of every descendant text node. */
  textContent: string;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  /** Attribute names and values, in insertion order. */
  attributes: () => ReadonlyMap<string, string>;
  appendChild: (child: FakeNode) => FakeNode;
  insertBefore: (child: FakeNode, before: FakeNode | null) => FakeNode;
  removeChild: (child: FakeNode) => FakeNode;
  addEventListener: (type: string, fn: FakeListener) => void;
  removeEventListener: (type: string, fn: FakeListener) => void;
  /** The event types with at least one listener, in first-registration order. */
  listenerTypes: () => ReadonlyArray<string>;
}> &
  FormProps;

export type FakeNode = FakeText | FakeElement;

export type FakeDocument = Readonly<{
  createElement: (tag: string) => FakeElement;
  createTextNode: (text: string) => FakeText;
}>;

/** Which tags carry which form properties (the `name in target` test in the reconciler). */
const FORM_PROPS: Readonly<Record<string, FormProps>> = {
  input: { value: '', checked: false, disabled: false },
  select: { value: '', disabled: false },
  option: { value: '', selected: false, disabled: false },
  button: { value: '', disabled: false },
  textarea: { value: '', disabled: false },
};

const PARENT = new WeakMap<FakeNode, FakeElement>();
const LISTENERS = new WeakMap<FakeElement, Map<string, FakeListener[]>>();

export const isElement = (node: FakeNode): node is FakeElement => node.nodeType === 1;

const newText = (initial: string): FakeText => {
  const state = { text: initial };
  const node: FakeText = {
    nodeType: 3,
    get parentNode() {
      return PARENT.get(node) ?? null;
    },
    get textContent() {
      return state.text;
    },
    set textContent(value: string) {
      state.text = value;
    },
  };
  return node;
};

const newElement = (tag: string): FakeElement => {
  const attrs = new Map<string, string>();
  const children: FakeNode[] = [];
  const listeners = new Map<string, FakeListener[]>();
  const detach = (child: FakeNode): void => {
    const at = children.indexOf(child);
    if (at < 0) throw new Error(`removeChild: not a child of <${tag}>`);
    children.splice(at, 1);
    PARENT.delete(child);
  };
  const el: FakeElement = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    get parentNode() {
      return PARENT.get(el) ?? null;
    },
    get childNodes() {
      return children;
    },
    get textContent() {
      return children.map((c) => c.textContent).join('');
    },
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => {
      attrs.set(name, value);
    },
    removeAttribute: (name) => {
      attrs.delete(name);
    },
    attributes: () => attrs,
    appendChild: (child) => {
      if (child.parentNode !== null) child.parentNode.removeChild(child);
      children.push(child);
      PARENT.set(child, el);
      return child;
    },
    insertBefore: (child, before) => {
      if (before === null) return el.appendChild(child);
      if (child.parentNode !== null) child.parentNode.removeChild(child);
      const at = children.indexOf(before);
      if (at < 0) throw new Error(`insertBefore: reference is not a child of <${tag}>`);
      children.splice(at, 0, child);
      PARENT.set(child, el);
      return child;
    },
    removeChild: (child) => {
      detach(child);
      return child;
    },
    addEventListener: (type, fn) => {
      const list = listeners.get(type) ?? [];
      if (!list.includes(fn)) listeners.set(type, [...list, fn]);
    },
    removeEventListener: (type, fn) => {
      const list = listeners.get(type) ?? [];
      const kept = list.filter((f) => f !== fn);
      if (kept.length === 0) listeners.delete(type);
      else listeners.set(type, kept);
    },
    listenerTypes: () => [...listeners.keys()],
    ...(FORM_PROPS[tag] ?? {}),
  };
  LISTENERS.set(el, listeners);
  return el;
};

export const fakeDocument = (): FakeDocument => ({
  createElement: newElement,
  createTextNode: newText,
});

/**
 * Dispatch an event on `target` and let it bubble to its ancestors, calling each element's
 * listeners of that type in registration order, until one calls `stopPropagation`. `init.value`
 * and `init.checked` are written to the target first, as typing or ticking would do.
 */
export const fire = (
  target: FakeElement,
  type: string,
  init: Readonly<{ key?: string; value?: string; checked?: boolean }> = {},
): FakeEvent => {
  const writable = target as unknown as Record<string, unknown>;
  if (init.value !== undefined) writable['value'] = init.value;
  if (init.checked !== undefined) writable['checked'] = init.checked;
  const flags = { prevented: false, stopped: false };
  const event: FakeEvent = {
    type,
    target,
    key: init.key ?? '',
    preventDefault: () => {
      flags.prevented = true;
    },
    stopPropagation: () => {
      flags.stopped = true;
    },
    defaultPrevented: () => flags.prevented,
    propagationStopped: () => flags.stopped,
  };
  const bubble = (node: FakeElement | null): void => {
    if (node === null || flags.stopped) return;
    [...(LISTENERS.get(node)?.get(type) ?? [])].forEach((fn) => {
      fn(event);
    });
    bubble(node.parentNode);
  };
  bubble(target);
  return event;
};

const FORM_PROP_NAMES: ReadonlyArray<keyof FormProps> = [
  'value',
  'checked',
  'disabled',
  'selected',
];

/**
 * A deterministic rendering of a tree: `<tag a="1" b="2" [checked] [value=x] @click>...</tag>`,
 * attributes sorted by name, form properties shown when they differ from their defaults,
 * listener types in registration order. Text is printed as is.
 */
export const serialize = (node: FakeNode): string => {
  if (!isElement(node)) return node.textContent;
  const attributes = node.attributes();
  const attrs = [...attributes.keys()]
    .sort()
    .map((name) => ` ${name}="${attributes.get(name) ?? ''}"`)
    .join('');
  const props = FORM_PROP_NAMES.flatMap((name) => {
    const v = node[name];
    if (v === undefined || v === false || v === '') return [];
    return v === true ? [` [${name}]`] : [` [${name}=${v}]`];
  }).join('');
  const on = node
    .listenerTypes()
    .map((type) => ` @${type}`)
    .join('');
  const tag = node.tagName.toLowerCase();
  return `<${tag}${attrs}${props}${on}>${node.childNodes.map(serialize).join('')}</${tag}>`;
};

/** Every element under `root` (root included) in document order that satisfies `pred`. */
export const all = (
  root: FakeNode,
  pred: (el: FakeElement) => boolean = () => true,
): ReadonlyArray<FakeElement> =>
  isElement(root)
    ? [...(pred(root) ? [root] : []), ...root.childNodes.flatMap((c) => all(c, pred))]
    : [];

export const byId = (root: FakeNode, id: string): FakeElement | null =>
  all(root, (el) => el.getAttribute('id') === id)[0] ?? null;

export const classesOf = (el: FakeElement): ReadonlyArray<string> =>
  (el.getAttribute('class') ?? '').split(' ').filter((c) => c !== '');

export const hasClass = (el: FakeElement, className: string): boolean =>
  classesOf(el).includes(className);

export const byClass = (root: FakeNode, className: string): ReadonlyArray<FakeElement> =>
  all(root, (el) => hasClass(el, className));
