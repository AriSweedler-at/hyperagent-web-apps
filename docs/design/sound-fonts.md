# Sound fonts: one vocabulary of cues, many fonts, a choice per game

Owner's asks (2026-09-23): "before adding sounds to movements, architect out a soundpack mechanism.
I want to be able to easily switch out sound fonts. Similar to the card back setting - no need to
build a UI for this for now. But imagine eventually a settings panel that allows you to select";
then: "we don't want to have the games conflict with each other. But they should be able to use each
other's soundfonts. The sounds should - for the most part - be generic names. Like 'move' or 'bad'
or 'good' or 'victory' or 'loss' or 'connection' or 'invite'."

## 1. Terms

| Term | Meaning |
| --- | --- |
| **Cue** | A generic event a game raises when something worth hearing happens: `move`, `bad`, `victory`. The vocabulary is shared by every game and never names a game's own concepts (no `knock`, no `bearOff`). |
| **Sound font** | A named set of sounds, one per cue, shared by every game. Today a font is synthesised (notes for an oscillator); a font may later carry recorded samples. |
| **Preference** | Which font a game plays. Stored per game so two games on one origin never fight over it; every game may pick any font. |
| **Haptics** | The vibration pattern beside a cue. Part of a game's own table, not of a font: a font is sound. |

## 2. The cue vocabulary (`web/shared/lib/sound/cues.ts`)

Generic by design: a font author composes for these meanings once, and every game maps its own
events onto them (section 5). Adding a cue is a shared change (every game may then use it; the
`default` font must gain a sound for it).

| Cue | Meaning | Gin today | Backgammon | Fidice (later) |
| --- | --- | --- | --- | --- |
| `tap` | A touch acknowledged: a card or checker selected, a menu opened, a toggle flipped | `tap` | select a checker or point | — |
| `move` | A piece or card placed on the table | — | a checker lands | — |
| `pickup` | Something taken up from the table (face up) | opponent draws from the discard pile | a checker lifted (optional) | — |
| `draw` | Something taken from a face-down source: the stock, a shuffled deck | opponent draws from the stock | — | — |
| `roll` | Dice thrown | — | the roll | the roll |
| `capture` | A piece taken or sent back | — | a hit (the blot goes to the bar) | — |
| `score` | Points banked or a piece borne off | — | a checker borne off | a hand scored |
| `undo` | A move taken back | undo after a discard-pile draw (optional) | undo within the turn | — |
| `start` | A game or a round begins: the deal, the opening roll | a deal (optional) | the opening roll decided | a round begins |
| `turn` | It is this player's turn now | `yourTurn` | your turn (online; the curtain in pass-and-play) | your turn |
| `good` | A favourable notice | `knockGood` | the cube taken, a gammon avoided | a good hand |
| `great` | A triumphant notice, bigger than `good` | `gin` | a gammon or backgammon scored | — |
| `bad` | An unfavourable notice: a refused action, a bad outcome | `bad` | you were hit, a roll that cannot move | a bust |
| `neutral` | A plain notice with no valence | `neutral` | the cube passed, a pass | — |
| `challenge` | A stake raised: the doubling cube offered | — | `double` offered | — |
| `victory` | The game or match won | `win` | game or match won | — |
| `loss` | The game or match lost | `lose` | game or match lost | — |
| `connection` | A peer connected or reconnected | — (candidate: the guest joined) | the guest joined | — |
| `disconnect` | The connection was lost | — (candidate: `guestGone`) | the opponent left | — |
| `invite` | The invite was shared or a code accepted | — (candidate: share sheet done) | share done | — |

Twenty cues. "For the most part generic": `roll` and `challenge` name mechanics rather than
feelings, but dice and a raised stake are shared by more than one game, so they stay.

## 3. Sounds (`web/shared/lib/sound/sound.ts`)

```ts
export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';
/** One note: frequency in Hz, duration in seconds, and the gap to the next note (defaults to `dur`). */
export type Note = Readonly<{ freq: number; dur: number; gap?: number }>;
export type Sound =
  | Readonly<{ kind: 'synth'; notes: ReadonlyArray<Note>; voice: OscillatorType; gain: number }>
  | Readonly<{ kind: 'sample'; url: string; gain: number }>
  | Readonly<{ kind: 'silence' }>;
```

