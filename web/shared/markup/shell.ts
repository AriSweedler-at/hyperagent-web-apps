// The shell's markup, spelled once (docs/design/dry-round-2.md §3 row G2, §5 Wave F row F2). A
// shell page (docs/design/shared-shell.md §3.1: the home screen, the waiting rooms, the curtain,
// the rules and history sheets, the toast) is the six partials under shell/ filled with the game's
// ShellPage (web/games/<g>/page.ts: its copy, its comment notes, how it spells each shell look, and
// its own markup) and composed by tools/shell-markup.ts into the committed web/games/<g>/index.html,
// which test/dist/shell-markup.test.ts pins to the render. Pure: strings in, a Result out, no file
// and no DOM, so the pure tsconfig compiles it and a game's page.ts imports only its types.
//
// A partial's `{{name}}` inline is a slot (a copy string, a comment note or a look). A line that is
// `{{name}}` alone, at column 0, is a block: the game's own markup replaces the line, carrying its
// own indentation and, where the page has one, the blank line above it; an empty block drops the
// line. A block is inserted verbatim (no placeholder inside it is filled), so a game's residue is
// the committed bytes cut out of its page. Every slot and block a page declares must be read by some
// partial and every placeholder filled: a hole no page fills or a value no partial reads is an error
// here, never a silent page.
import { err, ok, type Result } from '../lib/result.ts';

/** The partials, web/shared/markup/shell/<name>.html: the page's skeleton and the five it lays out. */
export const PARTIALS = ['page', 'home', 'waiting', 'curtain', 'sheets', 'toast'] as const;
export type PartialName = (typeof PARTIALS)[number];
/** The five partials page.html places as blocks, by their names. */
const INNER = ['home', 'waiting', 'curtain', 'sheets', 'toast'] as const;
export type ShellTemplates = Readonly<Record<PartialName, string>>;

/** The copy the shell pages spell differently: gin's room is backgammon's table. */
export type ShellCopy = Readonly<{
  /** The online mode's label in `#playSubmenu` and `#playModeSwitch` ('🌐 Online', 'Online'). */
  modeOnline: string;
  /** The pass-and-play mode's label ('📱 Pass &amp; Play', 'Pass the phone'). */
  modeLocal: string;
  /** The host card's label ('Host a game', 'Open a table'); its fields and `#hostBtn` are the `hostFields` block. */
  hostLabel: string;
  /** The join card's label ('Join a game', 'Sit down at a table'). */
  joinLabel: string;
  /** `#joinBtn` ('Join', 'Sit down'). */
  joinBtnLabel: string;
  /** `#localBtn` ('Start pass &amp; play', 'Start'). */
  localBtnLabel: string;
  /** The note under `#localBtn`. */
  localNote: string;
  /** `#hostWaitScreen h1` ('Your room', 'Your table'). */
  hostWaitTitle: string;
  /** `#hostWaitStatus` as shipped, before the host's session writes it. */
  openingMsg: string;
  /** The waiting room's keep-this-screen-open note. */
  keepOpenNote: string;
  /** `#startGameBtn` ('Deal the first hand', 'Start the match'). */
  startLabel: string;
  /** `#curtainSub` as shipped ('' for gin, 'Your turn.' for backgammon). */
  curtainSub: string;
  /** `#curtainBtn` ('Show my cards', 'Roll'). */
  revealLabel: string;
  /** The rules sheet's title. */
  rulesTitle: string;
  /** The history sheet's title ('Hand history', 'This game'). */
  historyTitle: string;
}>;

/** What a page's HTML comments say beyond the shared section names: each '' or the page's own words. */
export type ShellNotes = Readonly<{
  /** After `HOME / LOBBY` (backgammon names its design doc there, over two lines). */
  homeNote: string;
  /** After `RULES TAB`. */
  rulesTabNote: string;
  /** The glossary doc the ABOUT TAB comment names: gin spells the path, backgammon the file. */
  glossaryDoc: string;
  /** After `#aboutPanel`'s closing tag: gin's `<!-- /about -->` marker. */
  aboutClose: string;
  /** After `PASS-AND-PLAY CURTAIN`. */
  curtainNote: string;
}>;

/**
 * How the page spells each shell look at the spots the partials share. Gin's page is the legacy
 * page's markup and carries its looks as inline styles (the 36 the design row counts, emitted
 * verbatim); backgammon's carries its theme's classes. Each value is the attribute text at the
 * spot, '' where the page has none; the ones that stand for a whole attribute list say so.
 */
