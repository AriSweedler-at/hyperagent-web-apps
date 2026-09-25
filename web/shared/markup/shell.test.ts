// The renderer's mechanics over tiny partials (docs/design/dry-round-2.md row G2): a slot fills
// inline, a block line becomes its block or nothing, a block is verbatim, the inner partials lose
// their file's final newline and page.html keeps its own, and every way a page and the partials can
// disagree is an Err that names the place. The real partials and pages are pinned to the committed
// files by test/dist/shell-markup.test.ts.
import { describe, expect, test } from 'vitest';

import {
  BLOCK_IDS,
  PARTIALS,
  SCREEN_IDS,
  idsIn,
  renderShell,
  type ShellBlocks,
  type ShellCopy,
  type ShellLook,
  type ShellNotes,
  type ShellPage,
  type ShellTemplates,
} from './shell.ts';

const copy: ShellCopy = {
  modeOnline: 'Online',
  modeLocal: 'Local',
  hostLabel: 'Host',
  joinLabel: 'Join',
  joinBtnLabel: 'Go',
  localBtnLabel: 'Start',
  localNote: 'note',
  hostWaitTitle: 'Wait',
  openingMsg: 'Opening',
  keepOpenNote: 'keep',
  startLabel: 'Deal',
  curtainSub: 'sub',
  revealLabel: 'Show',
  rulesTitle: 'Rules',
  historyTitle: 'History',
};
const notes: ShellNotes = {
  homeNote: ' (home)',
  rulesTabNote: ': rules',
  glossaryDoc: 'g.md',
  aboutClose: '<!-- /about -->',
  curtainNote: ' (curtain)',
};
const look: ShellLook = {
  resumeClass: ' resume',
  resumeStyle: '',
  resumeBtnKind: 'btn-gold',
  onlineActive: ' active',
  mt8: ' style="margin-top:8px;"',
  mt10: '',
  mt14: '',
  mb8: '',
  pt10: '',
  m0: '',
  noteLeft: 'class="empty-note left"',
  centeredBox: 'class="card-box centered"',
  pulseMuted: 'class="pulse muted"',
  joinBtnWidth: '',
  curtainClass: '',
  curtainStyle: '',
  curtainSheet: 'class="sheet"',
  betweenRow: 'class="row"',
  historyClass: '',
  toastAttrs: ' role="status"',
};
const blocks: ShellBlocks = {
  head: '<head></head>',
  masthead: '  <h1>Game</h1>',
  submenuExtra: '',
  extraTabs: '',
  switchExtra: '',
  hostFields: '  <button id="hostBtn">{{hostLabel}}</button>',
  localFields: '  <input id="p1NameInput">\n  <input id="p2NameInput">',
  playExtra: '',
  extraPanels: '',
  extraScreens: '',
  table:
    '  <div id="tableScreen"><button id="leaveBtn"></button><button id="soundBtn"></button><button id="handoffBtn"></button><button id="rulesBtnGame"></button><button id="historyBtn"></button></div>',
  endgame: '  <div id="endgameScreen"></div>',
  curtainIcon: '',
  curtainExtra: '',
  sheetsBefore: '\n<div id="own"></div>',
  sheetsAfter: '',
  rulesIcon: '',
};
const page: ShellPage = { copy, notes, look, blocks };

const slotNames = Object.keys({ ...copy, ...notes, ...look });
const blockNames = Object.keys(blocks);

/** Partials that read every value once: the blocks as block lines, the slots inline in home. */
const templates: ShellTemplates = {
  page: [
    '{{head}}',
    '<body>',
    '{{home}}',
    '{{waiting}}',
    '{{curtain}}',
    '{{sheets}}',
    '{{toast}}',
    '</body>',
    '',
  ].join('\n'),
  home: [
    '<!-- HOME{{homeNote}} -->',
    ...blockNames.map((name) => `{{${name}}}`),
    ...slotNames.filter((name) => name !== 'homeNote').map((name) => `<i>{{${name}}}</i>`),
    '',
  ].join('\n'),
  waiting: '<div id="hostWaitScreen"></div>\n',
  curtain: '<div id="curtainOverlay"></div>\n',
  sheets: '<div id="rulesOverlay"></div>\n',
  toast: '<div id="toast"></div>\n',
};

const rendered = renderShell(templates, page);

