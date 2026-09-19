// `meldGroupsHtml` (docs/MIGRATION.md step 11) from the legacy multiplayer UI
// (legacy/gin-rummy/index.html, pinned in test/fixtures/legacy/gin-ui.cjs): each meld in its own
// `.meld-group` coloured by position (`m0`..`m4`, cycling), then `extra` markup appended as is.
// Used by the round-result panels and the meld chooser; the hand itself is HandView.ts.
import type { Meld } from '../../engine/types.ts';
import { cardHtml } from '../cards.ts';

/** `m0`..`m4`: the colour class of the meld at `index`. */
export const meldGroupClass = (index: number): string => `meld-group m${String(index % 5)}`;

export const meldGroupsHtml = (melds: ReadonlyArray<Meld>, extra = '', mini = false): string =>
  melds
    .map(
      (m, i) =>
        `<div class="${meldGroupClass(i)}">${m.map((c) => cardHtml(c, { mini })).join('')}</div>`,
    )
    .join('') + extra;
