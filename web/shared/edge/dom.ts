// The DOM edge for ui/ and view/ modules (docs/ARCHITECTURE.md "Module boundaries": render code
// reaches the document only through here). Typed element lookup, class toggles and text setters,
// and one deliberate rule about markup: only a `SafeHtml` is ever written as HTML, and the
// `safeHtml` template tag builds one by escaping every interpolation, so untrusted text (a
// player's name, a wire frame) cannot become markup.
//
// Elements are taken as `Readonly<HTMLElement>` and changed through their methods
// (`replaceChildren`, `toggleAttribute`, `classList`, `insertAdjacentHTML`) rather than property
// writes, which keeps the shared readonly-parameter rule on in this module too. (The tag is not
// called `html` because Prettier reformats the markup inside templates with that name.)

/** Markup that is safe to write as HTML: built only by `safeHtml` and `trustedHtml`. */
export type SafeHtml = Readonly<{ kind: 'safe-html'; markup: string }>;

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** The legacy `esc()`: the five characters that matter in text and attribute positions. */
export const escapeHtml = (text: unknown): string =>
  String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

const isSafeHtml = (value: unknown): value is SafeHtml =>
  typeof value === 'object' &&
  value !== null &&
  (value as Partial<SafeHtml>).kind === 'safe-html' &&
  typeof (value as Partial<SafeHtml>).markup === 'string';

/**
 * Tagged template: literal parts pass through, interpolations are escaped unless they are already
 * `SafeHtml` (nesting) or arrays of either (fragments joined with no separator).
 */
export const safeHtml = (
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<unknown>
): SafeHtml => {
  const render = (value: unknown): string =>
    Array.isArray(value)
      ? (value as ReadonlyArray<unknown>).map(render).join('')
      : isSafeHtml(value)
        ? value.markup
        : escapeHtml(value);
  const markup = strings.reduce(
    (acc, literal, i) => acc + literal + (i < values.length ? render(values[i]) : ''),
    '',
  );
  return { kind: 'safe-html', markup };
};

/**
 * Mark markup the program itself wrote (a static template, `ui/rules.ts`) as safe. Never call it
 * on anything that came from a user, a peer or storage.
 */
export const trustedHtml = (markup: string): SafeHtml => ({ kind: 'safe-html', markup });

/** The one member of `Document` this module needs. */
export type DocumentLike = Readonly<{ getElementById: (id: string) => HTMLElement | null }>;

/** The legacy `$()`: an element by id, or null. */
export const byId = (doc: DocumentLike, id: string): Element | null => doc.getElementById(id);

/**
 * An element by id that the page must hold (its markup is part of the contract, see
 * web/shared/styles/CONTRACT.md); a missing one is a programming error and throws.
 */
export const requireId = (doc: DocumentLike, id: string): Element => {
  const el = doc.getElementById(id);
  if (el === null) throw new Error(`missing element #${id}`);
  return el;
};

/** An element to write to. Real elements are mutable; this module only calls their methods. */
export type Element = Readonly<HTMLElement>;

/** Replace the element's content with a text node (what `textContent = text` does). */
export const setText = (el: Element, text: string): void => {
  el.replaceChildren(text);
};

/** Replace the element's content with parsed markup (what `innerHTML = markup` does). */
export const setHtml = (el: Element, markup: SafeHtml): void => {
  el.replaceChildren();
  el.insertAdjacentHTML('afterbegin', markup.markup);
};

export const clear = (el: Element): void => {
  el.replaceChildren();
};

/** Append parsed markup after the element's last child (`insertAdjacentHTML('beforeend')`). */
export const appendHtml = (el: Element, markup: SafeHtml): void => {
  el.insertAdjacentHTML('beforeend', markup.markup);
};

/** `el.remove()`. */
export const removeElement = (el: Element): void => {
  el.remove();
};

/** `el.children.length`. */
export const childCount = (el: Element): number => el.children.length;

/** Add or remove `className` according to `on` (the third argument of classList.toggle). */
export const toggleClass = (el: Element, className: string, on: boolean): void => {
  el.classList.toggle(className, on);
};

