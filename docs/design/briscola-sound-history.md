# Briscola trick sounds and the history panel: a plan

Status: PLAN (2026-09-25). Nothing here is implemented. The main agent dispatches it as the PRs in §8.
Owner's words (verbatim, 2026-09-25): see §9. Design context: docs/design/sound-fonts.md (the 20 generic
cues, `Sound = synth | sample | silence`, partial fonts falling back to `default`, one table per game),
docs/design/shared-shell.md §5 `cues`, `web/shared/ui/shell.ts` (`fx` effects, `cues.key` memory,
`cfg.table.rendered(app, prev, ctx)`), backgammon's `cuesBetween(prev, next, role)` + `historyHtml`,
briscola's engine (`TrickRecord`, `LogEntry {seat, kind, text, at}`, `View.log`, `View.lastTrick`).

## 1. The answer in ten lines

1. Keep the 20 generic cues. Add **qualified cues**: dotted names under a base cue
   (`good.trick.briscola.steal`). A font voices any prefix; resolution walks up to the base, then to
   `default`. A simple font voices 20 sounds and covers every cell; a silly one voices every leaf.
2. A table row becomes a **phrase**: ordered steps with declared durations and gaps (`briscola` THEN
   `victory`), one buzz pattern, and optional **voice layers** (announcer lines) in a `voice.*`
   namespace the default font leaves silent. Today's `CueSpec` is a one-step phrase: gin and
   backgammon do not change.
3. The engine's log becomes a **structured event stream**: `GameEvent {kind, seat, at, data}`; the
   sentence is derived in the UI, not stored. Sound and history read the SAME event: an event
   happens, its phrase plays, its row appears. Do this in briscola BEFORE PR-4 records the wire corpus.
4. A shared **history panel** (`web/shared/ui/history.ts`): one `<details>` row per event, a short
   `<summary>` line, click to expand the structured detail. Briscola adopts first; bg and gin later.
5. Briscola's bindings are a pure `phraseOf(event, me)` over the trick-outcome table in §4, pinned by
   a test that enumerates every cell (winner's phrase, loser's phrase, haptics).
6. Assets drop in later through `tools/sound-fonts.ts add <name> --dir <folder>`: files named by cue
   id (`good.trick.briscola.steal.mp3`, `voice.trick.steal.mp3`) become the font's rows, durations
   measured, sizes checked, a manifest test reads every file back (the card-pack tool's shape).
7. No settings UI now: the console hook `__briscola.soundFont(name)` and the key `briscola_soundFont`
   already exist in the design; a later menu lists fonts and previews a phrase.
8. Two shared PRs (cues+phrases; history panel), one engine PR (events), the bindings inside PR-4 (or
   the PR after), one tool PR when the first assets arrive.

## 2. What exists and what it lacks

| Today | Where | Gap for the ask |
|---|---|---|
| 20 flat cues; a game maps event -> one cue + buzz | `lib/sound/cues.ts`, `<game>/src/ui/sound.ts` | no way to voice "briscola steal of a big trick" distinctly without adding a game noun to the shared vocabulary; no fallback ladder finer than cue -> default |
| `fx` effects start immediately; several in one step overlap | `shell.ts` (`{type:'fx', cue}`), `edge/sound.ts` `playSound` | no sequencing ("briscola THEN victory"), no layering (a voice over a sting) |
| Fonts are `Partial<Record<SoundCue, Sound>>` | `lib/sound/fonts.ts` | fine for the base cues; needs the qualified keys and a `voices` table |
| `Sound.sample` exists, no shipped font uses it; no duration known until decoded | `lib/sound/sound.ts`, `edge/sound.ts` | phrases need durations before playback to schedule the next step; the font must declare them |
| Briscola log: `LogEntry {seat, kind, text, at}`, `play` lines are `lastAction` only | `engine/log.ts`, `types.ts` | text-only rows cannot expand; sound would have to parse text or diff `lastTrick` |
| `TrickRecord {no, leader, cards, winner, points, drew, trumpTaken}` | `engine/types.ts` | has everything a trick sound needs EXCEPT the derived flags (winning card, trump used, steal, carico lost); derive them in `apply` once and store them on the event |
| bg `historyHtml`: one `div.history-row` per log line | `backgammon/src/ui/render.ts:617` | flat text, no expansion; gin has the same sheet with its own rows |
| Cue memory `shell.cues.key` once per view key | `shell.ts:67`, bg `viewKey` | good: reuse for "each event's phrase plays once" |

## 3. The shared mechanism (general; no game noun enters `web/shared`)

### 3.1 Qualified cues (`web/shared/lib/sound/cues.ts`)

```ts
export type SoundCue = (typeof SOUND_CUES)[number];              // the 20 base cues, unchanged
export type CueId = SoundCue | `${SoundCue}.${string}`;           // 'good', 'good.trick', 'good.trick.briscola.steal'
export const baseOf = (id: CueId): SoundCue => id.split('.')[0] as SoundCue;
export const ladder = (id: CueId): ReadonlyArray<CueId> =>      // ['good.trick.briscola.steal', 'good.trick.briscola', 'good.trick', 'good']
  id.split('.').map((_, i, parts) => parts.slice(0, parts.length - i).join('.') as CueId);
```

The segments after the base are the GAME's words (briscola says `trick`, `briscola`, `steal`; gin may
say `knock`); the shared code never interprets them, it only walks the ladder. `resolveSound(font,
id)` returns the first sound the font has along the ladder, then the `default` font's along the same
ladder, then its base (total by the existing pin). A font that voices only base cues behaves exactly
as today. `decodeCueId` accepts `[a-z]+(\.[a-z0-9-]+)*` with a known base.

