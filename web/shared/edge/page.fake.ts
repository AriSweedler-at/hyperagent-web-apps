// A structural fake of a static page for the modules that paint through dom.ts (docs/MIGRATION.md
// step 12: the gin table, home screen, curtain and Score Counter). Where dom.fake.ts models a tree
// a reconciler builds, this models what a page's markup already holds: elements found by id, each
// with a class list, attributes, a text-or-markup content kept as a string (no HTML parsing, so a
// test asserts on the markup a paint wrote), an input value, inline style properties and event
// listeners. `fire` dispatches a synthetic event on an element, or on a target the test describes
// (what `closest` finds, the target's id and value), so delegated handlers are reached too.
// Children the paint queries (`queryIn`, `queryAllIn`) and containment (`contains`) are declared
// by the test, not derived from markup. jsdom is not installed (docs/ARCHITECTURE.md "Testing
// pyramid"). Mutable state lives in closures behind readonly records, as in the other fakes.

/** A fired event, typed as the `Readonly<Event>` the handlers take, plus what a test reads back. */
export type FakeEvent = Readonly<Event> &
  Readonly<{ wasPrevented: () => boolean; wasStopped: () => boolean }>;

/** What a fired event may carry; `target` defaults to the element fired on. */
export type FireInit = Readonly<{
  target?: unknown;
  key?: string;
  inputType?: string;
  data?: string;
}>;

/** How a test describes the target of a delegated event: what `closest` finds, an id, a value. */
export type FakeTargetSpec = Readonly<{
  closest?: Readonly<Record<string, FakeEl>>;
  id?: string;
  value?: string;
}>;

export type FakeElOptions = Readonly<{
  classes?: ReadonlyArray<string>;
  attrs?: Readonly<Record<string, string>>;
  text?: string;
  value?: string;
  /** Elements `queryIn`/`queryAllIn` return for a selector (first for `queryIn`). */
  queries?: Readonly<Record<string, ReadonlyArray<FakeEl>>>;
  /** Elements `contains` reports as inside this one (and their own children). */
  children?: ReadonlyArray<FakeEl>;
}>;

export type FakeEl = Readonly<{
  id: string;
  /** The element as dom.ts types it. */
  el: HTMLElement;
  classes: () => ReadonlyArray<string>;
  hasClass: (name: string) => boolean;
  /** `hidden` class present (the legacy show/hide convention). */
  hidden: () => boolean;
  attr: (name: string) => string | null;
  /** The content: text nodes and markup, joined. */
  text: () => string;
  value: () => string;
  style: (name: string) => string | null;
  disabled: () => boolean;
  /** Event types with a listener, in registration order. */
  listenerTypes: () => ReadonlyArray<string>;
  fire: (type: string, init?: FireInit) => FakeEvent;
}>;

type Listener = (e: Readonly<Event>) => void;

const makeEvent = (type: string, target: unknown, init: FireInit): FakeEvent => {
  const flags = { prevented: false, stopped: false };
  const event = {
    type,
    target,
    key: init.key ?? '',
    inputType: init.inputType ?? '',
    data: init.data ?? null,
    preventDefault: () => {
      flags.prevented = true;
    },
    stopPropagation: () => {
      flags.stopped = true;
    },
    wasPrevented: () => flags.prevented,
    wasStopped: () => flags.stopped,
  };
  return event as unknown as FakeEvent;
};

const dispatchTo = (
  listeners: ReadonlyMap<string, ReadonlyArray<Listener>>,
  type: string,
  event: FakeEvent,
): void => {
  [...(listeners.get(type) ?? [])].forEach((fn) => {
    fn(event);
  });
};

/** A target for a delegated event, from what the test says `closest` should find. */
export const fakeTarget = (spec: FakeTargetSpec): unknown => ({
  id: spec.id ?? '',
  value: spec.value ?? '',
  closest: (selector: string) => spec.closest?.[selector]?.el ?? null,
});

export const fakeEl = (id: string, options: FakeElOptions = {}): FakeEl => {
  const classes = new Set<string>(options.classes ?? []);
  const attrs = new Map<string, string>(Object.entries(options.attrs ?? {}));
  const styles = new Map<string, string>();
  const listeners = new Map<string, Listener[]>();
  const state = { content: options.text ?? '', value: options.value ?? '' };
  const children = options.children ?? [];
  const queried = Object.values(options.queries ?? {}).flat();
  const contains = (node: unknown): boolean =>
    node === el ||
    [...children, ...queried].some((child) => child.el === node || child.el.contains(node as Node));
  const el = {
    id,
    get value() {
      return state.value;
    },
    set value(v: string) {
      state.value = v;
    },
    replaceChildren: (...nodes: ReadonlyArray<string>) => {
      state.content = nodes.join('');
    },
    insertAdjacentHTML: (_position: string, markup: string) => {
      state.content = markup + state.content;
    },
    classList: {
      add: (...names: ReadonlyArray<string>) => {
        names.forEach((n) => classes.add(n));
      },
      remove: (...names: ReadonlyArray<string>) => {
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
    getAttribute: (name: string) => attrs.get(name) ?? null,
    removeAttribute: (name: string) => {
      attrs.delete(name);
    },
    hasAttribute: (name: string) => attrs.has(name),
    style: {
      setProperty: (name: string, value: string) => {
        styles.set(name, value);
      },
    },
    querySelector: (selector: string) => options.queries?.[selector]?.[0]?.el ?? null,
    querySelectorAll: (selector: string) => (options.queries?.[selector] ?? []).map((c) => c.el),
    contains,
    closest: () => null,
    select: () => undefined,
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    scrollHeight: 0,
    clientHeight: 0,
  };
  const fire = (type: string, init: FireInit = {}): FakeEvent => {
    const event = makeEvent(type, init.target ?? el, init);
    dispatchTo(listeners, type, event);
    return event;
  };
  return {
    id,
    el: el as unknown as HTMLElement,
    classes: () => [...classes],
    hasClass: (name) => classes.has(name),
    hidden: () => classes.has('hidden'),
    attr: (name) => attrs.get(name) ?? null,
    text: () => state.content,
    value: () => state.value,
    style: (name) => styles.get(name) ?? null,
    disabled: () => attrs.has('disabled'),
    listenerTypes: () => [...listeners.keys()],
    fire,
  };
};

/** The page as dom.ts's `PageLike`, over elements by id, plus document-level listeners. */
export type FakePage = Readonly<{
  doc: Readonly<{
    getElementById: (id: string) => HTMLElement | null;
    body: HTMLElement;
    addEventListener: (type: string, fn: Listener) => void;
  }>;
  body: FakeEl;
  /** The element with `id`, which the fake must hold. */
  get: (id: string) => FakeEl;
  /** Dispatch on the document itself (the legacy's document-level click listener). */
  fire: (type: string, init?: FireInit) => FakeEvent;
}>;

export const fakePage = (elements: ReadonlyArray<FakeEl>): FakePage => {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const body = fakeEl('body');
  const listeners = new Map<string, Listener[]>();
  return {
    doc: {
      getElementById: (id) => byId.get(id)?.el ?? null,
      body: body.el,
      addEventListener: (type, fn) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
    },
    body,
    get: (id) => {
      const found = byId.get(id);
      if (found === undefined) throw new Error(`fake page has no #${id}`);
      return found;
    },
    fire: (type, init = {}) => {
      const event = makeEvent(type, init.target ?? null, init);
      dispatchTo(listeners, type, event);
      return event;
    },
  };
};
