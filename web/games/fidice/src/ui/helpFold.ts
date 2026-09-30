// The steps' help fold (docs/design/space-audit.md §5 "Closed by fidice-sideways-fold"): sideways
// on a phone the theme hides the steps' explanatory paragraphs (theme.css
// `body[data-layout^="phone-sideways"]:not(.fidice-help) #tableEl .step p`) and a tap on a step's
// title shows every step's paragraph, a second tap hides them again. The class lives on the body
// for the page's session, outside the vdom's root (`#app-root`), so the legacy view's re-renders
// keep the choice; the legacy view itself is untouched (test/parity/fidice.view.test.ts pins its
// tree and handlers to the legacy page's). Elsewhere the paragraphs show and the class is idle.
// The shapes below are the DOM's, spelled structurally as this folder does (no DOM lib here).

/** The body class the theme reads. */
export const HELP_CLASS = 'fidice-help';

/** The step titles (view/screens/table.ts `stepHeader`), inside `#fidiceTable`. */
export const STEP_TITLE = '.actions .step h4';

type Target = Readonly<{ closest: (selector: string) => unknown }>;
export type ClickEvent = Readonly<{ target: unknown }>;
export type Mount = Readonly<{
  addEventListener: (type: 'click', handler: (e: ClickEvent) => void) => void;
}>;
export type HelpDoc = Readonly<{
  getElementById: (id: string) => Mount | null;
  body: Readonly<{ classList: Readonly<{ toggle: (name: string) => boolean }> }>;
}>;

const isTarget = (t: unknown): t is Target =>
  typeof t === 'object' && t !== null && typeof (t as Partial<Target>).closest === 'function';

/**
 * One delegated listener on the table's mount (`#fidiceTable`, the shell page's): a tap whose
 * target is in a step's title toggles the class. Returns whether the mount was there to bind.
 */
export const bindHelpFold = (doc: HelpDoc): boolean => {
  const mount = doc.getElementById('fidiceTable');
  if (mount === null) return false;
  mount.addEventListener('click', (e) => {
    if (isTarget(e.target) && e.target.closest(STEP_TITLE) !== null)
      doc.body.classList.toggle(HELP_CLASS);
  });
  return true;
};