### 3.2 Phrases (`web/shared/lib/sound/phrase.ts`, pure)

```ts
export type Step = Readonly<{ cue: CueId; gapMs?: number }>;    // plays after the previous step ends (+ gap)
export type Voice = Readonly<{ cue: `voice.${string}`; atMs: number; gain?: number }>; // a layer over the steps
export type Phrase = Readonly<{ steps: ReadonlyArray<Step>; voices?: ReadonlyArray<Voice>; buzz: number | ReadonlyArray<number> }>;
export const spec = (cue: CueId, buzz): Phrase => ({ steps: [{ cue }], buzz });   // today's CueSpec, as a phrase
export const schedule = (font, phrase): ReadonlyArray<{ sound: Sound; atMs: number }>  // pure: offsets from declared durations
```

`CueSpec` stays as a type alias for a one-step phrase, so gin's and backgammon's tables, `SHELL_CUES`
and every `fx.test.ts` pin are untouched; `Record<E, CueSpec>` widens to `Record<E, Phrase>`.

### 3.3 Fonts (`web/shared/lib/sound/fonts.ts`)

```ts
export type SoundFont = Readonly<{
  name; label;
  sounds: Readonly<Partial<Record<CueId, Sound>>>;              // keys may be qualified
  voices?: Readonly<Partial<Record<`voice.${string}`, Sound>>>; // announcer lines; absent = silence (default has none)
  durationsMs?: Readonly<Partial<Record<CueId | `voice.${string}`, number>>>; // samples declare; synth is summed from its notes
  credits?: string;                                             // "Voices: … (licence)"
}>;
```

`Sound.sample` gains nothing; the duration lives beside it in `durationsMs` (measured by the tool,
§7) so scheduling stays pure. An undeclared sample duration defaults to 400 ms and the manifest test
flags it.

### 3.4 Playing (`web/shared/edge/sound.ts`, `edge/cuePlayer.ts`)

`playPhrase(audio, font, phrase, deps)`: `schedule()` gives `{sound, atMs}`; each start is
`src.start(c.currentTime + atMs / 1000)` (Web Audio schedules ahead; the sample cache warms every
URL of the phrase first, and a sample not yet decoded when its slot arrives is skipped, never late).
Voices start at their `atMs` in parallel with the steps. The buzz pattern is one `vibrate` call as
today. `CuePlayer.play(event, font)` resolves `cues[event]` to a phrase; nothing else in the games
changes. Tests: `schedule()` over declared durations (order, gaps, a voice at 0 over a two-step
phrase); the edge over the audio fake with a fake clock (starts at the right `when`).

### 3.5 Events (`web/shared/lib/events.ts`, pure)