- `synth` is what every shipped font uses: the shared audio edge plays the notes back to back
  through one oscillator voice with a short attack and an exponential release, exactly as gin's
  legacy `fx.seq` did. Gains stay in `(0, 0.3]`.
- `sample` is the seam for real recorded fonts: a URL relative to the page
  (`../../shared/sound/<font>/<cue>.mp3`, the assets under `web/public/shared/sound/<font>/` beside
  the shared favicon, so both origins serve them), fetched and decoded once on first use, cached
  per URL, and silent when the fetch or the decode fails. No sample font ships yet. Corrected at
  implementation (2026-09-23): a failure is cached like a success, so a bad or missing file is
  asked for once per page, not once per cue.
- `silence` lets a font mute a cue on purpose (a minimal font that only marks turns and results).
- Added at implementation: the module also exports the constructors `note(freq, dur, gap?)` (no
  `gap` key when none is given, so a font's literal reads as the legacy tables did),
  `synth(voice, gain, notes)`, `sample(url, gain)`, the `SILENCE` constant and `MAX_GAIN` (0.3),
  which the font validity test reads.

## 4. Fonts (`web/shared/lib/sound/fonts.ts` + `fonts/<name>.ts`)

```ts
export const SOUND_FONTS = ['default', 'felt', 'arcade'] as const;
export type SoundFontName = (typeof SOUND_FONTS)[number];
export type SoundFont = Readonly<{
  name: SoundFontName;
  /** What a settings panel shows. */
  label: string;
  /** Partial: a cue a font does not compose falls back to the `default` font's sound. */
  sounds: Readonly<Partial<Record<SoundCue, Sound>>>;
}>;
export const DEFAULT_SOUND_FONT: SoundFontName = 'default';
export const isSoundFont = (value: string): value is SoundFontName;
/** `<key>: "x" is not a sound font; kept the current one. One of: default, felt, arcade.` */
export const badSoundFontMsg = (key: string, value: string): string;
export const fontByName = (name: SoundFontName): SoundFont;
/** The font's sound for the cue, else the default font's: the default is total, so never undefined. */
export const resolveSound = (font: SoundFont, cue: SoundCue): Sound;
```

| Font | Character | Notes |
| --- | --- | --- |
| `default` | Gin's legacy tones, number for number, under their generic names (`turn` = the old `yourTurn`, `good` = `knockGood`, `great` = `gin`, `draw` = `oppStock`, `pickup` = `oppDiscard`, …), plus composed sounds for the cues gin never had (`move`, `roll`, `capture`, `score`, `undo`, `start`, `challenge`, `connection`, `disconnect`, `invite`). **Total**: every cue has a sound; a test pins it. | The one font every other falls back to. |
| `felt` | Soft: sine and triangle voices, lower gains, shorter tails; a quiet table. | Suits the Sheshbesh restraint. |
| `arcade` | Bright: square waves, crisp attacks, the 8-bit register. | |

Fonts are pure data in `web/shared/lib/sound/fonts/<name>.ts`. The default's `sounds` is typed
`Readonly<Record<SoundCue, Sound>>` and exported as `DEFAULT_SOUNDS` (added at implementation), so
a missing cue is a compile error before it is a test failure; the font files import only
`cues.ts`, `sound.ts` and the `SoundFont` type, so `fonts.ts` importing them is no cycle. Tests: `default` total over
`SOUND_CUES`; every sound valid (gains in `(0, 0.3]`, durations and gaps `> 0`, sample URLs relative,
no absolute or root-relative URL); names unique and equal to the file's `name`; `resolveSound`
falls back to `default`; `isSoundFont`/`badSoundFontMsg`.

## 5. A game adopts the mechanism: one table

A game keeps its own event names (its reducer already emits them) and writes ONE table that maps
each to a cue and a buzz pattern. Nothing else in the game names a sound.

```ts
// web/games/gin-rummy/src/ui/sound.ts (the table; the numbers moved into the default font)
export type CueSpec = Readonly<{ cue: SoundCue; buzz: number | ReadonlyArray<number> }>;
export const CUES: Readonly<Record<Cue | 'tap', CueSpec>> = {
  tap: { cue: 'tap', buzz: 12 },
  yourTurn: { cue: 'turn', buzz: [40, 60, 40] },
  knockGood: { cue: 'good', buzz: [30, 40, 30, 40, 60] },
  gin: { cue: 'great', buzz: [50, 50, 50, 50, 120] },
  bad: { cue: 'bad', buzz: [120] },
  neutral: { cue: 'neutral', buzz: 30 },
  win: { cue: 'victory', buzz: [80, 50, 80, 50, 200] },
  lose: { cue: 'loss', buzz: [200] },
  oppStock: { cue: 'draw', buzz: 15 },
  oppDiscard: { cue: 'pickup', buzz: 15 },
};
```

Backgammon's table (its `src/ui/sound.ts`, written with the page): `select → tap`, `move → move`,
`roll → roll`, `hit → capture` (the hitter) and `wasHit → bad` (the player hit: two events, one
per seat, since a table holds one cue per event; the reducer decides which seat hears what),
`bearOff → score`, `undo → undo`, `opening → start`, `yourTurn → turn`,
`double → challenge`, `take → good`, `pass → neutral`, `gammon → great`, `win → victory`,
`lose → loss`, `guestJoined → connection`, `guestGone → disconnect`, `shared → invite`. As shipped
(backgammon-board.md §5.1) the table is smaller (`roll place hit bearOff yourTurn win lose double
tap`) plus `doubles → good`, the small excited notice as the dice settle on a double (§4.7 there),
which both seats hear as both hear the roll.

Fidice, when it gains sound: `roll`, `turn`, `good`, `bad`, `score`, `victory`, `loss`.

Playing: the game's `fx.ts` resolves `CUES[event]`, plays `resolveSound(fontByName(current), cue)`
through the shared edge player, and buzzes the table's pattern; nothing plays while the game's own
sound toggle (`ginRummy_sound`, `backgammon_sound`) is off. The current font is the App's
(section 6), passed to the effect runner with the cue. Corrected at implementation: gin's `Fx` is
`play(event, font)`, `toggle(font)`, `enabled()` and `warm()`; the legacy object's eight per-event
methods (`fx.gin()`, `fx.win()`, …) are gone, since a font parameter made them awkward and only
their test called them. `toggle` taps in the font it is given when turning on.

## 6. Choosing a font: per game, no conflicts

| Game | Key (bare string, one of `SOUND_FONTS`) | Default |
| --- | --- | --- |
| gin-rummy | `ginRummy_soundFont` | `default` |
| backgammon | `backgammon_soundFont` | `default` |
| fidice (later) | `fidice_soundFont` | `default` |

Each game's `storage.ts` names its key (docs/ARCHITECTURE.md "Module boundaries": only that module
names a game's keys) with `decodeSoundFont = literal(...SOUND_FONTS)`, `readSoundFont`,
`writeSoundFont`. Two games on one origin therefore keep separate choices, and both choose from the
same fonts.

Exactly the card back's flow (docs/design/gin-card-backs.md §3):

- **App state.** `App.soundFont`, read at `home/init` from `HomeSnapshot.soundFont` (the default when
  unreadable); intent `soundFont/set {font}` → effect `writeSoundFont`. The `fx` effect runner passes
  `app.soundFont` with the cue, so the reducer stays the source of truth and a settings panel later
  only dispatches the intent.
- **Boot.** The one home read (`homeSnapshot()` in main.ts) logs a stored value that names no font
  with `badSoundFontMsg(key, value)` and removes it, so the default stands and a reload is quiet.
- **For now, the console.** `localStorage.setItem('ginRummy_soundFont', 'felt')` then a reload, or
  `__gin.soundFont('felt')`, which applies at once and remembers it; `__gin.soundFontName()` reads
  it back. A bad name (`__gin.soundFont('plaid')`) logs
  `ginRummy_soundFont: "plaid" is not a sound font; kept the current one. One of: default, felt, arcade.`
  and changes nothing. Backgammon: `__backgammon.soundFont(...)` over `backgammon_soundFont`.
- **The sound toggle** (`ginRummy_sound` on/off, the 🔊 button) is independent: off silences every
  font; the chosen font is kept for when it comes back on.

## 7. The settings panel (later)

A "Sound" section: the on/off toggle, the font as a list of `SOUND_FONTS` shown by
`fontByName(name).label`, each row with a preview that plays `tap` then `good` from that font, and
a master volume later. Selecting dispatches `soundFont/set`. The card back sits beside it as the
same kind of choice. Nothing in sections 2 to 6 changes for the panel: it is a painter over state
that already exists.

## 8. Adding a font

1. `web/shared/lib/sound/fonts/<name>.ts`: a `SoundFont` (partial is fine; the default fills the rest).
2. Add the name to `SOUND_FONTS`; the tests check validity; `badSoundFontMsg` lists it at once.
3. For a sample font: the assets under `web/public/shared/sound/<name>/`, URLs relative
   (`../../shared/sound/<name>/<cue>.mp3`), each under ~30 KB; the dist guards already forbid
   root-relative URLs.
4. No game changes: every game sees the font through its own preference.

## 9. Module map and boundaries

| Module | Zone | Holds |
| --- | --- | --- |
| `web/shared/lib/sound/cues.ts` | pure | `SOUND_CUES`, `SoundCue`, one comment per cue (section 2) |
| `web/shared/lib/sound/sound.ts` | pure | `Sound`, `Note`, `OscillatorType` (moved here from `web/shared/edge/fx.ts`, which imports them) |
| `web/shared/lib/sound/fonts.ts` | pure | `SOUND_FONTS`, `SoundFontName`, `DEFAULT_SOUND_FONT`, `isSoundFont`, `badSoundFontMsg`, `fontByName`, `resolveSound` |
| `web/shared/lib/sound/fonts/{default,felt,arcade}.ts` | pure | the fonts as data |
| `web/shared/edge/sound.ts` | edge | `playSound(audio, sound, deps)`: synth through `AudioCues.seq`; sample through `deps.fetchBuffer` and the context's `decodeAudioData`/`createBufferSource`, both optional on `AudioContextLike` so the oscillator fakes need no change; `silence` does nothing; every failure silent. Corrected at implementation: `deps` is `{ fetchBuffer, cache }`, the cache from `createSampleCache()` made once by main.ts, and the context comes from `AudioCues.context()`, an accessor added to `web/shared/edge/fx.ts` (its `ensure()`), so the `AudioCues` fakes gain one line |
| `web/games/<game>/src/ui/sound.ts` | game ui | the event → `{cue, buzz}` table (section 5) |
| `web/games/<game>/src/fx.ts` | game | plays a table entry through the edge with the App's font; the sound toggle |
| `web/games/<game>/src/storage.ts` | game | the key, decoder, reader, writer |
| `web/games/<game>/src/ui/state.ts` | game reducer | `App.soundFont`, `soundFont/set`, `writeSoundFont`, the `fx` effect carries the font |
| `web/games/<game>/main.ts` | boot | the boot drop, `__<game>.soundFont(name)` and `soundFontName()` |

Lint: `ui/` may import `web/shared/lib` (pure) and `web/shared/edge/dom.ts` only, so the table
imports `SoundCue` from lib; the player is reached from `fx.ts` (no zone restricts it) and
`main.ts` (an edge). `tsconfig.node.json` lists `web/shared/edge/sound.ts` beside `fx.ts`, since
the node project compiles gin's `src/` (corrected at implementation). `web/shared/lib/**` stays
at 100% coverage; `web/shared/edge/**` at its ratchet.

## 10. Tests

- **lib**: the default font is total; every font valid; `resolveSound` fallback; names and labels;
  `isSoundFont`; the message text.
- **legacy pin**: for every gin event, `resolveSound(default, CUES[event].cue)` equals the legacy
  table's notes, voice and gain number for number, and the buzz is unchanged
  (`web/games/gin-rummy/src/fx.test.ts`, against the frozen legacy numbers).
- **edge**: `playSound` for each kind over fakes; a failing fetch and a failing decode are silent;
  the sample cache fetches once per URL.
- **game**: storage round trip and the refusal of unknown names (the legacy-capture parity suite,
  test/parity/gin.storage.test.ts, lists the key as this page's own); `soundFont/set` writes and
  the `fx` effect carries the font; `homeSnapshot()` drops a bad value (main.ts is boot, so the
  e2e spec is its oracle); the e2e page-only spec
  (`e2e/gin-sound-font.spec.ts`, modelled on `gin-card-back.spec.ts`): a stored `arcade` shows after a
  reload through `__gin.soundFontName()`, `__gin.soundFont('felt')` applies and stores,
  `__gin.soundFont('plaid')` logs and refuses, a stored `tartan` is logged at boot and dropped.

## 11. Later

A master volume per game (a gain the player multiplies in); per-game default fonts (a game may name
one other than `default` in its table); the first sample font and its licensing; fidice's table;
"call the dice" voices for Sheshbesh as a font of its own.
