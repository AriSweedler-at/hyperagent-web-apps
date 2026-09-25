// Sheshbesh's pass-and-play on one page (docs/design/backgammon-board.md §4, §5, §7), at a phone
// and a laptop, the game's half: the home screen's own fields (the shell's half of the home screen
// and of the pass-and-play start is e2e/shell-home.spec.ts and e2e/shell-local.spec.ts, for both
// shell games). The table: a game starts under the curtain naming the opening winner, whose reveal
// brings the roll modal (portes; it cannot be dismissed, its button rolls and the dice tumble) or
// the opening dice to play (Western); tap-to-move plays a turn with the legal sources and targets lit as the engine's view
// has them and the status line naming what is left; undo rewinds; the die-chip tray opens where
// both dice bear the same checker off; a hit raises the Kapará toast for the player hit; a
// bear-off ends the game with the gammon named on the result sheet; a match end reaches the end
// screen; the Western variant shows the cube and the Double button, and a double runs through the
// curtain to Take. Positions are seated through `window.__backgammon.setup` (the shell's
// `position/load`, web/shared/ui/shell.ts); the dice come from the seeded `Math.random` every
// player context installs (e2e/fixtures/seed.ts), which main.ts reads as `window.__rng ?? Math.random`.
import type { Page } from '@playwright/test';

import { diceText, type View } from '../web/games/backgammon/src/engine/index.ts';
import {
  bgCurtain,
  bgMove,
  bgPosition,
  bgRoll,
  bgSetup,
  bgStartLocal,
  bgTap,
  bgUndo,
  ownOfId,
  ownPlace,
  ownPointId,
  requireBoard,
  type Viewport,
} from './fixtures/backgammon.ts';
import { boardGeometry, expectBoardGeometry } from './fixtures/backgammon-geometry.ts';
import { reveal } from './fixtures/shell.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const VIEWPORTS: Readonly<Record<string, Viewport>> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

/** Light to play 6-3 from the start against a Dark blot on Light's 7: 13/4 reaches it two ways (design §4.3). */
const TWO_ORDERS = 'L: 24:2 13:5 8:3 6:5 | D: 18:1 2:14 | bar 0/0 | off 0/0';
/** Light bears off with 6-5 from own 4: both dice suffice (the tray), then 2/off wins a gammon. */
const BOTH_SUFFICE = 'L: 4:1 2:1 | D: 24:2 1:13 | bar 0/0 | off 13/0';
/** A Dark blot on Light's 5-point (Dark's 20); Light rolls 3-1 and hits it with the 3 from the 8. */
const BLOT_ON_FIVE = 'L: 24:2 13:5 8:3 6:5 | D: 20:1 24:2 13:5 8:3 6:4 | bar 0/0 | off 0/0';
const START = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';

/** The own numbers of the `.point`s wearing `cls`, as the viewer counts them. */
const litPoints = async (page: Page, cls: string, view: View): Promise<ReadonlyArray<number>> => {
  const ids = await page.evaluate<ReadonlyArray<string>>(
    `Array.from(document.querySelectorAll('#board .point.${cls}')).map((p) => p.id)`,
  );
  return ids.map((id) => ownOfId(view, id)).sort((a, b) => a - b);
};