```ts
export type GameEvent<K extends string, D> = Readonly<{ id: number; kind: K; seat: number | null; at: number; data: D }>;
export type EventCopy<E> = Readonly<{ summary: (e: E, ctx) => string; detail: (e: E, ctx) => ReadonlyArray<readonly [label: string, value: string]> }>;
export type EventSound<E> = (e: E, me: number | null, role: Role) => Phrase | null;   // the game's binding; null = silence
export const newEvents = <E extends { id: number }>(prev: ReadonlyArray<E> | null, next: ReadonlyArray<E>): ReadonlyArray<E>;
```

`id` is the event's index in the game (monotonic), so `newEvents` is a slice and the cue memory can
key on `last event id`. The shell's `rendered` helper (`web/shared/ui/shell.ts`, G2's neighbourhood):
`eventEffects(prev, next, cfg.table.events)` = for each new event, `fx` with `phraseOf(event)` when
not null. Gin and backgammon keep their own `cuesBetween` until they adopt events (optional, later).

**One `phrases` effect per beat** (docs/design/briscola-battle.md §3.1 IMPACT, PR-F). A resolved trick's
phrases are not played at the paint that shows it: `ui/state.ts rendered` holds them on the settle
(`Settle.phrases`) and `stageEffects` emits them on entering `impact`, so the phrase's first note is
the BOOM of the clash and the impact frame and the sound are one event. `cues.key` still advances at
the paint, so a re-sent frame re-holds nothing; a newer trick that supersedes a beat before its
impact drops the superseded beat's phrases (two BOOMs 300 ms apart are noise); after the impact
they have already played. Everything else's phrases (the deal, the result outside a beat) still
play at the paint.

## 4. Briscola's trick-outcome table (`web/games/briscola/src/ui/sound.ts`, `phraseOf(event, me, role)`)

Definitions, all derived once in the engine at trick resolution and stored on the `trick` event (§5):

