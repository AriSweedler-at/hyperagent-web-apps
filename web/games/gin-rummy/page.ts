// Gin's shell page (docs/design/dry-round-2.md §3 row G2, §5 Wave F row F2): what
// tools/shell-markup.ts fills web/shared/markup/shell/*.html with to compose ./index.html, which
// test/dist/shell-markup.test.ts pins byte for byte. The page is the legacy page's markup
// (legacy/gin-rummy/index.html, hand-owned in its layout: .prettierignore), so its looks are the
// legacy inline styles, emitted verbatim (`look`), and its residue (`blocks`: the head, the table,
// the endgame, the scorer's two screens, the sandbox and score panels, the six sheets of its own,
// the target inputs beside `#hostBtn` and under the two names) is the committed bytes, cut out of
// the page with the blank line each follows. tools/parity/gin-dom-parity.ts compares
// `#homeScreen` and `#curtainOverlay` against the legacy page, so every string here is pinned twice.
import type {
  ShellBlocks,
  ShellCopy,
  ShellLook,
  ShellNotes,
  ShellPage,
} from '../../shared/markup/shell.ts';

const copy: ShellCopy = {
  modeOnline: '🌐 Online',
  modeLocal: '📱 Pass &amp; Play',
  hostLabel: 'Host a game',
  joinLabel: 'Join a game',
  joinBtnLabel: 'Join',
  localBtnLabel: 'Start pass &amp; play',
  localNote:
    'One phone, no internet needed — it hides each player\'s cards until they tap "Show my cards" on their turn.',
  hostWaitTitle: 'Your room',
  hostWaitSubtitle: 'Have your opponent open this same page and enter the code',
  openingMsg: 'Opening room…',
  keepOpenNote:
    'Keep this screen open while your opponent joins — if you switch apps, come straight back and the room reconnects on its own.',
  startLabel: 'Deal the first hand',
  curtainSub: '',
  revealLabel: 'Show my cards',
  rulesTitle: 'Gin Rummy — Quick Rules',
  historyTitle: 'Hand history',
};

const notes: ShellNotes = {
  homeNote: '',
  rulesTabNote: '',
  glossaryDoc: 'docs/design/glossary-links.md',
  aboutClose: '<!-- /about -->',
  curtainNote: '',
};

const look: ShellLook = {
  resumeClass: '',
  resumeStyle: ' style="border-color: rgba(251,191,36,0.4);"',
  resumeBtnKind: 'btn-gold',
  onlineActive: '',
  mt8: ' style="margin-top:8px;"',
  mt10: ' style="margin-top:10px;"',
  mt14: ' style="margin-top:14px;"',
  mb8: ' style="margin-bottom:8px;"',
  pt10: ' style="padding-top:10px;"',
  m0: ' style="margin:0;"',
  noteLeft: 'class="empty-note" style="text-align:left; padding:8px 2px 0;"',
  centeredBox: 'class="card-box" style="text-align:center;"',
  pulseMuted: 'class="pulse" style="color:var(--muted);"',
  joinBtnWidth: ' style="min-width:96px;"',
  curtainClass: '',
  curtainStyle: ' style="background:#0b2418;"',
  curtainSheet: 'class="sheet" style="text-align:center; border-color: var(--accent);"',
  betweenRow: 'class="row" style="justify-content:space-between;"',
  historyClass: '',
  toastAttrs: '',
};