export type ShellLook = Readonly<{
  /** `#resumeBox`: a class after `card-box` (` resume`) and a style after `hidden` (gin's amber border). */
  resumeClass: string;
  resumeStyle: string;
  /** `#resumeBtn`'s kind between `btn` and `btn-block` (`btn-gold`, `btn-primary`). */
  resumeBtnKind: string;
  /** `#playModeSwitch`'s online button: backgammon ships it ` active`; gin paints that at boot. */
  onlineActive: string;
  /** Gin's ` style="margin-top:8px;"` under a card's label, where backgammon's theme spaces it. */
  mt8: string;
  /** Gin's ` style="margin-top:10px;"` on the waiting room's buttons and `#historyList`. */
  mt10: string;
  /** Gin's ` style="margin-top:14px;"` on `#closeRulesBtn`. */
  mt14: string;
  /** Gin's ` style="margin-bottom:8px;"` on `#curtainLast`. */
  mb8: string;
  /** Gin's ` style="padding-top:10px;"` on the waiting room's keep-open note. */
  pt10: string;
  /** Gin's ` style="margin:0;"` on the history sheet's title beside its close button. */
  m0: string;
  /** Attribute list: an `empty-note` aligned left (`class="empty-note left"`; gin pads it inline too). */
  noteLeft: string;
  /** Attribute list: a centred `card-box` (`class="card-box centered"`). */
  centeredBox: string;
  /** Attribute list: the waiting rooms' muted `pulse` status (`class="pulse muted"`). */
  pulseMuted: string;
  /** `#joinBtn`: gin's ` style="min-width:96px;"`. */
  joinBtnWidth: string;
  /** `#curtainOverlay`: a class after `overlay` (` curtain`, the translucent wash) and a style after `hidden` (gin's felt). */
  curtainClass: string;
  curtainStyle: string;
  /** Attribute list: the curtain's sheet (`class="sheet centered"`; gin centres it inline and colours its border). */
  curtainSheet: string;
  /** Attribute list: the history sheet's title row (`class="row between"`). */
  betweenRow: string;
  /** `#historyList`'s class attribute (` class="history"`), before its id. */
  historyClass: string;
  /** `#toast`'s attributes after its id (backgammon's ` role="status"`). */
  toastAttrs: string;
}>;

/**
 * The game's own markup, verbatim from its page: the residue the design row lists per game (gin:
 * table, endgame, six sheets, the scorer's screens, the sandbox and score panels, head, its target
 * inputs; backgammon: table, endgame, its sheets, head, its selects). Each is '' or lines carrying
 * their own indentation; a block that follows a blank line in the page begins with that blank line.
 */
export type ShellBlocks = Readonly<{
  /** `<!DOCTYPE html>` through `</head>`: the metadata, the title and the stylesheet links. */
  head: string;
  /** The heading inside `#homeScreen`. */
  masthead: string;
  /** `#playSubmenu`'s buttons after Online and Pass & Play (gin's hidden Sandbox). */
  submenuExtra: string;
  /** `#topTabbar`'s buttons between Rules and About (gin's Score). */
  extraTabs: string;
  /** `#playModeSwitch`'s buttons after the two (gin's hidden Sandbox). */
  switchExtra: string;
  /** The host card between its label and its note, `#hostBtn` included (BLOCK_IDS). */
  hostFields: string;
  /** `#localModeContent` before `#localBtn`, `#p1NameInput` and `#p2NameInput` included (BLOCK_IDS). */
  localFields: string;
  /** `#playPanel` after `#localModeContent` (gin's sandbox panel). */
  playExtra: string;
  /** `#homeScreen`'s panels between Rules and About (gin's score panel). */
  extraPanels: string;
  /** `#app`'s screens between the home and the waiting rooms (gin's scorer). */
  extraScreens: string;
  /** `#tableScreen`. */
  table: string;
  /** `#endgameScreen`. */
  endgame: string;
  /** The curtain sheet's first line (gin's phone emoji). */
  curtainIcon: string;
  /** The curtain sheet after `#curtainBtn` (backgammon's `#curtainHandoffBtn`). */
  curtainExtra: string;
  /** The game's overlays between the curtain and the rules sheet. */
  sheetsBefore: string;
  /** The game's overlays between the history sheet and the toast. */
  sheetsAfter: string;
  /** The rules sheet's first line (gin's book emoji). */
  rulesIcon: string;
}>;

/** One shell page: what web/games/<g>/page.ts declares and tools/shell-markup.ts composes. */
export type ShellPage = Readonly<{
  copy: ShellCopy;
  notes: ShellNotes;
  look: ShellLook;
  blocks: ShellBlocks;
}>;

/**
 * The shell ids (web/shared/ui/ids.ts SHELL_IDS) the partials cannot spell, each in the block that
 * places it. The two pages lay the options out differently: `#hostBtn` sits inside gin's target row
 * and after backgammon's selects, and the two name inputs are two labelled boxes in gin and one row
 * in backgammon. The table and the endgame are each game's own screens (the design row's residue),
 * but the shell paints the table's sound and handoff buttons and binds its rules and history
 * buttons, so their ids are shell ids the table block carries. renderShell refuses a block that
 * lacks one of its ids or repeats it; the drift test pins the partials' ids plus these and
 * SCREEN_IDS to SHELL_IDS.
 */
export const BLOCK_IDS: Readonly<
  Record<'hostFields' | 'localFields' | 'table' | 'endgame', ReadonlyArray<string>>
> = {
  hostFields: ['hostBtn'],
  localFields: ['p1NameInput', 'p2NameInput'],
  table: ['tableScreen', 'soundBtn', 'handoffBtn', 'rulesBtnGame', 'historyBtn'],
  endgame: ['endgameScreen'],
};