- **value class** of the trick's points `p`: `pointless` (0), `small` (1–9: fante 2, cavallo 3, re 4,
  and their sums), `big` (10–19: one asso or one tre, with or without figures), `huge` (20+: asso+tre or
  more; 22 is the max with two players' carichi).
- **winning card** `w`: the card `trickWinner` picked; its **class**: `asso`, `tre`, `re`, `cavallo`,
  `fante`, `pip` (7 6 5 4 2); **briscola** = `w.s === trump`.
- **steal**: `w` is a briscola AND a non-briscola card of the led suit in the trick was `big` (an asso
  or tre of the led suit was on the table and would have won without the trump). Sub-flag
  **overtrump**: `w` is a briscola and another briscola was in the trick (mine beat theirs or theirs mine).
- **carico lost** (loser side): I (my side) played an asso or tre into a trick I lost.
- **who hears what**: online, each device evaluates `me` against `winner`'s side; pass-and-play
  (`role === 'local'`) plays the WINNER's phrase (the winner leads next and holds the phone).
  Partners (4 players) hear the side's outcome. `ctx.role` and `view.me.side` are already in `View`.

The table. Columns: the winning card; rows: value class. Each cell: the winner's phrase (W) then the
loser's phrase (L). Steps are qualified cue ids; `+` is "then" (a step boundary); `& voice.x` is a
layer the default font leaves silent; `—` is silence. `hap:` names the haptic pattern from §4.1.

| value ↓ / winner → | pip, not briscola | figure (fante/cavallo/re), not briscola | asso / tre, not briscola | any briscola (pip or figure) | briscola, `steal` |
|---|---|---|---|---|---|
| pointless (0) | W `score.trick.pointless` hap:tick · L — | W `score.trick.pointless` · L — | (impossible: the card itself scores) | W `move.briscola` + `score.trick.pointless` · L — | (impossible) |
| small (1–9) | W `good.trick.small` hap:small · L — | W `good.trick.small.figure` · L — | W `good.trick.small.carico` (an asso/tre won only figures: rare) · L — | W `move.briscola` + `good.trick.small` · L — | W `good.trick.briscola.steal.small` & `voice.trick.steal` · L `bad.trick.stolen.small` |
| big (10–19) | W `good.trick.big` hap:big · L `bad.trick.big` (& `bad.trick.carico` when they lost their own asso/tre) | W `good.trick.big.figure` · L `bad.trick.big` | W `good.trick.big.carico` (asso or tre took it; sub-id `.asso`/`.tre`) · L `bad.trick.big` | W `move.briscola` + `good.trick.big` hap:briscola · L `bad.trick.big` | W `good.trick.briscola.steal.big` & `voice.trick.steal` hap:steal · L `bad.trick.stolen.big` |
| huge (20+) | W `good.trick.huge` hap:huge · L `bad.trick.huge` | W `good.trick.huge.figure` · L `bad.trick.huge` | W `good.trick.huge.carico` · L `bad.trick.huge` | W `move.briscola` + `great.trick.huge` · L `bad.trick.huge` | W `great.trick.briscola.steal.huge` & `voice.trick.steal` hap:steal · L `bad.trick.stolen.huge` |

Extra cells outside the grid: **overtrump** appends `.overtrump` to the winner's leaf
(`good.trick.big.briscola.overtrump`) and the loser hears `bad.trick.overtrumped` (their briscola was
beaten); **trump card taken from the table** at the last draw (`trumpTaken`) plays `pickup.briscola`
for the taker after the trick phrase (a step, not a layer); **the leader's own pip winning a pointless
trick** is the smallest sound in the game (`score.trick.pointless`, the "win sound too, just as all
actions do").

What the DEFAULT font actually voices (the owner: two trick sounds, big and small): `good.trick.big`
and `good.trick.small`; `great` (already) covers `great.trick.*`; `bad` covers every `bad.trick.*`;
`score` covers `score.trick.pointless`; `move` covers `move.briscola`; no `voice.*`. Every other id in
the table resolves down its ladder: `good.trick.briscola.steal.big` -> `good.trick.briscola.steal` ->
`good.trick.briscola` -> `good.trick` -> `good`. The FIRST sample font ("felt" or a new one) adds
`good.trick.briscola` (the briscola sting) so "briscola THEN victory" is audible; a silly font adds
leaves and `voice.trick.steal` ("STOLEN!"), `voice.trick.huge` ("UNSTOPPABLE"), `voice.game.win`.

### 4.1 Haptics (one `buzz` per phrase, played with the first step)

`tick` 10 · `small` [20, 30, 20] · `big` [30, 40, 30, 40, 60] · `briscola` [15, 25, 15, 25, 90] ·
`steal` [10, 20, 10, 20, 10, 20, 140] · `huge` [50, 50, 50, 50, 120] · `sad` [180] · `stolen` [60, 40, 160].
Losing small or pointless: no buzz (silence is the phrase).

### 4.2 The other briscola events (same table file)

`deal` -> `start` (+ `voice.game.deal`), `play` (mine) -> `move`, `play` (theirs, online) -> `move.opp`,
`draw` -> `draw`, `exchange` -> `neutral.exchange`, `yourTurn` -> `turn` (shell), `result` win ->
`victory.game` (+ `voice.game.win`), loss -> `loss.game`, draw -> `neutral.game.draw`, `matchWon` ->
`victory.match` + `great` (+ `voice.match.win`), `matchLost` -> `loss.match`, refused tap -> `bad.refused`,
`guestJoined`/`guestGone`/`shared` -> the shell's `connection`/`disconnect`/`invite`.

### 4.3 Corrected at implementation (`sound.ts`, pinned by `sound.test.ts`'s 75 reachable cells)

Three quiet deviations from the grid above, so a reader of the table and a reader of the file agree:

- The loser's carico is a **leaf, not a layer**: `bad.trick.big.carico`, `bad.trick.huge.carico` and
  `bad.trick.stolen.<big|huge>.carico` (the grid's `& bad.trick.carico`). A font that voices
  `bad.trick.carico` would not be reached by these ids; a font voices `bad.trick.big.carico` or lets it
  fall to `bad.trick.big` and `bad`. The winner's leaves are as the grid says (`.figure.<fante|cavallo|re>`,
  `.carico.<asso|tre>`), and the briscola column's win is `<cell>.briscola` under `move.briscola`.
- Two cells are **unreachable**, not rare: `good.trick.small.carico` (an asso or tre in a small trick
  scores 10 or 11, so the trick is big) and `good.trick.briscola.steal.small` (a steal needs a carico of
  the led suit on the table, so the trick is big or huge); the code plays the value's plain leaf.
- `voice.trick.huge` is **layered on every huge trick** the winner takes, not the steal alone; every
  shipped font leaves it silent, as §4 says of every `voice.*`.

## 5. Briscola's event stream (`web/games/briscola/src/engine/`), BEFORE the wire corpus is pinned

The engine already resolves every trick in `apply` and writes `LogEntry {seat, kind, text, at}` +
`lastTrick`. Replace the text log with structured events; derive the sentence in the UI from the same
`log.ts` functions (they stay, pinned, as `summaryOf`). PR-4 records `test/fixtures/briscola-wire/`
from whatever shape exists, so this must land first (or inside PR-4) or it versions the decoders.

```ts
export type TrickEvent = Readonly<{ kind: 'trick'; no: number; leader: Seat; cards: ReadonlyArray<Played>;
  winner: Seat; winnerSide: Side; points: number; valueClass: 'pointless' | 'small' | 'big' | 'huge';
  winningCard: Card; winningClass: 'asso' | 'tre' | 're' | 'cavallo' | 'fante' | 'pip'; briscola: boolean;
  steal: boolean; overtrump: boolean; carichiLost: ReadonlyArray<Seat>;   // seats whose asso/tre went to the winner
  drew: ReadonlyArray<Seat>; trumpTaken: Seat | null }>;
export type GameEvent = GameEvent<'game' | 'deal' | 'trick' | 'exchange' | 'result', …>;  // data per kind:
//   game {gameNo, dealer}; deal {dealer, trumpCard}; exchange {seat, gave, took};
//   result {winner: Side | null, totals, draw, decided: boolean, wins}
export type State = { …, events: ReadonlyArray<GameEvent> };   // replaces `log`; `lastTrick` stays (the settle beat reads it)
export type View  = { …, events, lastAction: Played | null };  // `log` and the text `lastAction` go; the UI writes both sentences
```

`log.ts` keeps `gameText`, `dealText`, `trickText`, `exchangeText`, `resultText` and gains
`summaryOf(event, players, n)` (dispatch by kind) and `detailOf(event, players, n)` (the expanded
lines: every card played in order with its player, "won by the asso di coppe over the tre di spade",
"briscola stolen from Jeff", "Jeff lost his asso", the points, who drew what, "briscola taken by Ann").
`detailOf` for `result`: the per-side totals, tricks per seat, the match tally. Decoders:
`decodeEvent` as a `taggedUnion('kind', …)`; byte-stable key order pinned by the new corpus.
Replay invariant (9): `events.length` grows by exactly one per resolved trick, deal, exchange, result.

The derivation of the flags is one pure function in `cards.ts` beside `trickWinner`:
`trickFacts(trump, cards): {winningCard, winningClass, briscola, steal, overtrump, valueClass}` with
positions in `apply.test.ts` (steal: led asso di coppe, taken by the 2 di bastoni with bastoni trump;
overtrump: two briscole; carico lost; the pointless trick of four pips; the 22-point trick).

## 6. The shared history panel (`web/shared/ui/history.ts`)

```html
<div id="historyOverlay" class="overlay hidden"> … <div id="historyList" class="history">
  <details class="history-row" data-kind="trick" data-seat="1">
    <summary><span class="who">Jeff</span> took the trick · 14 points · briscola stolen</summary>
    <dl class="history-detail"><dt>Led</dt><dd>Ari · asso di coppe</dd><dt>Then</dt><dd>Jeff · 2 di bastoni (briscola)</dd>
      <dt>Won by</dt><dd>2 di bastoni over the asso di coppe</dd><dt>Points</dt><dd>14</dd><dt>Drew</dt><dd>Jeff, Ari</dd></dl>
  </details>
```

`historyHtml(events, copy: EventCopy, ctx)` renders newest last (the list scrolls to the bottom on
open), keyed through `ensureKeyed(list, lastEventId)` so open `<details>` survive repaints of the same
list; `<details>` is native (keyboard, screen reader, no JS state); a `data-kind` per row lets the theme
colour the trick rows by value class (`data-value="big"`) without any TS toggling classes (CONTRACT.md
rows: `history-row history-detail who`, owner `shell`). The sheet ids (`historyOverlay`,
`closeHistoryBtn`, `historyList`, `historyBtn`, `menuHistoryBtn`) already exist in bg and gin; they join
`SHELL_IDS` when briscola adopts the panel, and bg/gin keep their own `historyHtml` until a later
adoption PR (their rows become `<details>` with a one-line detail; their log text stays the summary).
Painter test over `dom.fake`: rows equal events, summary text from `copy.summary`, detail pairs from
`copy.detail`, the key survives, an unknown kind renders the summary only.

The pipeline order the owner asked for is then by construction: the engine appends the event -> the
view carries it -> `rendered` finds it new -> `fx` plays `phraseOf(event)` -> the same event is the
history row. One source, two outputs; a re-sent frame plays nothing (`cues.key` = last event id).

## 7. Dropping assets in later: `tools/sound-fonts.ts` (the card-pack tool's shape)

The owner will hand over many files. The tool makes a font from a folder with no hand-written rows:

```
node --experimental-strip-types tools/sound-fonts.ts add <name> --dir <folder> --label "…" --credits "…" [--gain 0.8] [--voices <folder>]
node --experimental-strip-types tools/sound-fonts.ts check        # every font's files exist, sizes, durations within 10% of declared
node --experimental-strip-types tools/sound-fonts.ts preview <name> [--phrase good.trick.briscola.steal.big]   # writes a WAV render? no: opens the page fake and lists the schedule
```

- A file is named by its cue id: `good.trick.big.mp3`, `good.trick.briscola.mp3`, `victory.game.mp3`,
  `voice.trick.steal.mp3`. The tool validates each stem with `decodeCueId` / the `voice.` prefix,
  rejects unknown bases (typos never ship silently), copies the files to
  `web/public/shared/sound/<name>/` (the design's convention; relative URLs `../../shared/sound/<name>/…`),
  measures each duration in Playwright's Chromium (`decodeAudioData`, the same page trick
  `tools/card-packs.ts` uses for pixels) into `durationsMs`, transcodes nothing (the owner supplies
  MP3/OGG/M4A as is; the tool warns above 30 KB and errors above 200 KB), and writes
  `web/shared/lib/sound/fonts/<name>.ts` (`sounds`, `voices`, `durationsMs`, `credits`).
- The two human lines (`SOUND_FONTS`, the `FONTS` row) are printed, as for packs; `check` (also
  `test/sound-fonts.test.ts`) fails until they are added and reads every URL back from the tree.
- Metadata beside the files: `<folder>/FONT.txt` (label, author, licence, source) is copied to
  `SOURCES.txt` next to the served files, as the packs do.
- "Announcer" packs (Halo-style, Soundbooth-style) are ordinary fonts whose `voices` folder is full and
  whose `sounds` may be partial: the ladder fills the stings from `default` or from a `--base <font>`
  the tool records (`base?: SoundFontName` in `SoundFont`: one more fallback rung before `default`, so
  "silly voices over the felt stings" is one flag).
- Nothing plays until the player's font is set (console hook now, the menu later): assets are inert data.

## 8. PRs, tests, risks

| PR | Content | Files | Protected by / tests | Order |
|---|---|---|---|---|
| **S1 shared cues+phrases** | qualified `CueId`, `ladder`, `resolveSound` walking the ladder then `default`; `Phrase`/`Step`/`Voice`, `spec()` = today's `CueSpec`; `SoundFont.voices/durationsMs/credits/base`; `schedule()` pure; `playPhrase` scheduling in `edge/sound.ts`; `CuePlayer` resolves phrases | `web/shared/lib/sound/{cues,phrase,fonts,sound}.ts` + tests, `web/shared/edge/{sound,cuePlayer}.ts` + tests, docs/design/sound-fonts.md §2–§4 | behaviour-preserving: gin's and bg's `fx.test.ts` and `sound.ts` tables untouched (a `CueSpec` is a phrase); fonts.test pins `default` total on base cues; new: ladder cases, schedule offsets, a two-step phrase over the audio fake, a voice layer at 0 ms | now, in parallel with C3/E/F (touches no in-flight file) |
| **S2 briscola events** | `GameEvent` stream replaces `log` in State/View; `trickFacts`; `summaryOf`/`detailOf` in `log.ts`; decoders; replay invariant | `web/games/briscola/src/engine/{types,cards,apply,view,decode,log}.ts` + tests | 63 positions + the new steal/overtrump/carico/pointless/22-point positions; decode byte pins re-recorded (no corpus exists yet) | BEFORE PR-4 records the wire corpus, or folded into PR-4's first stage |
| **S3 shared history panel** | `web/shared/ui/history.ts` `<details>` rows, keyed; CONTRACT.md `shell` rows; `SHELL_IDS` gains the history ids | `web/shared/ui/history.ts` + test, `web/shared/ui/ids.ts`, `web/shared/styles/{shell,base}.css` (after F1) or a theme rule per game, CONTRACT.md | painter test over dom.fake; class-contract; bg/gin unchanged (they adopt later) | after F1 lands (so the row styles live in shell.css) |
| **S4 briscola bindings** (in PR-4 or right after) | `ui/sound.ts` `phraseOf(event, me, role)` over §4 + §4.2; `ui/history.ts` = `summaryOf/detailOf` wired to the shared panel; `rendered` uses `eventEffects` | `web/games/briscola/src/ui/{sound,history,state}.ts` + tests | the CELL TEST: a generated table over value class × winning class × briscola × steal × overtrump × winner/loser × role asserting the exact phrase and buzz for every cell (~120 rows, one `describe.each`); pass-and-play plays the winner's; e2e briscola-local asserts the history row after a trick and the expanded detail | with PR-4 |
| **S5 tool** | `tools/sound-fonts.ts add/check/preview`, `test/sound-fonts.test.ts`, docs §8 rewritten as "drop a folder" | tools, test, docs | the tool's own test over a fixture folder of three tiny OGGs (generated by the test with an OfflineAudioContext? no: committed 1 KB fixtures) | when the first asset folder arrives (Ari) |
| later | bg/gin history rows -> `<details>`; bg/gin events (optional); the settings panel (sound-fonts.md §7) with a phrase preview | | | Wave H or with the menu |

Risks: (1) **wire timing**: S2 after the corpus is pinned means a decoder version: land S2 first (the
main agent orders PR-4 accordingly). (2) **Scheduling drift**: samples decode late on first play;
mitigated by warming every URL of a phrase on `warm()` and skipping a step that is not ready, never
delaying the next. (3) **Overlap**: two events in one step (trick + result) queue as one phrase
sequence (`eventEffects` concatenates phrases with a 120 ms gap) so the win sting never plays under
the trick sting. (4) **Pass-and-play perspective**: the winner's phrase is right for the phone holder;
the curtain then chimes `turn` as today; the loser never hears "their" loss on the shared phone (a
design choice, recorded). (5) **Vocabulary creep**: qualified segments are the game's words and never
become shared constants; the shared code only walks the ladder. (6) **Asset size**: a full silly
font (40 stings + 20 voices ≈ 60 files × 30 KB ≈ 1.8 MB) is fetched lazily per URL on first play, not
at boot; the manifest test caps a font at 2.5 MB.

## 9. The owner's words (2026-09-25, verbatim)

"sound design and history: when you win a hand via using the briscola card, that's a unique sound.
When you win a hand with a 3, that's a unique sound. Same with Ace. The jack, favo, and king all have
their own sounds (but in the default sound pack, there are only 2 sounds. One for the big cards 11/10,
one for the small cards 2/3/4). Losing a big hand makes a sad sound. Losing a small hand or a pointless
hand gives no sound. Winning a pointless hand gets a win sound too. Just as all actions do. In a
perfect sound font we will have assets for all of these. But for now just lay the ground work to make
it feel nice and haptic when playing. If a briscola on a big card happens, play the briscola THEN the
victory sound. If you use briscola to steal a big card, then that's a unique sound. Come up with a
table of all possible victories and in each cell state the victory and loss sound pointer. A simple
soundpack can use only a few sounds to be applied to ALL the cells. A crazy silly funny soundpack may
have unique sounds for each. I'm imagining the voice effects used by e.g. the halo announcer or e.g.
soundbooth theater; these can be metadata on top of the raw sounds to add additional depth. once
again, user configuration of card packs and sound fonts can come in a later menu. I will need to give
you many assets to eventually accomplish this. Your job now is to just plan it. And then the main
agent will just make the code ready to accept it so dropping in assets later is a trivial and
effective measure. This sound font management is general, the briscola bindings are specific to
briscola (just as every game specific bindings are specific to the games). The sounds and the history
panel should be tightly integrated. Game events happen, and they are shared to the user as sound and
then recorded as history events. History lines should be short and sweet but you can click to expand
if you ever want more details on them. This may require reworking fundamental systems, but is very
worth while"
