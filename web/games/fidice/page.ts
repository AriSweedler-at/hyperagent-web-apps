// Fidice's shell page (docs/design/fidice-shell-adoption.md §4 M2; "plan §N" below is that
// document): what tools/shell-markup.ts fills web/shared/markup/shell/*.html with to compose
// ./index.html, which test/dist/shell-markup.test.ts pins byte for byte. The page is hand-owned in
// its layout (.prettierignore, as gin's is), so the render is the committed bytes as the partials
// spell them and the residue here (`blocks`: today's head with its three fonts, the dice masthead,
// the Solo and Watch modes, the Ladder tab and its sheet, the host card's five fields, the six
// pass-the-phone names, the seat lists with the bot and watch controls, the bot config screen, the
// table with the shell's five controls and the `#fidiceTable` mount, the endgame) carries the
// partials' indentation. The looks (`look`) are the shell's classes, as backgammon's are, with
// fidice's own button kinds where a kind is chosen. Dark until M6: the legacy app's `mount`
// (src/view/vdom.ts) replaces `#app`'s children with `#app-root`, and main.ts removes the nodes the
// page puts outside `#app` before it, so nothing here shows on the old path.
import type {
  ShellBlocks,
  ShellCopy,
  ShellLook,
  ShellNotes,
  ShellPage,
} from '../../shared/markup/shell.ts';

const copy: ShellCopy = {
  modeOnline: 'Online',
  modeLocal: 'Pass the phone',
  hostLabel: 'Host a table',
  joinLabel: 'Join a table',
  joinBtnLabel: 'Sit down',
  localBtnLabel: 'Start',
  localNote:
    'One phone, no internet needed. When the cup reaches someone new, the screen covers itself until they confirm it is them.',
  hostWaitTitle: 'Your table',
  hostWaitSubtitle: 'Have the others open this same page and enter the code',
  openingMsg: 'Opening the table…',
  keepOpenNote:
    'Keep this screen open while the others sit down. If you switch apps, come straight back and the table reconnects on its own.',
  startLabel: 'Start',
  curtainSub: '',
  revealLabel: 'Lift the cup',
  rulesTitle: 'Rules',
  historyTitle: 'History',
};

const notes: ShellNotes = {
  homeNote: ` (docs/design/fidice-shell-adoption.md §4 M2; "plan §N" below is that document):
       Online (the default), Pass the phone, Solo or Watch (plan §7 D9).`,
  rulesTabNote: ': the shell fills both lists at boot from M4 (plan §7 D12).',
  glossaryDoc: 'glossary-links.md',
  aboutClose: '',
  curtainNote:
    ' (plan §7 D9): a translucent wash; the cup stays down until the next player confirms it is them.',
};

const look: ShellLook = {
  resumeClass: ' resume',
  resumeStyle: '',
  resumeBtnKind: 'btn-primary',
  onlineActive: ' active',
  mt8: '',
  mt10: '',
  mt14: '',
  mb8: '',
  pt10: '',
  m0: '',
  noteLeft: 'class="empty-note left"',
  centeredBox: 'class="card-box centered"',
  pulseMuted: 'class="pulse muted"',
  joinBtnWidth: '',
  curtainClass: ' curtain',
  curtainStyle: '',
  curtainSheet: 'class="sheet centered"',
  betweenRow: 'class="row between"',
  historyClass: ' class="history"',
  toastAttrs: ' role="status"',
};

