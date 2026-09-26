// Backgammon's shell page (docs/design/dry-round-2.md §3 row G2, §5 Wave F row F2): what
// tools/shell-markup.ts fills web/shared/markup/shell/*.html with to compose ./index.html, which
// test/dist/shell-markup.test.ts pins byte for byte. The page is Prettier's (`prettier --check`
// runs over it), so the composer formats the render with the repo's config and the residue here
// (`blocks`: the head with its fonts, the table with its 24 points and the roll modal, the endgame,
// the result, cube and resign sheets, the menu and the leave confirm, the two rows of selects and
// the players row) is the committed, formatted bytes, cut out of the page with the blank line each
// follows; the looks (`look`) are the theme's classes (docs/design/backgammon-board.md §5.1) where
// gin carries inline styles.
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
    'One phone, no internet needed. The board stays in view; a curtain says whose turn it is.',
  hostWaitTitle: 'Your table',
  hostWaitSubtitle: 'Have your opponent open this same page and enter the code',
  openingMsg: 'Opening the table…',
  keepOpenNote:
    'Keep this screen open while your opponent joins. If you switch apps, come straight back and the table reconnects on its own.',
  startLabel: 'Start the match',
  curtainSub: 'Your turn.',
  revealLabel: 'Roll',
  rulesTitle: 'Rules',
  historyTitle: 'This game',
};

