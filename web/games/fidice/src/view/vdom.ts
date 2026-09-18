// The virtual DOM (docs/MIGRATION.md step 9): typed from legacy/fidice/index.html lines 2340-2425
// (bundle section "// src/view/vdom.ts"); the reconciliation is the same. Screens build trees
// with `h`; `mount` diffs a tree against what the root holds and writes the difference, so this is
// the one view module that touches the DOM (docs/ARCHITECTURE.md "Module boundaries": DOM writes
// only in vdom.ts). Children are matched by position; an element is reused when its tag and `key`
// match, else replaced. Event handlers are re-bound on every render (the screens' closures capture
// the state they were rendered from). The three `target*` helpers hold the casts the screens'
// handlers need on `e.target`, so the screens keep to the readonly event they are handed.

/** A text child. */
export type TextNode = Readonly<{ kind: 'text'; text: string }>;
export type ElementNode = Readonly<{
  kind: 'element';
  tag: string;
  props: Props;
  children: ReadonlyArray<VNode>;
}>;
export type VNode = TextNode | ElementNode;

/** Event handlers by DOM event name, handed the event read-only. */
export type Handlers = Readonly<{
  [K in keyof HTMLElementEventMap]?: (e: Readonly<HTMLElementEventMap[K]>) => void;
}>;

/**
 * What an element carries: `class`, `id`, `style` and `tip` (the `data-tip` tooltip) as
 * attributes, `attrs` for any other attribute, `props` for element properties (`value`,
 * `checked`, `disabled`, `selected`), `on` for listeners and `key` to pair elements across renders.
 */
export type Props = Readonly<{
  class?: string;
  id?: string;
  style?: string | undefined;
  tip?: string;
  key?: string;
  attrs?: Readonly<Record<string, string>>;
  props?: Readonly<Record<string, string | boolean>>;
  on?: Handlers;
}>;

/** What `h` accepts as a child: nodes, text, numbers, nested lists; `false`/null/undefined are dropped. */
export type Child = VNode | string | number | false | null | undefined | ReadonlyArray<Child>;

const isChildren = (c: Child): c is ReadonlyArray<Child> => Array.isArray(c);

const flatten = (children: ReadonlyArray<Child>): ReadonlyArray<VNode> =>
  children.flatMap((c): ReadonlyArray<VNode> => {
    if (c === null || c === undefined || c === false) return [];
    if (typeof c === 'string' || typeof c === 'number') return [{ kind: 'text', text: String(c) }];
    if (isChildren(c)) return flatten(c);
    return [c];
  });

const h = (tag: string, props: Props = {}, ...children: ReadonlyArray<Child>): ElementNode => ({
  kind: 'element',
  tag,
  props,
  children: flatten(children),
});

