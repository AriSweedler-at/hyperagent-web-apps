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

export const setAttr = (el: Element, name: string, value: string | null): void => {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
};