const blocks: ShellBlocks = {
  // Today's head (M1 linked shell.css; the sheets' order is the cascade's) with the link-preview
  // card every shell page names (docs/design/link-previews.md §2; M5): the 1200x630 splash
  // tools/splash.ts renders from ./assets/splash.svg to web/public/games/fidice/splash.png, on
  // the proxy origin the owner texts (test/dist/link-previews.test.ts pins the head to the file).
  head: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta property="og:title" content="Fidice — one-cup liar's dice (Kezar Lake)">
    <meta property="og:description" content="One cup, five dice, two to six players: bid a hand off the ladder or call liar. Pass one phone around, or open a table online and share the code.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://games.sweedler.com/fidice/">
    <meta property="og:image" content="https://games.sweedler.com/fidice/splash.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Five dice and a cup on a dock over Kezar Lake, with the word Fidice">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Fidice — one-cup liar's dice (Kezar Lake)">
    <meta name="twitter:description" content="One cup, five dice, two to six players: bid a hand off the ladder or call liar. Pass one phone around, or open a table online and share the code.">
    <meta name="twitter:image" content="https://games.sweedler.com/fidice/splash.png">
    <meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fidice — one-cup liar's dice</title>
<link rel="icon" href="/shared/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/shared/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:ital,wght@0,400;0,600;0,700;0,800;1,400&family=Caveat:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../shared/styles/tokens.css">
<link rel="stylesheet" href="../../shared/styles/base.css">
<link rel="stylesheet" href="../../shared/styles/shell.css">
<link rel="stylesheet" href="./theme.css">
</head>`,
  masthead: `    <div class="masthead">
      <h1 class="brand"><span class="cup" aria-hidden="true">🥤</span>Fidice</h1>
      <div class="subtitle">One cup. Five dice. Don't get caught.</div>
    </div>`,
  // Solo and Watch (plan §7 D9): two more modes beside Online and Pass the phone, shown (gin's
  // Sandbox is the hidden twin); both start from the home card once M4 binds them.
  submenuExtra: `          <button type="button" data-mode="solo">Solo</button>
          <button type="button" data-mode="watch">Watch</button>`,
  // The Ladder tab (plan §7 D12) sits where the partial places an extra tab, between Rules and About.
  extraTabs: `      <button type="button" class="tab-btn" id="tabLadderBtn" data-tab="ladder">Ladder</button>`,
  switchExtra: `        <button type="button" class="mode-btn" data-mode="solo">Solo</button>
        <button type="button" class="mode-btn" data-mode="watch">Watch</button>`,
  // The host card's fields (plan §7 D7): the scoring, the seats, the computers and how good they
  // are, the strategy settings button; the ids are the legacy name form's (src/view/screens/menu.ts).
  hostFields: `          <div class="row">
            <div class="field grow">
              <span class="field-label">Scoring</span>
              <select id="livesSel">
                <option value="0" selected>Keep score — no kayaks</option>
                <option value="1">1 kayak each</option>
                <option value="2">2 kayaks each</option>
                <option value="3">3 kayaks each</option>
                <option value="4">4 kayaks each</option>
                <option value="5">5 kayaks each</option>
              </select>
            </div>
            <div class="field grow">
              <span class="field-label">Seats</span>
              <select id="seatsSel">
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6" selected>6</option>
              </select>
            </div>
          </div>
          <div class="row">
            <div class="field grow">
              <span class="field-label">Computers</span>
              <select id="botsSel">
                <option value="0" selected>None</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            </div>
            <div class="field grow">
              <span class="field-label">How good</span>
              <select id="difficulty">
                <option value="easy">Easy</option>
                <option value="medium" selected>Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <button class="btn btn-secondary btn-sm" id="btnConfigSolo" title="Pick an exact strategy, or the self-taught computer and how long it trained" aria-label="Computer settings">⚙</button>
          </div>
          <button class="btn btn-go btn-block" id="hostBtn">Host a table</button>`,
  // Two to six at one phone: the first two names always, the next four behind the add button.
  localFields: `        <div class="card-box">
          <label>Players</label>
          <div class="row">
            <input type="text" id="p1NameInput" class="grow" placeholder="Player 1" maxlength="16" autocomplete="off">
            <input type="text" id="p2NameInput" class="grow" placeholder="Player 2" maxlength="16" autocomplete="off">
          </div>
          <input type="text" id="p3NameInput" class="hidden" placeholder="Player 3" maxlength="16" autocomplete="off">
          <input type="text" id="p4NameInput" class="hidden" placeholder="Player 4" maxlength="16" autocomplete="off">
          <input type="text" id="p5NameInput" class="hidden" placeholder="Player 5" maxlength="16" autocomplete="off">
          <input type="text" id="p6NameInput" class="hidden" placeholder="Player 6" maxlength="16" autocomplete="off">
          <div class="row">
            <button type="button" class="btn btn-ghost btn-sm" id="addLocalBtn">+ Add a player</button>
            <button type="button" class="btn btn-ghost btn-sm hidden" id="removeLocalBtn">− Remove a player</button>
          </div>
        </div>`,
  playExtra: '',
  extraPanels: `    <!-- LADDER TAB (plan §7 D12): the bid ladder, painted from M4. -->
    <div id="ladderPanel" class="tab-panel hidden">
      <div class="card-box ladder" id="ladderList"></div>
    </div>`,
  extraScreens: `  <!-- BOT CONFIG (plan §7 D7): the computer strategies screen, painted from M4. -->
  <div id="configScreen" class="hidden"></div>`,
  // The seats as they fill (web/shared/ui/shellPaint.ts `paintWaiting`; docs/design/n-seat-sessions.md
  // §7), then the host's lobby controls the legacy lobby had (src/view/screens/lobby.ts).
  hostWaitList: `      <ul class="seat-list" id="seatList" aria-label="Seats"></ul>
      <div class="row">
        <button class="btn btn-secondary btn-sm" id="btnAddBot">🤖 Add a computer</button>
        <label class="toggle" id="watchWrap"><input type="checkbox" id="watchCb"> I'll just watch</label>
      </div>`,
  guestWaitList: `      <ul class="seat-list" id="guestSeatList" aria-label="Seats"></ul>`,
  table: `  <!-- TABLE (plan §4 M2): the shell's five controls, the ladder button and the connection dot in
       the topbar; the names strip every shell table carries (#myName the chair this page plays,
       #oppName the others: what the shell specs read, M5); the cup, the bid card, the seats and
       the bid picker paint into #fidiceTable from M4. Dark until M6: the legacy mount replaces
       #app's children with #app-root. -->
  <div id="tableScreen" class="hidden">
    <div class="topbar">
      <div class="row tight">
        <button class="icon-btn" id="leaveBtn" title="Leave the table" aria-label="Leave the table">↺</button>
        <button class="icon-btn hidden" id="handoffBtn" title="Continue online" aria-label="Continue online">🌐</button>
        <div class="conn-dot" id="connDot"></div>
      </div>
      <div class="row tight">
        <button class="icon-btn" id="ladderBtn" title="Ladder" aria-label="Ladder">📜</button>
        <button class="icon-btn" id="rulesBtnGame" title="Rules" aria-label="Rules">📖</button>
        <button class="icon-btn" id="historyBtn" title="History" aria-label="History">≡</button>
        <button class="icon-btn" id="soundBtn" title="Sound &amp; vibration" aria-label="Sound" aria-pressed="true">🔊</button>
      </div>
    </div>
    <div class="row between small" id="tableNames">
      <span id="myName"></span>
      <span class="muted" id="oppName"></span>
    </div>
    <div id="fidiceTable"></div>
  </div>`,
  endgame: `  <!-- ENDGAME: the shell's fifth screen (web/shared/markup/shell.ts BLOCK_IDS); the leave
       button is the table's, as gin's is. -->
  <div id="endgameScreen" class="hidden">
    <h1>Game over</h1>
    <div class="card-box centered">
      <div class="sheet-title" id="resultTitle">The last one standing</div>
      <div class="sheet-sub" id="resultSub"></div>
    </div>
    <button class="btn btn-go btn-block" id="playAgainBtn">Play again</button>
  </div>`,
  curtainIcon: '',
  curtainExtra: '',
  sheetsBefore: '',
  // The ladder in game (plan §7 D12): the same ladder as a sheet over the table, the bid marked.
  sheetsAfter: `
<!-- LADDER (plan §7 D12): the bid ladder as a sheet over the table, the current bid marked. -->
<div id="ladderOverlay" class="overlay hidden">
  <div class="sheet">
    <div class="row between">
      <div class="sheet-title">Ladder</div>
      <button class="btn btn-ghost btn-sm" id="closeLadderBtn">Close</button>
    </div>
    <div class="ladder" id="ladderSheet"></div>
  </div>
</div>`,
  rulesIcon: '',
};

export const FIDICE_PAGE: ShellPage = { copy, notes, look, blocks };
