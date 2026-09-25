// Briscola's shell page (docs/design/briscola.md §5.2; docs/design/dry-round-2.md §3 row G2): what
// tools/shell-markup.ts fills web/shared/markup/shell/*.html with to compose ./index.html, which
// test/dist/shell-markup.test.ts pins byte for byte. The page is Prettier's, so the composer formats
// the render with the repo's config and the residue here (`blocks`: the head with its two fonts, the
// table with its three relative seat cells, the stock with the briscola under it, the trick band, the
// score strip and the three-slot hand; the endgame; the result sheet; the option
// selects and the four name inputs) is the committed, formatted bytes, cut out of the page with the
// blank line each follows; the looks (`look`) are the theme's classes, as backgammon's are. The
// table ships the 2-player shape (#seatR2 shown, R1 and R3 hidden) so the page fake and the goldens
// see a whole table before any paint; the Italian suit sprite (web/shared/ui/cardFace.ts
// SUIT_SPRITE_SVG) is inlined at boot, not here, so it cannot drift from suits.ts.
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
  hostLabel: 'Open a table',
  joinLabel: 'Sit down at a table',
  joinBtnLabel: 'Sit down',
  localBtnLabel: 'Start',
  localNote:
    'One phone, no internet needed. A curtain names whose turn it is; everyone else looks away.',
  hostWaitTitle: 'Your table',
  openingMsg: 'Opening the table…',
  keepOpenNote:
    'Keep this screen open while the others sit down. If you switch apps, come straight back and the table reconnects on its own.',
  startLabel: 'Start',
  curtainSub: '',
  revealLabel: 'Show my cards',
  rulesTitle: 'Rules',
  historyTitle: 'History',
};