export const addClass = (el: Element, ...classNames: ReadonlyArray<string>): void => {
  el.classList.add(...classNames);
};

export const removeClass = (el: Element, ...classNames: ReadonlyArray<string>): void => {
  el.classList.remove(...classNames);
};

export const hasClass = (el: Element, className: string): boolean =>
  el.classList.contains(className);

/** The `hidden` attribute, the legacy show/hide convention. */
export const setHidden = (el: Element, hidden: boolean): void => {
  el.toggleAttribute('hidden', hidden);
};

export const setDisabled = (el: Element, disabled: boolean): void => {
  el.toggleAttribute('disabled', disabled);
};

/** A checkbox's `checked` property (the attribute would only set its default). */
export const setChecked = (el: Element, checked: boolean): void => {
  const input = el as HTMLInputElement;
  input.checked = checked;
};

export const setAttr = (el: Element, name: string, value: string | null): void => {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
};

// ---- values, styles and queries (docs/MIGRATION.md step 12: the gin paint and its wiring) ----

/** The `value` of an input (the legacy `el.value`). */
export const readValue = (el: Element): string => (el as HTMLInputElement).value;

/** `el.value = value`, written only when it differs so the caret is left alone. */
export const setValue = (el: Element, value: string): void => {
  const input = el as HTMLInputElement;
  if (input.value !== value) input.value = value;
};

/** `input.select()` where the element has it (the legacy `input.select && input.select()`). */
export const selectText = (el: Element): void => {
  const input = el as Partial<HTMLInputElement>;
  input.select?.call(el);
};

/** `el.dataset.<name>` read as the attribute it is (`dataOf(el, 'meld-opt')` for `data-meld-opt`). */
export const dataOf = (el: Element, name: string): string | null => el.getAttribute(`data-${name}`);

export const isDisabled = (el: Element): boolean => el.hasAttribute('disabled');

/** `el.querySelector(selector)` inside `el`. */
export const queryIn = (el: Element, selector: string): Element | null =>
  el.querySelector<HTMLElement>(selector);

/** `el.querySelectorAll(selector)` inside `el`, as an array. */
export const queryAllIn = (el: Element, selector: string): ReadonlyArray<Element> =>
  Array.from(el.querySelectorAll<HTMLElement>(selector));

// ---- events -------------------------------------------------------------------------------------

/** Anything with `addEventListener`: an element, the document or the window. */
export type Listenable = Readonly<{
  addEventListener: (
    type: string,
    listener: (e: Readonly<Event>) => void,
    options?: boolean | Readonly<AddEventListenerOptions>,
  ) => void;
}>;

/** The document as the paint and the wiring see it: lookup by id, the body, and listeners. */
export type PageLike = DocumentLike & Listenable & Readonly<{ body: Element }>;

export type Handler = (e: Readonly<Event>) => void;

/** `target.addEventListener(type, handler, options)`. */
export const listen = (
  target: Listenable,
  type: string,
  handler: Handler,
  options?: boolean | Readonly<AddEventListenerOptions>,
): void => {
  target.addEventListener(type, handler, options);
};

/** `listen` on the element with `id`, which the page must hold. */
export const listenId = (doc: DocumentLike, id: string, type: string, handler: Handler): void => {
  listen(requireId(doc, id), type, handler);
};

// The casts the handlers need on `e.target` live here, as fidice's view/vdom.ts keeps its
// `target*` helpers, so the ui/ modules are written against a `Readonly<Event>`.
type TargetLike = Partial<
  Readonly<{
    id: string;
    value: string;
    closest: (selector: string) => HTMLElement | null;
  }>
>;
const targetOf = (e: Readonly<Event>): TargetLike | null => e.target as TargetLike | null;

/** `e.target.closest(selector)`, or null when the target is not an element or nothing matches. */
export const closestFrom = (e: Readonly<Event>, selector: string): Element | null =>
  targetOf(e)?.closest?.(selector) ?? null;

/** `e.target.id` (the overlays close when their backdrop, not their sheet, is tapped). */
export const targetIdOf = (e: Readonly<Event>): string => targetOf(e)?.id ?? '';