/** Join the class names that are set; a falsy part is left out. */
const cls = (...parts: ReadonlyArray<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');

/** The listeners bound on an element, by event name. */
type Listeners = Readonly<Record<string, EventListener>>;
type Rendered = Readonly<{ vnode: VNode; listeners: Listeners }>;

/** What each DOM node was last rendered from. */
const RENDERED = new WeakMap<Node, Rendered>();

const setAttribute = (el: Readonly<Element>, name: string, value: string | undefined): void => {
  if (value) el.setAttribute(name, value);
  else el.removeAttribute(name);
};

const setProps = (
  el: Readonly<Element>,
  prev: Props,
  next: Props,
  listeners: Listeners,
): Listeners => {
  if (prev.class !== next.class) setAttribute(el, 'class', next.class);
  if (prev.id !== next.id) setAttribute(el, 'id', next.id);
  if (prev.style !== next.style) setAttribute(el, 'style', next.style);
  if (prev.tip !== next.tip) setAttribute(el, 'data-tip', next.tip);
  const attrNames = new Set([...Object.keys(prev.attrs ?? {}), ...Object.keys(next.attrs ?? {})]);
  attrNames.forEach((name) => {
    const v = next.attrs?.[name];
    if (v === prev.attrs?.[name]) return;
    if (v === undefined) el.removeAttribute(name);
    else el.setAttribute(name, v);
  });
  const propNames = new Set([...Object.keys(prev.props ?? {}), ...Object.keys(next.props ?? {})]);
  const target = el as unknown as Record<string, unknown>;
  propNames.forEach((name) => {
    const v = next.props?.[name];
    if (v === undefined) {
      // A dropped property is reset to its blank (a boolean one to false), when the element has it.
      if (name in target) target[name] = typeof prev.props?.[name] === 'boolean' ? false : '';
      return;
    }
    if (target[name] !== v) target[name] = v;
  });
  const eventNames = new Set([...Object.keys(prev.on ?? {}), ...Object.keys(next.on ?? {})]);
  const nextOn = (next.on ?? {}) as Readonly<Record<string, EventListener | undefined>>;
  return [...eventNames].reduce<Listeners>((acc, name) => {
    const fn = nextOn[name];
    const old = listeners[name];
    if (old) el.removeEventListener(name, old);
    if (fn) el.addEventListener(name, fn);
    return fn ? { ...acc, [name]: fn } : acc;
  }, {});
};

const create = (doc: Readonly<Document>, v: VNode): Node => {
  if (v.kind === 'text') {
    const n = doc.createTextNode(v.text);
    RENDERED.set(n, { vnode: v, listeners: {} });
    return n;
  }
  const el = doc.createElement(v.tag);
  const listeners = setProps(el, {}, v.props, {});
  v.children.forEach((c) => {
    el.appendChild(create(doc, c));
  });
  RENDERED.set(el, { vnode: v, listeners });
  return el;
};

/** Two nodes the reconciler may pair: both text, or elements of one tag and key. */
const sameKind = (a: VNode, b: VNode): boolean =>
  a.kind === 'text'
    ? b.kind === 'text'
    : b.kind === 'element' && a.tag === b.tag && a.props.key === b.props.key;

const reconcile = (doc: Readonly<Document>, node: Readonly<Node>, next: VNode): Node => {
  const record = RENDERED.get(node);
  if (!record || !sameKind(record.vnode, next)) {
    const fresh = create(doc, next);
    node.parentNode?.insertBefore(fresh, node);
    node.parentNode?.removeChild(node);
    return fresh;
  }
  // Readonly<Node> keeps the shared parameter rule on; the two writes below go through this alias.
  const target: Node = node;
  if (next.kind === 'text') {
    const prevText = record.vnode.kind === 'text' ? record.vnode.text : null;
    if (prevText !== next.text) target.textContent = next.text;
    RENDERED.set(target, { vnode: next, listeners: {} });
    return target;
  }
  const el = target as Element;
  const listeners = setProps(
    el,
    record.vnode.kind === 'element' ? record.vnode.props : {},
    next.props,
    record.listeners,
  );
  patchChildren(doc, el, next.children);
  RENDERED.set(target, { vnode: next, listeners });
  return target;
};

const patchChildren = (
  doc: Readonly<Document>,
  parent: Readonly<Element>,
  children: ReadonlyArray<VNode>,
): void => {
  const existing = Array.from(parent.childNodes);
  children.forEach((child, i) => {
    const current = existing[i];
    if (current) reconcile(doc, current, child);
    else parent.appendChild(create(doc, child));
  });
  existing.slice(children.length).forEach((extra: Readonly<ChildNode>) => {
    parent.removeChild(extra);
  });
};

/** Render `tree` into `root`, diffing against the previous render. */
const mount = (doc: Readonly<Document>, root: Readonly<Element>, tree: VNode): void => {
  patchChildren(doc, root, [tree]);
};

/** The `value` of the input or select an event fired on (the legacy `e.target.value`). */
const targetValue = (e: Readonly<Event>): string => (e.target as HTMLInputElement).value;
/** The `checked` state of the checkbox an event fired on. */
const targetChecked = (e: Readonly<Event>): boolean => (e.target as HTMLInputElement).checked;
/** Drop focus from the element an event fired on. */
const blurTarget = (e: Readonly<Event>): void => {
  (e.target as HTMLElement).blur();
};

export { h, cls, mount, targetValue, targetChecked, blurTarget };