describe('renderShell', () => {
  test('the six partials are named, page.html first', () => {
    expect(PARTIALS).toEqual(['page', 'home', 'waiting', 'curtain', 'sheets', 'toast']);
  });

  test('slots fill inline, a block line becomes its block, an empty block drops its line', () => {
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const lines = rendered.value.split('\n');
    expect(lines[0]).toBe('<head></head>');
    expect(lines[1]).toBe('<body>');
    expect(lines[2]).toBe('<!-- HOME (home) -->');
    // The blocks in declaration order, the empty ones gone, each verbatim (the placeholder inside
    // hostFields is not filled, and sheetsBefore keeps the blank line it begins with).
    expect(lines.slice(3, 11)).toEqual([
      '<head></head>',
      '  <h1>Game</h1>',
      '  <button id="hostBtn">{{hostLabel}}</button>',
      '  <input id="p1NameInput">',
      '  <input id="p2NameInput">',
      blocks.table,
      '  <div id="endgameScreen"></div>',
      '',
    ]);
    expect(lines[11]).toBe('<div id="own"></div>');
    expect(lines[12]).toBe('<i>Online</i>');
    expect(rendered.value).toContain('<i>btn-gold</i>');
    expect(rendered.value).toContain('<i> style="margin-top:8px;"</i>');
    expect(rendered.value).toContain('<i></i>');
  });

  test("the inner partials lose their file's final newline; page.html keeps its own", () => {
    if (!rendered.ok) return;
    expect(rendered.value).toContain(
      '<div id="hostWaitScreen"></div>\n<div id="curtainOverlay"></div>\n<div id="rulesOverlay"></div>\n<div id="toast"></div>\n</body>\n',
    );
    expect(rendered.value.endsWith('</body>\n')).toBe(true);
    expect(rendered.value.endsWith('</body>\n\n')).toBe(false);
  });

  test('a placeholder no page value fills is an Err naming the partial and the line', () => {
    const missing = renderShell(
      { ...templates, toast: '<div id="toast"{{toastAttrs}}{{nope}}></div>\n{{never}}\n' },
      page,
    );
    expect(missing).toEqual({
      ok: false,
      error: ['toast.html:1: no slot named "nope"', 'toast.html:2: no block named "never"'].join(
        '\n',
      ),
    });
  });

  test('a value no partial reads is an Err naming it', () => {
    const home = templates.home
      .replace('<i>{{historyTitle}}</i>\n', '')
      .replace('{{rulesIcon}}\n', '');
    expect(renderShell({ ...templates, home }, page)).toEqual({
      ok: false,
      error: [
        '"historyTitle" is declared by the page but no partial reads it',
        '"rulesIcon" is declared by the page but no partial reads it',
      ].join('\n'),
    });
  });

  test('the blocks that place shell ids must carry each exactly once', () => {
    expect(BLOCK_IDS).toEqual({
      hostFields: ['hostBtn'],
      localFields: ['p1NameInput', 'p2NameInput'],
      table: ['tableScreen', 'soundBtn', 'handoffBtn', 'rulesBtnGame', 'historyBtn'],
      endgame: ['endgameScreen'],
    });
    expect(SCREEN_IDS).toEqual(['leaveBtn']);
    const wrong: ShellPage = {
      ...page,
      blocks: {
        ...blocks,
        hostFields: '<button></button>',
        localFields: '<input id="p1NameInput"><input id="p1NameInput">',
        // The sound button missing, and a second leave button on the endgame screen.
        table: blocks.table.replace('<button id="soundBtn"></button>', ''),
        endgame: '<div id="endgameScreen"><button id="leaveBtn"></button></div>',
      },
    };
    expect(renderShell(templates, wrong)).toEqual({
      ok: false,
      error: [
        'the hostFields block must carry id="hostBtn" exactly once',
        'the localFields block must carry id="p1NameInput" exactly once',
        'the localFields block must carry id="p2NameInput" exactly once',
        'the table block must carry id="soundBtn" exactly once',
        'the table and endgame blocks must carry id="leaveBtn" exactly once between them',
      ].join('\n'),
    });
  });
});

describe('idsIn', () => {
  test('every id attribute, in order, repeats included; a data-id is not one', () => {
    expect(idsIn('<a id="x"><b id="y" data-id="z"></b><c id="x"></c>')).toEqual(['x', 'y', 'x']);
    expect(idsIn('<p class="id"></p>')).toEqual([]);
  });
});