/** `e.target.value` of the input the event fired on. */
export const targetValueOf = (e: Readonly<Event>): string => targetOf(e)?.value ?? '';

/** `container.contains(e.target)`. */
export const isWithin = (container: Element, e: Readonly<Event>): boolean =>
  container.contains(e.target as Node | null);

/** `InputEvent.inputType`, '' for other events. */
export const inputTypeOf = (e: Readonly<Event>): string =>
  (e as Partial<InputEvent>).inputType ?? '';

/** `InputEvent.data`, null when absent. */
export const inputDataOf = (e: Readonly<Event>): string | null =>
  (e as Partial<InputEvent>).data ?? null;

/** `KeyboardEvent.key`, '' for other events. */
export const keyOf = (e: Readonly<Event>): string => (e as Partial<KeyboardEvent>).key ?? '';

export const preventDefault = (e: Readonly<Event>): void => {
  e.preventDefault();
};

export const stopPropagation = (e: Readonly<Event>): void => {
  e.stopPropagation();
};

// ---- geometry, styles, clones, frames and pointers (the hand's drag and FLIP: ui/hand/dragger.ts, flip.ts) ----

export type Rect = Readonly<{ left: number; top: number; width: number; height: number }>;

/** `getBoundingClientRect()` as a plain rect; all zeros where the element cannot be measured (a fake). */
export const rectOf = (el: Element): Rect => {
  const measured = el as Partial<Pick<HTMLElement, 'getBoundingClientRect'>>;
  const r = measured.getBoundingClientRect?.call(el);
  return r === undefined
    ? { left: 0, top: 0, width: 0, height: 0 }
    : { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** `el.style.setProperty(prop, value)`; an empty value removes the inline property. Nothing on a fake. */
export const setStyle = (el: Element, prop: string, value: string): void => {
  const styled = el as Partial<Pick<HTMLElement, 'style'>>;
  styled.style?.setProperty(prop, value);
};

/** A deep clone of `el`, appended to `parent`. */
export const cloneInto = (parent: Element, el: Element): Element => {
  const copy = el.cloneNode(true) as HTMLElement;
  parent.appendChild(copy);
  return copy;
};

/** `el.closest(selector)` from the element itself. */
export const closestIn = (el: Element, selector: string): Element | null => el.closest(selector);

/** `requestAnimationFrame(fn)` where there is one; nothing on a fake. */
export const nextFrame = (fn: () => void): void => {
  const frames = globalThis as Partial<Pick<typeof globalThis, 'requestAnimationFrame'>>;
  frames.requestAnimationFrame?.(() => {
    fn();
  });
};

/** `fn` once, when `el`'s transition ends or after `fallbackMs` if it never does. */
export const afterTransition = (el: Element, fn: () => void, fallbackMs: number): void => {
  const cell = { done: false };
  const once = (): void => {
    if (cell.done) return;
    cell.done = true;
    fn();
  };
  listen(el, 'transitionend', once, { once: true });
  setTimeout(once, fallbackMs);
};

/** Where a pointer event is (viewport coordinates) and which pointer it is. */
export type PointerAt = Readonly<{ x: number; y: number; id: number }>;
export const pointerOf = (e: Readonly<Event>): PointerAt => {
  const p = e as Partial<PointerEvent>;
  return { x: p.clientX ?? 0, y: p.clientY ?? 0, id: p.pointerId ?? 0 };
};

/** `el.setPointerCapture(id)` / `releasePointerCapture(id)`; a pointer already gone is no error. */
export const capturePointer = (el: Element, id: number): void => {
  const target = el as Partial<Pick<HTMLElement, 'setPointerCapture'>>;
  try {
    target.setPointerCapture?.call(el, id);
  } catch {
    // The pointer was released before the capture: nothing to hold.
  }
};
export const releasePointer = (el: Element, id: number): void => {
  const target = el as Partial<Pick<HTMLElement, 'releasePointerCapture'>>;
  try {
    target.releasePointerCapture?.call(el, id);
  } catch {
    // Not captured: nothing to release.
  }
};
