// The home screen's DOM (docs/MIGRATION.md step 12; docs/ARCHITECTURE.md "Module boundaries":
// ui/ reaches the document only through @shared/edge/dom). The legacy page (legacy/gin-rummy/
// index.html) wrote the home screen from `initHome`, `setHomeTab`, `renderPlayMode` and the
// handlers registered at DOMContentLoaded; here the paint reads the App (ui/state.ts) and the
// wiring turns each control into an intent. The two input writes that are not a paint (the saved
// name at `initHome`, the sanitised room code as it is typed) are effects the reducer raises and
// main.ts runs through `fillNameInputs` / `setCodeInput`, so the paint never overwrites what the
// player is typing.
import { requireId, setValue, type DocumentLike } from '../../../../shared/edge/dom.ts';

/** `initHome`: the saved name into `#nameInput` and `#p1NameInput`. */
export const fillNameInputs = (doc: DocumentLike, name: string): void => {
  setValue(requireId(doc, 'nameInput'), name);
  setValue(requireId(doc, 'p1NameInput'), name);
};

/** `#codeInput` after the reducer sanitised what was typed. */
export const setCodeInput = (doc: DocumentLike, value: string): void => {
  setValue(requireId(doc, 'codeInput'), value);
};

/** The invite `#shareCodeBtn` shares; `pageUrl` is the page's URL without its query. */
export const inviteText = (code: string, pageUrl: string): string =>
  `Join my Gin Rummy game — room code ${code}. Open ${pageUrl} and tap Join.`;