const notes: ShellNotes = {
  homeNote: ` (docs/design/backgammon-board.md §5.1; "design §N" below is that document):
           Online (the default, as gin's) or Pass the phone.`,
  rulesTabNote: ': rules.ts fills the list for the chosen variant.',
  glossaryDoc: 'glossary-links.md',
  aboutClose: '',
  curtainNote: ' (design §4.9): a translucent wash, the board readable beneath.',
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
    <meta property="og:title" content="Sheshbesh" />
    <meta
      property="og:description"
      content="Sheshbesh: backgammon the Sephardic-Greek way. Pass one phone, or open a table online and send the link."
    />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://games.sweedler.com/backgammon/" />
    <meta property="og:image" content="https://games.sweedler.com/backgammon/splash.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta
      property="og:image:alt"
      content="Sheshbesh: olive-wood points and two checkers on an aegean blue panel"
    />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Sheshbesh" />
    <meta
      name="twitter:description"
      content="Sheshbesh: backgammon the Sephardic-Greek way. Pass one phone, or open a table online and send the link."
    />
    <meta name="twitter:image" content="https://games.sweedler.com/backgammon/splash.png" />
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    />
    <title>Sheshbesh — backgammon</title>
    <link rel="icon" href="../../shared/favicon.svg" type="image/svg+xml" />
    <link rel="alternate icon" href="../../shared/favicon.ico" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=GFS+Didot&family=Cardo:ital,wght@0,400;0,700;1,400&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="../../shared/styles/tokens.css" />
    <link rel="stylesheet" href="../../shared/styles/base.css" />
    <link rel="stylesheet" href="../../shared/styles/shell.css" />
    <link rel="stylesheet" href="./theme.css" />
  </head>`,
  masthead: `        <div class="masthead">
          <h1>Sheshbesh</h1>
          <div class="subtitle">Backgammon</div>
        </div>`,
  submenuExtra: '',
  extraTabs: '',
  switchExtra: '',
  hostFields: `              <div class="row">
                <div class="field grow">
                  <span class="field-label">Match to</span>
                  <select id="matchLengthSel">
                    <option value="1">1 point</option>
                    <option value="3">3 points</option>
                    <option value="5" selected>5 points</option>
                    <option value="7">7 points</option>
                  </select>
                </div>
                <div class="field grow">
                  <span class="field-label">Rules</span>
                  <select id="variantSel">
                    <option value="portes" selected>Portes</option>
                    <option value="backgammon">Western</option>
                  </select>
                </div>
              </div>
              <button class="btn btn-go btn-block" id="hostBtn">Open a table</button>`,
  localFields: `            <div class="card-box">
              <label>Players</label>
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
            </div>
            <div class="card-box">
              <div class="row">
                <div class="field grow">
                  <span class="field-label">Match to</span>
                  <select id="localMatchLengthSel">
                    <option value="1">1 point</option>
                    <option value="3">3 points</option>
                    <option value="5" selected>5 points</option>
                    <option value="7">7 points</option>
                  </select>
                </div>
                <div class="field grow">
                  <span class="field-label">Rules</span>
                  <select id="localVariantSel">
                    <option value="portes" selected>Portes</option>
                    <option value="backgammon">Western</option>
                  </select>
                </div>
              </div>
            </div>`,
  playExtra: '',
  extraPanels: '',
  extraScreens: '',
  hostWaitList: '',
  guestWaitList: '',
  table: `      <!-- TABLE (design §2.1). The 24 points are direct children of #board in absolute order;
           the seat perspective is data-own on each point and data-seat on the board, written by
           paintSeat; the static markup ships seat 0's. -->
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
          <div class="opp-strip">
            <span class="name" id="oppName">Opponent</span>
            <span class="conn-dot" id="oppDot"></span>
            <span class="pips" id="pipsOpp">167</span>
          </div>
          <div class="badge dim" id="gameBadge">Game 1 · to 5</div>
          <div class="row tight">
            <button class="icon-btn desk-only" id="rulesBtnGame" title="Rules" aria-label="Rules">
              ?
            </button>
            <button class="icon-btn desk-only" id="historyBtn" title="History" aria-label="History">
              ≡
            </button>
            <button class="icon-btn" id="soundBtn" title="Sound &amp; vibration" aria-label="Sound">
              🔊
            </button>
          </div>
        </div>
        <div class="status-line" id="statusLine" aria-live="polite">
          <span id="statusText">—</span><span class="sr-only" id="statusDice"></span>
        </div>

        <div class="board" id="board" data-seat="0">
          <div
            class="point pt-a pt-near"
            id="point-1"
            data-abs="1"
            data-own="1"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-near"
            id="point-2"
            data-abs="2"
            data-own="2"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-near"
            id="point-3"
            data-abs="3"
            data-own="3"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-near"
            id="point-4"
            data-abs="4"
            data-own="4"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-near"
            id="point-5"
            data-abs="5"
            data-own="5"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-near"
            id="point-6"
            data-abs="6"
            data-own="6"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-near"
            id="point-7"
            data-abs="7"
            data-own="7"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-near"
            id="point-8"
            data-abs="8"
            data-own="8"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-near"
            id="point-9"
            data-abs="9"
            data-own="9"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-near"
            id="point-10"
            data-abs="10"
            data-own="10"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-near"
            id="point-11"
            data-abs="11"
            data-own="11"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-near"
            id="point-12"
            data-abs="12"
            data-own="12"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-far"
            id="point-13"
            data-abs="13"
            data-own="13"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-far"
            id="point-14"
            data-abs="14"
            data-own="14"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-far"
            id="point-15"
            data-abs="15"
            data-own="15"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-far"
            id="point-16"
            data-abs="16"
            data-own="16"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-far"
            id="point-17"
            data-abs="17"
            data-own="17"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-far"
            id="point-18"
            data-abs="18"
            data-own="18"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-far"
            id="point-19"
            data-abs="19"
            data-own="19"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-far"
            id="point-20"
            data-abs="20"
            data-own="20"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-far"
            id="point-21"
            data-abs="21"
            data-own="21"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-far"
            id="point-22"
            data-abs="22"
            data-own="22"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-a pt-far"
            id="point-23"
            data-abs="23"
            data-own="23"
            role="button"
            tabindex="0"
          ></div>
          <div
            class="point pt-b pt-far"
            id="point-24"
            data-abs="24"
            data-own="24"
            role="button"
            tabindex="0"
          ></div>
          <div class="bar far" id="barTop" role="button" tabindex="0"></div>
          <div class="dice" id="dice" role="button" tabindex="0" aria-label="Roll"></div>
          <div class="cube hidden" id="cube" data-owner="none">1</div>
          <div class="bar near" id="barBottom" role="button" tabindex="0"></div>
          <div class="off" id="offLight" data-owner="0" role="button" tabindex="0"></div>
          <div class="off" id="offDark" data-owner="1" role="button" tabindex="0"></div>
          <!-- Whose turn (the owner, 2026-09-25: "a swooping arrow so if it were scaled up and
               superimposed on the board it would start from top right go to top left then bottom
               left and head ends at bottom right (off)"; "about the size of a checker and off to
               the left of the board"): the mover's route as one stroke in their checker's ring
               colour, positioned by theme.css off the frame's left edge (data-seat, data-side from
               render.ts paintTurn; the far player's route is the swoop mirrored); their tray wears
               the same colours (theme.css .off.to-move). The path is the desktop board's route:
               the phone's stood-on-end board turns it a quarter in CSS. -->
          <svg
            class="turn-arrow hidden"
            id="turnArrow"
            viewBox="0 0 100 100"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M90 14H34Q14 14 14 34V62Q14 82 34 82H84M74 72l10 10-10 10" />
          </svg>
          <!-- ROLL (design §4.7): the start-of-turn call to action, over the board alone (the topbar
               stays in reach). Nothing dismisses it: it goes when the dice have settled. -->
          <div
            class="roll-modal hidden"
            id="rollOverlay"
            role="dialog"
            aria-labelledby="rollModalTitle"
          >
            <div class="sheet centered roll-sheet">
              <div class="sheet-title" id="rollModalTitle">Your turn</div>
              <div class="sheet-sub" id="rollModalSub">Roll to start your turn</div>
              <div class="roll-dice" id="rollModalDice" aria-hidden="true"></div>
              <button class="btn btn-go btn-block roll-cta" id="rollModalBtn">
                Buen mazal! <small>roll</small>
              </button>
              <button class="btn btn-secondary btn-block btn-sm hidden" id="doubleBtn">
                Double
              </button>
            </div>
          </div>
        </div>

        <div class="controls" id="controls">
          <div class="me-strip">
            <span class="name" id="myName">You</span>
            <span class="pips" id="pipsMe">167</span>
          </div>
          <button class="btn btn-secondary btn-sm" id="undoBtn" disabled>Undo</button>
          <!-- Reserved (design §1 "Turn end"): the turn ends by itself; hidden in every state. -->
          <button class="btn btn-secondary btn-sm hidden" id="doneBtn">Done</button>
          <!-- The roll slot (design §3.2): the mini dice, the wait note and the result chip share
               one box; the roll itself is the modal's (#rollOverlay, in the board). -->
          <div class="roll-slot">
            <div class="dice-mini hidden" id="diceMini"></div>
            <div class="wait-note hidden" id="waitNote">Waiting…</div>
            <button class="btn btn-secondary btn-sm hidden" id="resultChipBtn">Result</button>
          </div>
          <div class="chips hidden" id="moveChips"></div>
          <button class="icon-btn hidden" id="chipCancelBtn" aria-label="Cancel">✕</button>
        </div>
      </div>`,
  endgame: `      <!-- ENDGAME: the match is over (design §4.11). -->
      <div id="endgameScreen" class="hidden">
        <h1>Match over</h1>
        <div class="card-box centered">
          <div class="sheet-title" id="resultTitle">Player takes the match</div>
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
    <!-- GAME RESULT (design §4.11): the sheet over the dimmed board. -->
    <div id="resultOverlay" class="overlay hidden">
      <div class="sheet centered">
        <div class="sheet-title" id="rsTitle">Game over</div>
        <div class="sheet-sub" id="rsSub"></div>
        <div class="score-line" id="rsScore"></div>
        <button class="btn btn-go btn-block" id="rsNextBtn">Next game</button>
        <button class="btn btn-ghost btn-block btn-sm" id="rsPeekBtn">Look at the table</button>
      </div>
    </div>

    <!-- DOUBLE OFFERED (Western only, design §4.8). -->
    <div id="cubeOverlay" class="overlay hidden">
      <div class="sheet centered">
        <div class="sheet-title">The cube</div>
        <div class="sheet-sub" id="cubeOfferText">Your opponent doubles. Take or pass?</div>
        <div class="row">
          <button class="btn btn-secondary grow" id="passBtn">Pass</button>
          <button class="btn btn-primary grow" id="takeBtn">Take</button>
        </div>
      </div>
    </div>

    <!-- RESIGN: reserved for v1.1 (design §2.3); present, hidden, no binder in v1. -->
    <div id="resignOverlay" class="overlay hidden">
      <div class="sheet centered">
        <div class="sheet-title">Resign</div>
        <div class="sheet-sub">Offer to concede this game.</div>
        <div class="row" id="resignLevelBtns">
          <button class="btn btn-secondary grow" data-level="1">Single</button>
          <button class="btn btn-secondary grow" data-level="2">Gammon</button>
          <button class="btn btn-secondary grow" data-level="3">Backgammon</button>
        </div>
        <button class="btn btn-ghost btn-block btn-sm" id="cancelResignBtn">Cancel</button>
      </div>
    </div>`,
  sheetsAfter: `
    <!-- MENU (the phone's home for rules and history, design §2.3). -->
    <div id="menuOverlay" class="overlay hidden">
      <div class="sheet">
        <div class="row between">
          <div class="sheet-title">Menu</div>
          <button class="btn btn-ghost btn-sm" id="closeMenuBtn">Close</button>
        </div>
        <div class="menu-list">
          <button class="btn btn-secondary btn-block" id="menuRulesBtn">Rules</button>
          <button class="btn btn-secondary btn-block" id="menuHistoryBtn">History</button>
          <label class="toggle-row">
            <input type="checkbox" id="menuCurtainToggle" checked />
            <span>Curtain between turns</span>
          </label>
          <button class="btn btn-ghost btn-block" id="menuLeaveBtn">Leave the table</button>
        </div>
      </div>
    </div>

    <!-- LEAVE CONFIRM -->
    <div id="leaveConfirm" class="overlay hidden">
      <div class="sheet centered">
        <div class="sheet-title">Leave the table?</div>
        <div class="sheet-sub" id="leaveConfirmText">The game will be lost.</div>
        <div class="row">
          <button class="btn btn-secondary grow" id="leaveCancelBtn">Stay</button>
          <button class="btn btn-primary grow" id="leaveConfirmBtn">Leave</button>
        </div>
      </div>
    </div>`,
  rulesIcon: '',
};

export const BACKGAMMON_PAGE: ShellPage = { copy, notes, look, blocks };