const blocks: ShellBlocks = {
  head: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta property="og:title" content="Gin Rummy">
    <meta property="og:description" content="Gin rummy for two in the browser: pass one phone, or host a room and send the link. No app, no sign-up.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://games.sweedler.com/gin-rummy/">
    <meta property="og:image" content="https://games.sweedler.com/gin-rummy/splash.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Gin Rummy: three cards fanned on a green felt table">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Gin Rummy">
    <meta name="twitter:description" content="Gin rummy for two in the browser: pass one phone, or host a room and send the link. No app, no sign-up.">
    <meta name="twitter:image" content="https://games.sweedler.com/gin-rummy/splash.png">
    <meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Gin Rummy</title>
<link rel="icon" href="/shared/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/shared/favicon.ico">
<link rel="stylesheet" href="../../shared/styles/tokens.css">
<link rel="stylesheet" href="../../shared/styles/base.css">
<link rel="stylesheet" href="../../shared/styles/shell.css">
<link rel="stylesheet" href="./theme.css">
</head>`,
  masthead: `    <div class="row" style="justify-content:center;">
      <h1>♠ Gin Rummy</h1>
    </div>`,
  submenuExtra: `          <button type="button" class="hidden" data-mode="sandbox">🧪 Sandbox</button>`,
  extraTabs: `      <button type="button" class="tab-btn" id="tabScoreBtn" data-tab="score">Score</button>`,
  switchExtra: `        <button type="button" class="mode-btn hidden" data-mode="sandbox">🧪 Sandbox</button>`,
  hostFields: `          <div class="row" style="margin-top:8px;">
            <div class="grow"><input type="number" id="targetInput" value="100" inputmode="numeric" placeholder="Play to…"></div>
            <button class="btn btn-go grow" id="hostBtn" style="width:auto;">Host</button>
          </div>`,
  localFields: `        <div class="card-box">
          <label>Player 1 name</label>
          <input type="text" id="p1NameInput" placeholder="Player 1 name" maxlength="20" autocomplete="off" style="margin-top:8px;">
        </div>
        <div class="card-box">
          <label>Player 2 name</label>
          <input type="text" id="p2NameInput" placeholder="Player 2 name" maxlength="20" autocomplete="off" style="margin-top:8px;">
        </div>
        <div class="card-box">
          <label>Play to</label>
          <input type="number" id="localTargetInput" value="100" inputmode="numeric" style="margin-top:8px;">
        </div>`,
  playExtra: `
      <!-- The sandbox (src/sandbox.ts): shown while the first player is named "sandbox". -->
      <div id="sandboxModeContent" class="hidden">
        <div class="card-box">
          <label>Starting point</label>
          <select id="sbPreset" style="margin-top:8px;"></select>
          <textarea id="sbMap" rows="7" spellcheck="false" autocapitalize="off" autocomplete="off" style="margin-top:8px;"></textarea>
          <div class="row" style="margin-top:8px;">
            <button class="btn btn-secondary btn-sm grow" id="sbRandomBtn">🎲 Random</button>
            <button class="btn btn-secondary btn-sm grow" id="sbCopyBtn">Copy</button>
            <button class="btn btn-ghost btn-sm grow" id="sbHelpBtn">Help</button>
          </div>
          <div class="empty-note" id="sbError" style="text-align:left; padding:8px 2px 0; color: var(--danger);"></div>
        </div>
        <button class="btn btn-go btn-block" id="sbStartBtn">Deal the map</button>
        <div class="empty-note" style="text-align:left; padding:8px 2px 0;">A pass-and-play game dealt exactly as written above: both hands, the discard pile, the stock. From the console: <code>__gin.sandbox(map)</code>.</div>
      </div><!-- /sandbox -->`,
  extraPanels: `
    <!-- SCORE COUNTER TAB -->
    <div id="scorePanel" class="tab-panel hidden">
      <div class="card-box">
        <label>Play to</label>
        <input type="number" id="scTargetInput" value="100" inputmode="numeric" style="margin-top:8px;">
      </div>
      <div class="card-box">
        <label>Players</label>
        <div class="setup-players" id="scPlayers">
          <div class="player-input-row"><input type="text" id="scP1NameInput" placeholder="Player 1 name" maxlength="20"></div>
          <div class="player-input-row"><input type="text" id="scP2NameInput" placeholder="Player 2 name" maxlength="20"></div>
        </div>
      </div>
      <button class="btn btn-go btn-block" id="scStartBtn">Start scoring</button>
    </div>`,
  extraScreens: `
  <!-- SCORER: GAME -->
  <div id="scGameScreen" class="hidden">
    <div class="topbar">
      <button class="icon-btn" id="scLeaveBtn" title="End session">↺</button>
      <div class="row" style="gap:6px;"><div class="badge" id="scRoundBadge">Hand 1</div><div class="badge dim" id="scTargetBadge">to 100</div></div>
      <div class="row" style="gap:6px;">
        <button class="icon-btn" id="scExportBtn" title="Export game as CSV">📤</button>
        <button class="icon-btn" id="scRulesBtn2" title="Rules">📖</button>
        <button class="icon-btn" id="scHistoryBtn" title="History">📜</button>
      </div>
    </div>
    <div id="scBoard" style="display:flex; flex-direction:column; gap:10px; margin-top:6px;"></div>
    <button type="button" id="scVoiceBtn" class="voice-fab" title="Speak the scores instead of typing">🎤</button>
    <div id="submitRoundBar"><button class="btn btn-primary" id="scSubmitBtn">✓ Score this hand</button></div>
  </div>

  <!-- SCORER: END -->
  <div id="scEndScreen" class="hidden">
    <div class="row" style="justify-content:center;"><h1>🏆 Game Over</h1></div>
    <div class="card-box" style="text-align:center;">
      <div style="font-size:2.4rem;">🎉</div>
      <div class="sheet-title" id="scEndTitle">Player wins!</div>
      <div class="sheet-sub" id="scEndSub" style="margin-bottom:0;"></div>
    </div>
    <div class="card-box"><label>Final standings</label><div id="scStandings" style="margin-top:10px; display:flex; flex-direction:column; gap:8px;"></div></div>
    <div class="card-box" style="text-align:center;"><label>Game duration</label><div id="scDuration" style="font-size:1.3rem; font-weight:800; color:var(--accent); margin-top:6px;"></div></div>
    <div class="row">
      <button class="btn btn-secondary" id="scEndHistoryBtn" style="min-width:52px;">📜</button>
      <button class="btn btn-secondary" id="scEndExportBtn" style="min-width:52px;">📤</button>
      <button class="btn btn-secondary grow" id="scEndKeepBtn">Keep playing</button>
      <button class="btn btn-go grow" id="scEndNewBtn">New game</button>
    </div>
  </div>`,
  hostWaitList: '',
  guestWaitList: '',
  table: `  <!-- TABLE -->
  <div id="tableScreen" class="hidden">
    <div class="topbar">
      <div class="row" style="gap:6px;"><button class="icon-btn" id="leaveBtn" title="Leave game">↺</button><button class="icon-btn hidden" id="handoffBtn" title="Continue online">🌐</button></div>
      <div class="row" style="gap:6px;"><div class="badge" id="roundBadge">Hand 1</div><div class="badge dim" id="targetBadge">to 100</div></div>
      <div class="row" style="gap:6px;">
        <button class="icon-btn" id="soundBtn" title="Sound & vibration">🔊</button>
        <button class="icon-btn" id="rulesBtnGame" title="Rules">📖</button>
        <button class="icon-btn" id="historyBtn" title="History">📜</button>
      </div>
    </div>

    <div class="opp-strip">
      <div class="opp-info"><div class="opp-name" id="oppName">Opponent</div><div class="opp-score" id="oppScore">0 pts</div></div>
      <div class="opp-cards" id="oppCards"></div>
      <div class="conn-dot" id="connDot"></div>
    </div>

    <div class="table-center" id="tableCenter">
      <div class="pile stock" id="stockPile"></div>
      <div class="pile discard" id="discardPile"></div>
      <button class="pile-peek" id="discardsBtn" title="Discarded cards" aria-label="Discarded cards" disabled>🔍</button>
      <div class="table-melds hidden" id="tableMelds"></div>
    </div>

    <div class="status-banner" id="statusBanner">
      <div class="status-main" id="statusMain">—</div>
      <div class="status-sub" id="statusSub"></div>
    </div>
    <div class="last-action" id="lastAction"></div>

    <div class="hand-area">
      <div class="hand-header"><span id="myName">You</span><button class="arrange-btn" id="arrangeBtn" title="Arrange your hand by melds" disabled>Arrange</button><span class="dw" id="deadwoodInfo">Deadwood: —</span></div>
      <div class="hand" id="hand"></div>
      <div class="actions" id="actions"></div>
    </div>
  </div>`,
  endgame: `  <!-- ENDGAME -->
  <div id="endgameScreen" class="hidden">
    <div class="row" style="justify-content:center;"><h1>🏆 Game Over</h1></div>
    <div class="card-box" style="text-align:center;">
      <div style="font-size:2.4rem;">🎉</div>
      <div class="sheet-title" id="endgameTitle">Player wins!</div>
      <div class="sheet-sub" id="endgameSub" style="margin-bottom:0;">Reached the target score</div>
    </div>
    <div class="card-box">
      <label>Final standings</label>
      <div id="finalStandings" style="margin-top:10px; display:flex; flex-direction:column; gap:8px;"></div>
    </div>
    <div class="card-box" style="text-align:center;">
      <label>Game duration</label>
      <div id="gameDuration" style="font-size:1.3rem; font-weight:800; color:var(--accent); margin-top:6px;"></div>
    </div>
    <div class="row">
      <button class="btn btn-secondary" id="historyBtnEnd" style="min-width:60px;">📜</button>
      <button class="btn btn-secondary grow" id="leaveBtnEnd">Leave</button>
      <button class="btn btn-go grow" id="rematchBtn">Rematch</button>
    </div>
  </div>`,
  curtainIcon: `    <div style="font-size:3rem;">📱</div>`,
  curtainExtra: '',
  sheetsBefore: `
<!-- SCORER RESULT -->
<div id="scResOverlay" class="overlay hidden">
  <div class="sheet">
    <div style="text-align:center; font-size:2rem;">🀄</div>
    <div class="sheet-title" id="scResTitle">Hand results</div>
    <div class="sheet-sub" id="scResSub"></div>
    <div id="scResList" style="display:flex; flex-direction:column; gap:8px;"></div>
    <button class="btn btn-primary btn-block" id="scResContinue" style="margin-top:14px;">Continue</button>
  </div>
</div>

<!-- MELD ARRANGEMENT CHOOSER -->
<div id="meldOverlay" class="overlay hidden">
  <div class="sheet" style="display:flex; flex-direction:column; overflow:hidden;">
    <div style="text-align:center; font-size:2rem;">⇄</div>
    <div class="sheet-title">Arrange your melds</div>
    <div class="sheet-sub" id="meldSub"></div>
    <div id="meldOptionList" style="display:flex; flex-direction:column; gap:10px; overflow-y:auto; min-height:0; flex:1;"></div>
    <button class="btn btn-ghost btn-block btn-sm" id="closeMeldBtn" style="margin-top:14px;">Close</button>
  </div>
</div>

<!-- ARRANGE -->
<div id="arrangeOverlay" class="overlay hidden">
  <div class="sheet">
    <div style="text-align:center; font-size:2rem;">🃏</div>
    <div class="sheet-title">Arrange your hand</div>
    <div class="sheet-sub">Melds sit together on the left. The rest is yours to order: by suit, by rank, or by hand. Long-press a card to make a meld with it, and again to break it.</div>
    <div class="sort-modes" id="arrangeModes">
      <button class="btn btn-secondary btn-sm" data-sort="suit">By suit</button>
      <button class="btn btn-secondary btn-sm" data-sort="rank">By rank</button>
      <button class="btn btn-secondary btn-sm" data-sort="manual">Manual</button>
    </div>
    <button class="btn btn-ghost btn-block btn-sm" id="closeArrangeBtn" style="margin-top:14px;">Close</button>
  </div>
</div>

<!-- DISCARDED CARDS -->
<div id="discardsOverlay" class="overlay hidden">
  <div class="sheet">
    <div style="text-align:center; font-size:2rem;">🔍</div>
    <div class="sheet-title">Discarded cards</div>
    <div class="sheet-sub" id="discardsSub"></div>
    <div class="dc-grid" id="discardsGrid"></div>
    <label class="dc-toggle"><input type="checkbox" id="discardsHandToggle"> Include the cards in my hand</label>
    <button class="btn btn-ghost btn-block btn-sm" id="closeDiscardsBtn" style="margin-top:14px;">Close</button>
  </div>
</div>

<!-- SANDBOX HELP -->
<div id="sandboxHelpOverlay" class="overlay hidden">
  <div class="sheet">
    <div style="text-align:center; font-size:2rem;">🧪</div>
    <div class="sheet-title">The sandbox</div>
    <div class="sheet-sub">Deal any position to test how a hand is arranged. Pick a starting point, edit the map, deal it. It plays as pass &amp; play.</div>
    <pre class="sb-help">p1: AS 2S 3S 7H 7D 7C 9S 10D QH KC
p2: 4S 5S 6S 8H 8D 8C 9D JD QD 2C
discard: 5H        # bottom first, top last
stock: 3C 4C       # top first; the rest of the
                   # deck follows in deck order
turn: p1           # or p2
phase: draw        # upcard, draw or discard
drawn: KC          # discard phase: the card just
                   # drawn from the stock (the dot)
melds: 7H 7D 7C | AS 2S 3S   # p1's hand-made melds
target: 100</pre>
    <div class="sheet-sub" style="margin-top:10px;">Cards are A 2 … 10 J Q K (T for ten) and S H D C, in any case; <code>#</code> starts a comment. Only p1, p2 and a discard card are needed. In the discard phase the turn player holds eleven.</div>
    <div class="sheet-sub">Console: <code>__gin.sandbox(map)</code> deals a map string; <code>__gin.sandboxMap()</code> prints the table as a map you can paste back. Copy puts the map in the clipboard as that call.</div>
    <button class="btn btn-ghost btn-block btn-sm" id="closeSandboxHelpBtn" style="margin-top:14px;">Close</button>
  </div>
</div>

<!-- ROUND RESULT -->
<div id="roundResultOverlay" class="overlay hidden">
  <div class="sheet">
    <div style="text-align:center; font-size:2rem;">🀄</div>
    <div class="sheet-title" id="rrTitle">Hand over</div>
    <div class="sheet-sub" id="rrSub"></div>
    <div id="rrBody"></div>
    <button class="btn btn-go btn-block" id="rrContinueBtn" style="margin-top:10px;">Next hand</button>
    <button class="btn btn-ghost btn-block btn-sm" id="rrHideBtn" style="margin-top:8px;">Look at the table</button>
  </div>
</div>`,
  sheetsAfter: '',
  rulesIcon: `    <div style="text-align:center; font-size:2rem;">📖</div>`,
};

export const GIN_PAGE: ShellPage = { copy, notes, look, blocks };