const notes: ShellNotes = {
  homeNote: ` (docs/design/briscola.md §5.8; "design §N" below is that document):
           Online (the default) or Pass the phone for 2, 3 or 4 players.`,
  rulesTabNote: ': ui/rules.ts fills both slots at boot (render.ts renderRules).',
  glossaryDoc: 'glossary-links.md',
  aboutClose: '',
  curtainNote: ' (design §5.4): a terracotta wash, the table readable beneath, the hand face down.',
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
  head: `<!doctype html>
<html lang="en">
  <head>
    <meta property="og:title" content="Briscola" />
    <meta property="og:type" content="website" />
    <meta property="og:image:width" content="1024" />
    <meta property="og:image:height" content="1024" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="Briscola" />
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    />
    <title>Briscola — cards</title>
    <link rel="icon" href="../../shared/favicon.svg" type="image/svg+xml" />
    <link rel="alternate icon" href="../../shared/favicon.ico" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,700&family=Lora:ital,wght@0,400;0,700;1,400&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="../../shared/styles/tokens.css" />
    <link rel="stylesheet" href="../../shared/styles/base.css" />
    <link rel="stylesheet" href="../../shared/styles/shell.css" />
    <link rel="stylesheet" href="./theme.css" />
  </head>`,
  masthead: `        <div class="masthead">
          <h1>Briscola</h1>
          <div class="subtitle">Italian cards for two, three or four</div>
        </div>`,
  submenuExtra: '',
  extraTabs: '',
  switchExtra: '',
  hostFields: `              <div class="row">
                <div class="field grow">
                  <span class="field-label">Players</span>
                  <select id="playersSel">
                    <option value="2" selected>2 players</option>
                    <option value="3" disabled>3 players · online soon</option>
                    <option value="4" disabled>4 players · online soon</option>
                  </select>
                </div>
                <div class="field grow">
                  <span class="field-label">Match</span>
                  <select id="matchSel">
                    <option value="1">One game</option>
                    <option value="2" selected>Best of 3</option>
                    <option value="3">Best of 5</option>
                  </select>
                </div>
              </div>
              <details class="house-rules">
                <summary>House rules</summary>
                <div class="field">
                  <span class="field-label">With three players, the deck drops</span>
                  <select id="removedTwoSel">
                    <option value="C" selected>the 2 di coppe</option>
                    <option value="D">the 2 di denari</option>
                    <option value="S">the 2 di spade</option>
                    <option value="B">the 2 di bastoni</option>
                  </select>
                </div>
                <label class="check-row">
                  <input type="checkbox" id="exchangeChk" />
                  <span>Swap the 7 (or the 2) of trumps for the trump card</span>
                </label>
                <label class="check-row">
                  <input type="checkbox" id="scopertaChk" />
                  <span>Scoperta: hands face up (two players)</span>
                </label>
                <label class="check-row">
                  <input type="checkbox" id="partnerPeekChk" />
                  <span>Partners see each other's hand (four players)</span>
                </label>
              </details>
              <button class="btn btn-go btn-block" id="hostBtn">Open a table</button>`,
  localFields: `            <div class="card-box">
              <div class="row">
                <label class="grow">Players</label>
                <div class="field">
                  <select id="localPlayersSel">
                    <option value="2" selected>2 players</option>
                    <option value="3">3 players</option>
                    <option value="4">4 players</option>
                  </select>
                </div>
              </div>
              <div class="row">
                <input
                  type="text"
                  id="p1NameInput"
                  class="grow"
                  placeholder="Player 1"
                  maxlength="20"
                  autocomplete="off"
                />
                <input
                  type="text"
                  id="p2NameInput"
                  class="grow"
                  placeholder="Player 2"
                  maxlength="20"
                  autocomplete="off"
                />
              </div>
              <div class="row hidden" id="moreNames">
                <input
                  type="text"
                  id="p3NameInput"
                  class="grow"
                  placeholder="Player 3"
                  maxlength="20"
                  autocomplete="off"
                />
                <input
                  type="text"
                  id="p4NameInput"
                  class="grow"
                  placeholder="Player 4"
                  maxlength="20"
                  autocomplete="off"
                />
              </div>
            </div>
            <div class="card-box">
              <div class="field">
                <span class="field-label">Match</span>
                <select id="localMatchSel">
                  <option value="1">One game</option>
                  <option value="2" selected>Best of 3</option>
                  <option value="3">Best of 5</option>
                </select>
              </div>
              <details class="house-rules">
                <summary>House rules</summary>
                <div class="field">
                  <span class="field-label">With three players, the deck drops</span>
                  <select id="localRemovedTwoSel">
                    <option value="C" selected>the 2 di coppe</option>
                    <option value="D">the 2 di denari</option>
                    <option value="S">the 2 di spade</option>
                    <option value="B">the 2 di bastoni</option>
                  </select>
                </div>
                <label class="check-row">
                  <input type="checkbox" id="localExchangeChk" />
                  <span>Swap the 7 (or the 2) of trumps for the trump card</span>
                </label>
                <label class="check-row">
                  <input type="checkbox" id="localScopertaChk" />
                  <span>Scoperta: hands face up (two players)</span>
                </label>
                <label class="check-row">
                  <input type="checkbox" id="localPartnerPeekChk" />
                  <span>Partners see each other's hand (four players)</span>
                </label>
              </details>
            </div>`,
  playExtra: '',
  extraPanels: '',
  extraScreens: '',
  table: `      <!-- TABLE (design §5.2): one DOM for 2, 3 and 4 seats. I sit at the bottom; the other
           seats are relative cells (#seatR1 right, #seatR2 across, #seatR3 left) that seatCells
           (src/ui/layout.ts) maps to absolute seats; the static markup ships the 2-player shape.
           The phone's topbar holds the menu, the two badges and the sound button (a 390px phone
           has no room for more at 44px each): rules, history and leaving are the menu's there,
           and buttons of their own from 900px, as backgammon's are. -->
      <div id="tableScreen" class="hidden">
        <div class="topbar">
          <div class="row tight">
            <button class="icon-btn" id="menuBtn" title="Menu" aria-label="Menu">☰</button>
            <button
              class="icon-btn hidden"
              id="handoffBtn"
              title="Continue online"
              aria-label="Continue online"
            >
              🌐
            </button>
          </div>
          <div class="row tight badges">
            <div class="badge dim" id="gameBadge">Game 1 · 0–0 · best of 3</div>
            <div class="badge trump s-coppe" id="trumpBadge" title="Briscola: cups">
              <svg class="suit" aria-hidden="true"><use /></svg>
              <span id="trumpName">coppe</span>
            </div>
          </div>
          <div class="row tight">
            <button class="icon-btn desk-only" id="rulesBtnGame" title="Rules" aria-label="Rules">
              📖
            </button>
            <button class="icon-btn desk-only" id="historyBtn" title="History" aria-label="History">
              📜
            </button>
            <button
              class="icon-btn"
              id="soundBtn"
              title="Sound &amp; vibration"
              aria-label="Sound"
              aria-pressed="true"
            >
              🔊
            </button>
          </div>
        </div>

        <div class="seats" id="seats" data-players="2">
          <div class="seat" id="seatR3" data-pos="left" data-seat="3" hidden>
            <span class="seat-name">—</span>
            <span class="conn-dot" hidden></span>
            <span class="seat-cards"></span>
            <span class="seat-taken" data-count="0"></span>
          </div>
          <div class="seat" id="seatR2" data-pos="top" data-seat="1">
            <span class="seat-name" id="oppName">Opponent</span>
            <span class="conn-dot" id="oppDot"></span>
            <span class="seat-cards"></span>
            <span class="seat-taken" data-count="0"></span>
          </div>
          <div class="seat" id="seatR1" data-pos="right" data-seat="2" hidden>
            <span class="seat-name">—</span>
            <span class="conn-dot" hidden></span>
            <span class="seat-cards"></span>
            <span class="seat-taken" data-count="0"></span>
          </div>
        </div>

        <div class="table-center" id="tableCenter">
          <div class="stock-area">
            <div class="stock" id="stock" data-count="34" aria-label="Stock, 34 cards">
              <div class="card back mid"></div>
            </div>
            <div class="briscola" id="briscola"></div>
            <div class="pile-label" id="stockCount">Stock · 34</div>
            <div class="pile-label card-name" id="briscolaName"></div>
          </div>
          <div class="trick" id="trick" data-players="2" data-lead="" aria-live="off"></div>
        </div>

        <div class="score-strip" id="scoreStrip" data-mode="players"></div>
        <div class="status-line" id="statusLine" aria-live="polite"><span id="statusText">—</span></div>

        <div class="hand-area">
          <div class="hand-header">
            <span id="myName">You</span>
            <span class="seat-taken my-tricks" id="myTricks" data-count="0"></span>
            <span class="my-taken" id="myTaken">You: 0</span>
          </div>
          <div class="hand" id="hand" data-slots="3">
            <div class="slot empty"></div>
            <div class="slot empty"></div>
            <div class="slot empty"></div>
          </div>
          <div class="actions" id="actions">
            <button class="btn btn-primary grow" id="playBtn" disabled>Play</button>
            <div class="waiting-note hidden" id="waitNote">Waiting…</div>
            <button class="btn btn-secondary btn-sm hidden" id="resultChipBtn">Result</button>
          </div>
        </div>
      </div>`,
  endgame: `      <!-- ENDGAME: the match is over (design §5.1 "Bravi!"). -->
      <div id="endgameScreen" class="hidden">
        <h1>Match over</h1>
        <div class="card-box centered">
          <div class="sheet-title" id="resultTitle">Bravi!</div>
          <div class="sheet-sub" id="resultSub"></div>
        </div>
        <div class="card-box">
          <label>Games</label>
          <div class="score-list" id="matchScore"></div>
        </div>
        <div class="row">
          <button class="btn btn-secondary grow" id="leaveBtn">Leave</button>
          <button class="btn btn-go grow" id="nextGameBtn">Rematch</button>
        </div>
      </div>`,
  curtainIcon: '',
  curtainExtra: `        <button class="btn btn-ghost btn-block btn-sm" id="curtainHandoffBtn">
          Continue online
        </button>`,
  sheetsBefore: `
    <!-- CARD VIEW (docs/design/language-packs.md §5): the briscola tapped, shown large with its name
         in the chosen language pack; no game state changes. -->
    <div id="cardViewOverlay" class="overlay hidden">
      <div class="sheet centered card-view">
        <div class="card-view-face" id="cardViewFace"></div>
        <div class="sheet-sub" id="cardViewName"></div>
        <button class="btn btn-primary btn-block" id="closeCardViewBtn">Close</button>
      </div>
    </div>

    <!-- GAME RESULT (design §5.1): the sheet over the dimmed table; the match end is the shell's
         #endgameScreen. -->
    <div id="resultOverlay" class="overlay hidden">
      <div class="sheet centered">
        <div class="sheet-title" id="rsTitle">Game over</div>
        <div class="sheet-sub" id="rsSub"></div>
        <div class="score-list" id="rsScore"></div>
        <div class="empty-note" id="rsMatch"></div>
        <button class="btn btn-go btn-block" id="rsNextBtn">Next game</button>
        <button class="btn btn-ghost btn-block btn-sm" id="rsPeekBtn">Look at the table</button>
      </div>
    </div>`,
  sheetsAfter: `
    <!-- MENU (the phone's home for rules, history and leaving; from 900px the topbar has the first two). -->
    <div id="menuOverlay" class="overlay hidden">
      <div class="sheet">
        <div class="row between">
          <div class="sheet-title">Menu</div>
          <button class="btn btn-ghost btn-sm" id="closeMenuBtn">Close</button>
        </div>
        <div class="menu-list">
          <button class="btn btn-secondary btn-block" id="menuRulesBtn">Rules</button>
          <button class="btn btn-secondary btn-block" id="menuHistoryBtn">History</button>
          <button class="btn btn-ghost btn-block" id="menuLeaveBtn">Leave the table</button>
        </div>
      </div>
    </div>

    <!-- CARD TIP (docs/design/language-packs.md §5): a hand card's name on hover or a long press, placed over the card by the painter. -->
    <div id="cardTip" class="card-tip hidden" role="tooltip"></div>`,
  rulesIcon: '',
};

export const BRISCOLA_PAGE: ShellPage = { copy, notes, look, blocks };