/** The own numbers the engine's legal moves start from (points only). */
const sourcePoints = (view: View): ReadonlyArray<number> =>
  [...new Set(view.legal.map((m) => m.from))]
    .flatMap((from) => (from === 'bar' ? [] : [ownPlace(view, from)]))
    .filter((p): p is number => typeof p === 'number')
    .sort((a, b) => a - b);

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test("home: the table's own fields: the online panel's variant and match length, the second seat's placeholder, nine rules", async ({
      player,
      project,
    }) => {
      const { page } = player;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(pagePath(project, 'backgammon'));
      // The online panel carries the two selects beside the name and the code form.
      await expect(page.locator('#variantSel')).toHaveValue('portes');
      await expect(page.locator('#matchLengthSel')).toHaveValue('5');
      await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
      // Gin's convention: the second seat is a placeholder, and an empty name plays as "Jeff".
      await expect(page.locator('#p2NameInput')).toHaveAttribute('placeholder', 'Player 2');
      await page.locator('#tabRulesBtn').click();
      await expect(page.locator('#rulesList li')).toHaveCount(9);
    });

    test('pass and play: the curtain names the opening winner; the reveal brings the roll modal, which nothing dismisses; its button rolls, the dice tumble and settle', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      const view = await requireBoard(page);
      expect(view.phase).toBe('toRoll');
      const first = view.players[view.turn].name;
      const other = view.players[view.turn === 0 ? 1 : 0].name;
      // The curtain covers a live board (the position is readable beneath) and hands it to the
      // opening winner: one tap reveals; the roll waits in the modal (design §4.9, §4.7).
      const curtain = await bgCurtain(page);
      // The first curtain carries the opening roll from the engine's log.
      const opening = view.log.filter((e) => e.kind === 'opening').at(-1)?.text ?? '';
      expect(opening).toMatch(/ starts$/);
      expect(curtain).toEqual({
        title: `Pass the phone to ${first}`,
        sub: 'Your turn. Roll when you have the phone.',
        last: opening,
        button: `${first} — your turn`,
      });
      await expect(page.locator('#dice .die.blank')).toHaveCount(2);
      await expect(page.locator('#rollOverlay')).toBeHidden();
      await page.locator('#curtainBtn').click();
      await expect(page.locator('#curtainOverlay')).toBeHidden();
      // The modal: the seat's name, two blank dice, the call to action; still `toRoll` beneath.
      const modal = page.locator('#rollOverlay');
      await expect(modal).toBeVisible();
      await expect(page.locator('#rollModalTitle')).toHaveText(`${first} — your turn`);
      await expect(page.locator('#rollModalDice .die.blank')).toHaveCount(2);
      await expect(page.locator('#rollModalBtn')).toContainText('Buen mazal!');
      await expect(page.locator('#rollModalBtn small')).toHaveText('roll');
      expect((await requireBoard(page)).phase).toBe('toRoll');
      // Nothing dismisses it: a tap on its backdrop, Escape.
      await modal.click({ position: { x: 4, y: 4 } });
      await page.keyboard.press('Escape');
      await expect(modal).toBeVisible();
      expect((await requireBoard(page)).phase).toBe('toRoll');
      // The button rolls: the engine has rolled at once, the dice tumble (`data-rolling`) with the
      // button held and the board inert, then settle (`data-rolled`) and the modal goes.
      await page.locator('#rollModalBtn').click();
      await expect(page.locator('#board')).toHaveAttribute('data-rolling', '1');
      expect((await requireBoard(page)).phase).toBe('moving');
      await expect(page.locator('#rollModalBtn')).toBeDisabled();
      await expect(page.locator('#board')).toHaveClass(/\binert\b/);
      await expect(page.locator('#dice')).toHaveClass(/\brolling\b/);
      await expect(page.locator('#board')).toHaveAttribute('data-rolled', '1');
      await expect(page.locator('#board')).not.toHaveAttribute('data-rolling', '1');
      await expect(modal).toBeHidden();
      await expect(page.locator('#board')).not.toHaveClass(/\binert\b/);
      const rolled = await requireBoard(page);
      const dice = rolled.dice;
      if (dice === null) throw new Error('no dice after the roll');
      const faces = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [dice[0], dice[1]];
      await expect(page.locator('#dice .die:not(.blank)')).toHaveCount(faces.length);
      const shown = await page.evaluate<ReadonlyArray<string | null>>(
        `Array.from(document.querySelectorAll('#dice .die')).map((d) => d.getAttribute('data-die'))`,
      );
      expect(shown).toEqual(faces.map(String));
      await expect(page.locator('#myName')).toHaveText(first);
      await expect(page.locator('#oppName')).toHaveText(other);
      await expect(page.locator('#statusText')).toHaveText(
        `${diceText(dice)} · play ${faces.length === 4 ? 'all four' : 'both dice'}`,
      );
      await expect(page.locator('#gameBadge')).toHaveText('Game 1 · 0–0 · to 5');
      await expect(page.locator('#diceMini')).toBeVisible();
    });

    test('tap to move: the legal sources light, a source lights its targets, the status names what is left, undo rewinds', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      // Before a roll: the modal over the board, blank dice; the roll fills them (design §4.7).
      await bgSetup(page, bgPosition({ text: START, turn: 0 }));
      await expect(page.locator('#rollOverlay')).toBeVisible();
      await expect(page.locator('#rollModalBtn')).toContainText('Buen mazal!');
      await expect(page.locator('#rollModalBtn small')).toHaveText('roll');
      await expect(page.locator('#dice .die.blank')).toHaveCount(2);
      await expect(page.locator('#statusText')).toHaveText('Your turn. Buen mazal!');
      const v = await bgRoll(page);
      await expect(page.locator('#dice .die.blank')).toHaveCount(0);
      // Every point the engine lets move wears `can-move`, and nothing else does (design §7).
      expect(await litPoints(page, 'can-move', v)).toEqual(sourcePoints(v));
      expect(await litPoints(page, 'selected', v)).toEqual(
        sourcePoints(v).length === 1 ? sourcePoints(v) : [],
      );
      const [first] = v.legal;
      if (first === undefined || first.from === 'bar') throw new Error('no point to move from');
      const from = ownPlace(v, first.from);
      await bgTap(page, from);
      const source = page.locator(`#${ownPointId(v, from as number)}`);
      await expect(source).toHaveClass(/\bselected\b/);
      await expect(source).toHaveAttribute('aria-pressed', 'true');
      // Its targets: every single-die destination from there, each disc naming its die.
      const singles = v.legal.filter((m) => m.from === first.from && m.to !== 'off');
      const targets = await litPoints(page, 'target', v);
      singles.forEach((m) => {
        expect(targets, `${String(m.die)} from ${String(from)}`).toContain(ownPlace(v, m.to));
      });
      await expect(
        page.locator(`#${ownPointId(v, ownPlace(v, singles[0]?.to ?? 0) as number)}`),
      ).toHaveAttribute('data-die', String(singles[0]?.die));
      await expect(page.locator('#undoBtn')).toBeDisabled();

      const after = await bgMove(page, from, ownPlace(v, first.to));
      expect(after.played).toHaveLength(1);
      await expect(page.locator(`#dice .die.die-${String(first.die)}.used`)).toHaveCount(1);
      await expect(page.locator('#statusText')).toHaveText(
        after.plays[0]?.length === 1
          ? 'Last move: the turn ends when you play it'
          : new RegExp(`^${diceText(after.dice ?? [1, 1])} · \\d moves left$`),
      );
      await expect(page.locator('#undoBtn')).toBeEnabled();
      const undone = await bgUndo(page);
      expect(undone.board).toEqual(v.board);
      await expect(page.locator('#dice .die.used')).toHaveCount(0);
      await expect(page.locator('#undoBtn')).toBeDisabled();
      expect(await litPoints(page, 'can-move', undone)).toEqual(sourcePoints(v));
    });

    test('a combined move two ways: the disc reads 6+3?, the tray offers the hit and the quiet path', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      const v = await bgSetup(page, bgPosition({ text: TWO_ORDERS, turn: 0, dice: [6, 3] }));
      await bgTap(page, 13);
      // 13/7* with the 6 and 13/10 with the 3 are single steps; 13/4 needs both and the paths
      // differ (7 is a hit), so the disc asks (design §4.1 `targetsOf`).
      await expect(page.locator(`#${ownPointId(v, 7)}`)).toHaveAttribute('data-die', '6');
      await expect(page.locator(`#${ownPointId(v, 10)}`)).toHaveAttribute('data-die', '3');
      const four = page.locator(`#${ownPointId(v, 4)}`);
      await expect(four).toHaveClass(/\btarget-2\b/);
      await expect(four).toHaveAttribute('data-die', '6+3?');
      await four.click();
      await expect(page.locator('#controls')).toHaveClass(/\bchoosing\b/);
      await expect(page.locator('#statusText')).toHaveText('13 · 6+3 reaches 4 two ways');
      const chips = page.locator('#moveChips .chip');
      await expect(chips).toHaveCount(2);
      await expect(chips.nth(0)).toHaveAttribute('data-dice', '6+3');
      await expect(chips.nth(0)).toHaveAttribute('data-to', '4');
      await expect(chips.nth(0)).toHaveAttribute('data-via', '7');
      await expect(chips.nth(0)).toHaveAttribute('data-hit', '7');
      await expect(chips.nth(1)).toHaveAttribute('data-dice', '3+6');
      await expect(chips.nth(1)).toHaveAttribute('data-via', '10');
      await chips.nth(0).click();
      // Both dice spent through the hit: the turn is Bob's, his checker on the bar.
      await expect.poll(async () => (await requireBoard(page)).lastPlay.length).toBe(2);
      const after = await requireBoard(page);
      expect(after.board.bar).toEqual([0, 1]);
      await expect(page.locator('#curtainOverlay')).toBeVisible();
    });

    test('the die-chip tray: both dice bear the same checker off; a bear-off ends the game with a gammon on the sheet', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      const v = await bgSetup(page, bgPosition({ text: BOTH_SUFFICE, turn: 0, dice: [6, 5] }));
      expect(v.me.idx).toBe(0);
      // The tray disc names both dice; the tap opens two chips, the higher die first (design §4.4).
      await expect(page.locator('#offLight')).toHaveClass(/\btarget\b/);
      await expect(page.locator('#offLight')).toHaveAttribute('data-die', '6·5');
      await bgTap(page, 'off');
      await expect(page.locator('#controls')).toHaveClass(/\bchoosing\b/);
      const chips = page.locator('#moveChips .chip');
      await expect(chips).toHaveCount(2);
      await expect(chips.nth(0)).toHaveAttribute('data-dice', '6');
      await expect(chips.nth(1)).toHaveAttribute('data-dice', '5');
      await expect(chips.nth(0)).toHaveAttribute('data-to', 'off');
      await expect(page.locator('#statusText')).toHaveText('4 · either die bears off');
      // The ✕ closes the tray; the tap opens it again, and a chip spends its die.
      await page.locator('#chipCancelBtn').click();
      await expect(page.locator('#controls')).not.toHaveClass(/\bchoosing\b/);
      await bgTap(page, 'off');
      await chips.nth(1).click();
      await expect.poll(async () => (await requireBoard(page)).played.length).toBe(1);
      await expect(page.locator('#dice .die.die-5.used')).toHaveCount(1);
      await expect(page.locator('#offLight .slab')).toHaveCount(14);
      await expect(page.locator('#statusText')).toHaveText(
        'Last move: the turn ends when you play it',
      );
      // The last checker off: the game is over, Dark has borne nothing off, so it is a gammon.
      await bgMove(page, 2, 'off');
      await expect(page.locator('#offLight .slab')).toHaveCount(15);
      await expect(page.locator('#resultOverlay')).toBeVisible();
      await expect(page.locator('#rsTitle')).toHaveText('Ann wins 2 points · gammon');
      await expect(page.locator('#rsSub')).toHaveText(/^Bob had 15 checkers left · \d+ pips$/);
      await expect(page.locator('#rsScore')).toHaveText('Ann 2 – 0 Bob · match to 5');
      await expect(page.locator('#rsNextBtn')).toHaveText('Next game');
      // A look at the table: the sheet closes and the Result chip brings it back.
      await page.locator('#rsPeekBtn').click();
      await expect(page.locator('#resultOverlay')).toBeHidden();
      await expect(page.locator('#statusText')).toHaveText('Ann wins 2 points · gammon');
      await page.locator('#resultChipBtn').click();
      await expect(page.locator('#resultOverlay')).toBeVisible();
      await expect(page.locator('#gameBadge')).toHaveText('Game 1 · 2–0 · to 5');
    });

    test('a match end: the gammon that reaches the match length shows the end screen with the score', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      await bgSetup(page, bgPosition({ text: BOTH_SUFFICE, turn: 0, dice: [6, 5], score: [3, 0] }));
      await expect(page.locator('#gameBadge')).toHaveText('Game 1 · 3–0 · to 5');
      await bgMove(page, 4, 'off');
      await bgMove(page, 2, 'off');
      await expect(page.locator('#endgameScreen')).toBeVisible();
      await expect(page.locator('#tableScreen')).toBeHidden();
      await expect(page.locator('#resultTitle')).toHaveText('Ann takes the match 5–0');
      await expect(page.locator('#resultSub')).toHaveText('1 game');
      await expect(page.locator('#matchScore .score-row')).toHaveCount(1);
      await expect(page.locator('#matchScore .score-row')).toContainText('Ann');
      await expect(page.locator('#nextGameBtn')).toHaveText('Rematch');
      await expect(page.locator('#leaveBtn')).toBeVisible();
    });

    test('a hit: the turn ends on 8/5*, the curtain names the hit and the Kapará toast tells the player hit', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      await bgSetup(page, bgPosition({ text: BLOT_ON_FIVE, turn: 0, dice: [3, 1] }));
      await bgMove(page, 8, 7);
      const after = await bgMove(page, 8, 5);
      // The turn passed to Bob: the page shows his view under the curtain, his checker on the bar.
      expect(after.me.idx).toBe(1);
      expect(after.board.bar).toEqual([0, 1]);
      expect(after.lastPlay.map((m) => m.hit)).toEqual([false, true]);
      await expect(page.locator('#barBottom .checker.ck-dark')).toHaveCount(1);
      const curtain = await bgCurtain(page);
      expect(curtain.title).toBe('Pass the phone to Bob');
      // The hit line in Bob's numbering (the board beneath is his): Ann's 5-point is his 20.
      expect(curtain.last).toBe('Ann moved 8/7 8/5* · Ann hit you on your 20-point');
      // Nothing is toasted while Ann still holds the phone; Bob's reveal brings the "Kapará."
      // toast, in his own numbering (docs/design/backgammon-board.md §4.9).
      const toast = page.locator('#toast');
      await expect(toast).not.toHaveClass(/\bshow\b/);
      await reveal(page);
      await expect(toast).toBeVisible();
      await expect(toast).toHaveText('Kapará. Ann hit you on your 20-point.');
      await expect(toast).toHaveClass(/\bhit\b/);
    });

    test('Western rules: the opening winner plays the opening dice, the cube shows, Double appears before a roll and runs through the curtain to Take', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp, undefined, {
        variant: 'backgammon',
      });
      const view = await requireBoard(page);
      expect(view).toMatchObject({ variant: 'backgammon', phase: 'moving' });
      const first = view.players[view.turn].name;
      const dice = view.dice;
      if (dice === null) throw new Error('the Western opening carries no dice');
      // The starter already holds the opening pair: the button reveals and no roll modal comes (Q4).
      const curtain = await bgCurtain(page);
      expect(curtain.button).toBe(`${first} — play ${diceText(dice)}`);
      await reveal(page);
      expect((await requireBoard(page)).phase).toBe('moving');
      await expect(page.locator('#rollOverlay')).toBeHidden();
      await expect(page.locator('#dice .die:not(.blank)')).toHaveCount(2);
      await expect(page.locator('#cube')).toBeVisible();
      await expect(page.locator('#cube')).toHaveText('1');
      await expect(page.locator('#cube')).toHaveAttribute('data-owner', 'none');
      await expect(page.locator('#doubleBtn')).toBeHidden();
      await expect(page.locator('#rulesList li, #rulesOverlayList li')).toHaveCount(22);

      // Before a roll the cube is on offer: Double beside Roll, in the modal (design §4.8).
      await bgSetup(page, bgPosition({ text: START, turn: 0, variant: 'backgammon' }));
      await expect(page.locator('#rollOverlay')).toBeVisible();
      await expect(page.locator('#rollModalSub')).toHaveText('Double, or roll to start your turn');
      await expect(page.locator('#doubleBtn')).toBeVisible();
      await expect(page.locator('#statusText')).toHaveText('Your turn. Double or roll');
      await page.locator('#doubleBtn').click();
      // Pass-and-play: the curtain first, then the offer for the other seat.
      const offered = await bgCurtain(page);
      expect(offered).toMatchObject({
        title: 'Pass the phone to Bob',
        sub: 'Ann doubles to 2',
        button: 'Bob — answer',
      });
      await reveal(page);
      await expect(page.locator('#cubeOverlay')).toBeVisible();
      await expect(page.locator('#cubeOfferText')).toHaveText('Ann doubles to 2. Take or pass?');
      await expect(page.locator('#passBtn')).toHaveText('Pass (Ann wins 1)');
      await page.locator('#takeBtn').click();
      await expect(page.locator('#cubeOverlay')).toBeHidden();
      // Bob owns the cube at 2 and Ann rolls: her curtain hands her to the roll alone.
      const back = await bgCurtain(page);
      expect(back).toMatchObject({
        title: 'Pass the phone to Ann',
        sub: 'Your turn. Roll when you have the phone.',
        button: 'Ann — your turn',
      });
      await reveal(page);
      await expect(page.locator('#rollOverlay')).toBeVisible();
      await expect(page.locator('#doubleBtn')).toBeHidden();
      await expect(page.locator('#cube')).toHaveText('2');
      expect((await requireBoard(page)).cube).toEqual({ value: 2, owner: 1 });
    });

    test('the geometry oracle: the points tile the board without overlap and every target is 44px on the phone', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await bgStartLocal(page, pagePath(project, 'backgammon'), vp);
      await reveal(page);
      const v = await requireBoard(page);
      expectBoardGeometry(await boardGeometry(page), v.me.idx, false, 'rolled');
    });
  });
});
