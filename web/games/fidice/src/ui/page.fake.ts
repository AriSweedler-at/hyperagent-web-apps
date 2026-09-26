// The fidice page as a page fake for the tests beside ui/{render,home,local,waiting}.ts
// (docs/design/fidice-shell-adoption.md §4 M4; briscola's ui/page.fake.ts is the shape): the shell
// page (web/shared/edge/page.fake.ts `shellPage`: one fake element per `id="…"` in the page's
// markup, web/games/fidice/index.html, which the test reads through `?raw` and passes in, with the
// classes, attributes and the input value as the markup has them, so the fixture cannot drift from
// the page) with its four modes, `online` shipping `active` (page.ts: Online and Pass the phone on
// the switch and in the submenu, Solo and Watch beside them, plan §7 D9). The vdom's mount needs a
// document with constructors, which this fake has not: render.test.ts hands render.ts a document
// spliced from web/shared/edge/dom.fake.ts for the four mount roots.
import {
  shellPage,
  type FakeEl,
  type FakeElOptions,
  type ShellPage,
} from '../../../../shared/edge/page.fake.ts';

/** The four play modes, in the markup's order (page.ts: the switch and the submenu carry all four). */
export const MODES = ['online', 'local', 'solo', 'watch'] as const;

export type FidicePage = ShellPage;

/**
 * Every element of the page, from its markup; `extra` adds queries or children to an id (its
 * classes and value still come from the markup) and `more` adds elements the markup has no id for.
 */
export const fidicePage = (
  markup: string,
  extra: Readonly<Record<string, FakeElOptions>> = {},
  more: ReadonlyArray<FakeEl> = [],
): FidicePage => shellPage(markup, { modes: MODES, activeSwitchMode: 'online' }, {}, extra, more);
