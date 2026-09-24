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
  /** A pointer event's place (viewport coordinates) and pointer. */
  clientX?: number;
  clientY?: number;
  pointerId?: number;
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
  /**
   * Elements `queryIn`/`queryAllIn` return for a selector (first for `queryIn`); a function is
   * called on every query, so a test can hand out fresh elements after each re-render as a real
   * DOM would.
   */
  queries?: Readonly<Record<string, ReadonlyArray<FakeEl> | (() => ReadonlyArray<FakeEl>)>>;
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
  /** The `checked` property as `setChecked` wrote it. */
  checked: () => boolean;
  /** `el.remove()` was called. */
  removed: () => boolean;
  /** How many times `scrollIntoView` was called (web/shared/edge/glossary.ts `revealRule`). */
  scrolledInto: () => number;
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
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    pointerId: init.pointerId ?? 0,
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
  const state = {
    content: options.text ?? '',
    value: options.value ?? '',
    removed: false,
    checked: false,
    scrolls: 0,
  };
  const children = options.children ?? [];
  const query = (selector: string): ReadonlyArray<FakeEl> => {
    const found = options.queries?.[selector];
    return typeof found === 'function' ? found() : (found ?? []);
  };
  const queried = (): ReadonlyArray<FakeEl> => Object.keys(options.queries ?? {}).flatMap(query);
  const contains = (node: unknown): boolean =>
    node === el ||
    [...children, ...queried()].some(
      (child) => child.el === node || child.el.contains(node as Node),
    );
  const el = {
    id,
    get value() {
      return state.value;
    },
    set value(v: string) {
      state.value = v;
    },
    get checked() {
      return state.checked;
    },
    set checked(v: boolean) {
      state.checked = v;
    },
    replaceChildren: (...nodes: ReadonlyArray<string>) => {
      state.content = nodes.join('');
    },
    insertAdjacentHTML: (position: string, markup: string) => {
      state.content = position === 'beforeend' ? state.content + markup : markup + state.content;
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
    querySelector: (selector: string) => query(selector)[0]?.el ?? null,
    querySelectorAll: (selector: string) => query(selector).map((c) => c.el),
    contains,
    get children() {
      return children.map((c) => c.el);
    },
    remove: () => {
      state.removed = true;
    },
    scrollIntoView: () => {
      state.scrolls += 1;
    },
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
    checked: () => state.checked,
    removed: () => state.removed,
    scrolledInto: () => state.scrolls,
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

// ---- a page from its markup -----------------------------------------------------------------------
// The two shell pages' fixtures (web/games/<g>/src/ui/page.fake.ts) built the same page from the
// same regular expressions (docs/design/shared-shell.md §5 B1): one fake element per `id="…"` in
// the page's markup, with the classes, attributes and the input value as the markup has them, so a
// fixture cannot drift from its page. This is backgammon's richer version (data attributes and the
// boolean `disabled`/`checked` the controls ship with); each game's fixture now declares only the
// children the paint reaches through queries and the mode buttons its switch carries.

const TAG = /<(\w+)([^>]*?)\bid="([^"]+)"([^>]*)>/g;

const attrOf = (attrs: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

/**
 * The `data-*` attributes of a tag, as written (`data-abs`, `data-own`, `data-seat`, `data-owner`),
 * and the boolean `disabled`/`checked` the controls ship with (`#undoBtn`, `#menuCurtainToggle`).
 */
const markupAttrsOf = (attrs: string): Readonly<Record<string, string>> => ({
  ...Object.fromEntries(
    [...attrs.matchAll(/\b(data-[\w-]+)="([^"]*)"/g)].map((m: Readonly<RegExpExecArray>) => [
      m[1] ?? '',
      m[2] ?? '',
    ]),
  ),
  ...(/\bdisabled\b/.test(attrs) ? { disabled: '' } : {}),
  ...(/\bchecked\b/.test(attrs) ? { checked: '' } : {}),
});

/** `id -> options` from the markup: classes, value, title and data attributes as written. */
export const optionsFromMarkup = (markup: string): ReadonlyMap<string, FakeElOptions> =>
  new Map(
    [...markup.matchAll(TAG)].map((m: Readonly<RegExpExecArray>) => {
      const attrs = `${m[2] ?? ''} ${m[4] ?? ''}`;
      const classes = attrOf(attrs, 'class');
      const value = attrOf(attrs, 'value');
      const title = attrOf(attrs, 'title');
      return [
        m[3] ?? '',
        {
          classes: classes === undefined ? [] : classes.split(/\s+/).filter((c) => c !== ''),
          ...(value === undefined ? {} : { value }),
          attrs: { ...markupAttrsOf(attrs), ...(title === undefined ? {} : { title }) },
        },
      ];
    }),
  );

/**
 * The mode buttons the home paint reaches through `#playModeSwitch .mode-btn` and
 * `#playSubmenu button[data-mode]`, which carry no ids in either page: one fake per mode named
 * `<prefix>-<mode>` with `data-mode`, wearing the classes `classesFor` gives it (gin hides its
 * `sandbox` mode; backgammon's switch ships `online` as `active`).
 */
export const modeButtons = (
  prefix: string,
  modes: ReadonlyArray<string>,
  classesFor: (mode: string) => ReadonlyArray<string> = () => [],
): ReadonlyArray<FakeEl> =>
  modes.map((mode) =>
    fakeEl(`${prefix}-${mode}`, { classes: [...classesFor(mode)], attrs: { 'data-mode': mode } }),
  );

/**
 * Every element of a page, from its markup: `declared` adds queries or children to an id the
 * fixture always needs (its classes and value still come from the markup), `extra` the same for one
 * test, and `more` adds elements the markup has no id for (the mode buttons, a strip found by class).
 */
export const pageFromMarkup = (
  markup: string,
  declared: Readonly<Record<string, FakeElOptions>>,
  extra: Readonly<Record<string, FakeElOptions>> = {},
  more: ReadonlyArray<FakeEl> = [],
): FakePage => {
  const fromMarkup = optionsFromMarkup(markup);
  // Elements other ids declare as children are created first so the parents can reference them.
  const plain = [...fromMarkup.keys()].filter((id) => !(id in declared) && !(id in extra));
  const plainEls = new Map(plain.map((id) => [id, fakeEl(id, fromMarkup.get(id))]));
  const withChildren = (id: string, options: FakeElOptions): FakeEl =>
    fakeEl(id, { ...fromMarkup.get(id), ...options });
  const composed = [...fromMarkup.keys()]
    .filter((id) => id in declared || id in extra)
    .map((id) => withChildren(id, { ...declared[id], ...extra[id] }));
  return fakePage([...plainEls.values(), ...composed, ...more]);
};