/**
 * The shell ids either the table or the endgame block places, exactly once between them: gin's
 * `#leaveBtn` is in the table's topbar, backgammon's on the endgame screen (its table has the menu).
 */
export const SCREEN_IDS: ReadonlyArray<string> = ['leaveBtn'];

/** Every `id="..."` attribute in some markup, in order, repeats included (a `data-id` is not one; the one capture is the id). */
export const idsIn = (markup: string): ReadonlyArray<string> =>
  [...markup.matchAll(/(?:^|\s)id="([^"]+)"/g)].flatMap((m: ReadonlyArray<string>) => m.slice(1));

/** A line that is one placeholder at column 0: a block; its name is the line without the braces. */
const BLOCK_LINE = /^\{\{\w+\}\}$/;
/** A placeholder inline: a slot. Split on it, the odd parts are the names. */
const SLOT = /\{\{(\w+)\}\}/;

type Values = Readonly<Record<string, string>>;
type Filled = Readonly<{
  lines: ReadonlyArray<string>;
  used: ReadonlyArray<string>;
  errors: ReadonlyArray<string>;
}>;
/** An inner partial filled, by the name page.html places it under. */
type Inner = Readonly<{ name: PartialName; filled: Filled }>;

/** One line filled: a block line becomes its block's lines (none when empty), any other line has its slots substituted. */
const fillLine = (line: string, slots: Values, blocks: Values, where: string): Filled => {
  if (BLOCK_LINE.test(line)) {
    const name = line.slice(2, -2);
    const value = blocks[name];
    if (value === undefined) {
      return { lines: [line], used: [], errors: [`${where}: no block named "${name}"`] };
    }
    return { lines: value === '' ? [] : [value], used: [name], errors: [] };
  }
  const parts = line.split(SLOT);
  const names = parts.filter((_, i) => i % 2 === 1);
  return {
    lines: [parts.map((part, i) => (i % 2 === 1 ? (slots[part] ?? '') : part)).join('')],
    used: names,
    errors: names
      .filter((name) => slots[name] === undefined)
      .map((name) => `${where}: no slot named "${name}"`),
  };
};

/** A whole partial filled, line by line; the errors name the partial and the line. */
const fillTemplate = (name: PartialName, template: string, slots: Values, blocks: Values): Filled =>
  template
    .split('\n')
    .map((line, i) => fillLine(line, slots, blocks, `${name}.html:${String(i + 1)}`))
    .reduce(
      (acc, one) => ({
        lines: [...acc.lines, ...one.lines],
        used: [...acc.used, ...one.used],
        errors: [...acc.errors, ...one.errors],
      }),
      { lines: [], used: [], errors: [] },
    );

/** The ids in `markup` that are not exactly once among `ids`. */
const notOnce = (ids: ReadonlyArray<string>, markup: string): ReadonlyArray<string> =>
  ids.filter((id) => idsIn(markup).filter((seen) => seen === id).length !== 1);

/** The ids a block must place (BLOCK_IDS, SCREEN_IDS) that it lacks or repeats. */
const blockIdErrors = (blocks: ShellBlocks): ReadonlyArray<string> => [
  ...(Object.keys(BLOCK_IDS) as ReadonlyArray<keyof typeof BLOCK_IDS>).flatMap((block) =>
    notOnce(BLOCK_IDS[block], blocks[block]).map(
      (id) => `the ${block} block must carry id="${id}" exactly once`,
    ),
  ),
  ...notOnce(SCREEN_IDS, `${blocks.table}\n${blocks.endgame}`).map(
    (id) => `the table and endgame blocks must carry id="${id}" exactly once between them`,
  ),
];

/**
 * The page, byte for byte as the partials and the page's values spell it: the five inner partials
 * filled and placed into page.html (each without its file's final newline, page.html with it). An
 * Err lists every unfilled placeholder, every unused value and every block id missing or repeated.
 */
export const renderShell = (templates: ShellTemplates, page: ShellPage): Result<string, string> => {
  const slots: Values = { ...page.copy, ...page.notes, ...page.look };
  const own: Values = page.blocks;
  const inner: ReadonlyArray<Inner> = INNER.map((name) => ({
    name,
    filled: fillTemplate(name, templates[name], slots, own),
  }));
  const placed: Values = Object.fromEntries(
    inner.map((one) => [one.name, one.filled.lines.join('\n').replace(/\n$/, '')]),
  );
  const whole = fillTemplate('page', templates.page, slots, { ...own, ...placed });
  const all = [...inner.map((one) => one.filled), whole];
  const used = new Set(all.flatMap((f) => f.used));
  const unused = [...Object.keys(slots), ...Object.keys(own)]
    .filter((name) => !used.has(name))
    .map((name) => `"${name}" is declared by the page but no partial reads it`);
  const errors = [...all.flatMap((f) => f.errors), ...unused, ...blockIdErrors(page.blocks)];
  return errors.length === 0 ? ok(whole.lines.join('\n')) : err(errors.join('\n'));
};
