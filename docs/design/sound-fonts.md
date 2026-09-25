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

### 2.1 Qualified cues (2026-09-25, briscola-sound-history.md §3.1)

A game may say more than the base without adding a word here: a **qualified cue** is a base cue
followed by dotted segments of the GAME's own vocabulary.

```ts
export type CueId = SoundCue | `${SoundCue}.${string}`; // 'good', 'good.trick', 'good.trick.briscola.steal'
export type VoiceId = 'voice' | `voice.${string}`; // announcer lines, a namespace of their own
export type Buzz = number | ReadonlyArray<number>;
export type CueSpec = Readonly<{ cue: CueId; buzz: Buzz }>; // a table row; `cue` may be qualified
export const baseOf = (id: CueId): SoundCue; // 'good.trick.steal' -> 'good'
export const ladder = (id): ReadonlyArray<typeof id>; // ['good.trick.steal', 'good.trick', 'good']
export const isCueId = (value: string): value is CueId; // [a-z]+(\.[a-z0-9-]+)* with a known base
export const decodeCueId: Decoder<CueId>;
```

The segments after the base are the game's words (briscola says `trick`, `briscola`, `steal`;
gin may say `knock`): the shared code never interprets them, it only walks the **ladder**, most
specific first, down to the base. A font voices any prefix it likes (section 4): a simple font
voices the twenty base cues and covers every qualified cue a game ever spells; a rich one voices
the leaves. `decodeCueId` is the spelling the asset tool (section 8) reads back from a file name:
lower case, digits and hyphens, dots between segments.

### 2.2 Phrases (`web/shared/lib/sound/phrase.ts`)

What one event plays when one sting is not enough ("the briscola THEN the victory"):

```ts
export type Step = Readonly<{ cue: CueId; gapMs?: number }>; // after the previous step ends (+ gap)
export type Voice = Readonly<{ cue: VoiceId; atMs: number; gain?: number }>; // a layer over the steps
export type Sequence = Readonly<{ steps: ReadonlyArray<Step>; voices?: ReadonlyArray<Voice>; buzz: Buzz }>;
export type Phrase = Sequence | CueSpec; // a row IS the one-step phrase
export const spec = (cue: CueId, buzz: Buzz): Sequence; // today's row as a phrase
export const sequenceOf = (phrase: Phrase): Sequence;
export const schedule = (font: SoundFont, phrase: Phrase): ReadonlyArray<{ sound; atMs; ms }>;
export const phraseMs = (font, phrase): number; // where the last step or voice ends
export const place = (font, phrases, gapMs): ReadonlyArray<{ atMs; slots; buzz }>; // back to back
export const joinBuzz = (parts: ReadonlyArray<{ buzz; atMs }>): ReadonlyArray<number>; // one vibrate
export const PHRASE_GAP_MS = 120; // between two events' phrases in one paint
```

- `steps` play back to back; each starts where the one before ends, plus its `gapMs`. `voices`
  start `atMs` after the phrase does, in parallel, in the `voice.*` namespace the default font
  leaves silent; `gain` overrides the font's. One `buzz` per phrase, as a row has always had.
- `CueSpec` is a member of `Phrase`, so gin's and backgammon's `Record<E, CueSpec>` tables ARE
  `Record<E, Phrase>` tables with no edit, `SHELL_CUES` is unchanged, and every fx.test.ts pin
  stands: a row schedules as one sound at 0 with its buzz, exactly as before.
- `schedule` is pure and reads only DECLARED lengths (section 4 `durationsMs`; a synth's summed
  from its notes by `soundMs`, section 3), so the edge books every step ahead in one tick and
  never waits on a decode to know when the next begins. A silent step keeps its place (0 ms, its
  gap) and is not played.
- `place` runs several phrases `PHRASE_GAP_MS` apart (an event stream's new events in one paint,
  briscola-sound-history.md §8 risk 3), and `joinBuzz` makes ONE vibrate pattern for the run, each
  buzz at its phrase's start, the pauses measured from the schedule (a 0 ms "on" is slipped in
  where the pattern so far ends on an "off", so the pause stays an off).

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
- `soundMs(sound)` (2026-09-25): a synth's length in whole ms, where its last note ends (each note
  starts `gap ?? dur` after the one before, as `AudioCues.seq` plays them); silence is 0; a sample
  is `null`, its length not being in its URL: the font declares it (section 4).

## 4. Fonts (`web/shared/lib/sound/fonts.ts` + `fonts/<name>.ts`)

```ts
export const SOUND_FONTS = ['default', 'felt', 'arcade'] as const;
export type SoundFontName = (typeof SOUND_FONTS)[number];
export type SoundFont = Readonly<{
  name: SoundFontName;
  /** What a settings panel shows. */
  label: string;
  /** Partial, keys may be qualified: a cue a font does not compose walks the ladder, then `base`, then `default`. */
  sounds: Readonly<Partial<Record<CueId, Sound>>>;
  /** Announcer lines (`voice.*`, the same ladder); absent means silence. The default has none. */
  voices?: Readonly<Partial<Record<VoiceId, Sound>>>;
  /** A sample's length, measured by the asset tool; a synth's is summed; an undeclared sample is 400 ms. */
  durationsMs?: Readonly<Partial<Record<CueId | VoiceId, number>>>;
  /** "Voices: … (licence)", printed under a recorded font. */
  credits?: string;
  /** One more rung before `default`: the font this one re-voices a few cues of. */
  base?: SoundFontName;
}>;
export const DEFAULT_SOUND_FONT: SoundFontName = 'default';
export const SAMPLE_MS_FALLBACK = 400;
export const isSoundFont = (value: string): value is SoundFontName;
/** `<key>: "x" is not a sound font; kept the current one. One of: default, felt, arcade.` */
export const badSoundFontMsg = (key: string, value: string): string;
export const fontByName = (name: SoundFontName): SoundFont;
export type Resolved = Readonly<{ sound: Sound; ms: number }>;
/** The first hit along the id's ladder in the font, then its base, then default; the default's base cue always answers. */
export const resolveCue = (font: SoundFont, id: CueId): Resolved;
export const resolveSound = (font: SoundFont, id: CueId): Sound; // resolveCue(...).sound
/** The same walk over `voices`; `{ SILENCE, 0 }` when no rung voices it. */
export const resolveVoice = (font: SoundFont, id: VoiceId): Resolved;
```

**The ladder** (2026-09-25, briscola-sound-history.md §3.3). `resolveCue(font, 'good.trick.steal')`
tries `good.trick.steal`, `good.trick`, `good` in the font's `sounds`; then the same three in
`fontByName(font.base)` if the font names a base (one rung, not a chain); then in `default`, whose
rung is a direct read of `DEFAULT_SOUNDS[baseOf(id)]` since it voices base cues only. A font that
voices only base cues therefore behaves exactly as before, and every qualified cue a game spells
is total by the same pin. The length comes from the rung that supplied the sound: `durationsMs`
beside that key, else `soundMs(sound)` for a synth, else `SAMPLE_MS_FALLBACK`. Voices walk the
same rungs over `voices`; none means silence, which is what the default font says for every line.

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
import { SHELL_CUES, type CueSpec } from '../../../../shared/lib/sound/cues.ts';
export const CUES: Readonly<Record<Cue | 'tap', CueSpec>> = {
  ...SHELL_CUES, // tap, yourTurn, win, lose: the shell's four rows, the same in every game
  knockGood: { cue: 'good', buzz: [30, 40, 30, 40, 60] },
  gin: { cue: 'great', buzz: [50, 50, 50, 50, 120] },
  bad: { cue: 'bad', buzz: [120] },
  neutral: { cue: 'neutral', buzz: 30 },
  oppStock: { cue: 'draw', buzz: 15 },
  oppDiscard: { cue: 'pickup', buzz: 15 },
};
```

The shell's four rows. `CueSpec` (one row: the cue and the buzz) and `SHELL_CUES` (`tap → tap`
12, `yourTurn → turn` [40, 60, 40], `win → victory` [80, 50, 80, 50, 200], `lose → loss` [200])
live in `web/shared/lib/sound/cues.ts` since DRY round 2 (dry-round-2.md E9): the rows the shell
asks of every table (shared-shell.md §5 `cues`) were the two games' byte for byte, so each table
spreads them and writes only the game's own events, the shell sounds the same in every game, and
a fourth game's table is its own rows alone. The games' `ui/sound.ts` and
`web/shared/edge/cuePlayer.ts` re-export `CueSpec`, so their import paths hold.

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
- **Boot.** The one home read (`homeSnapshot()` in `bootShell`, web/shared/edge/boot.ts, since C3;
  each main.ts passes its key as `cfg.sound.fontKey`) logs a stored value that names no font with
  `badSoundFontMsg(key, value)` and removes it, so the default stands and a reload is quiet.
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

**Files named by cue id** (the convention the coming tool reads, briscola-sound-history.md §7, PR
S5; not built yet). A recorded font is a folder of files whose stems are cue ids in the
`decodeCueId` spelling: `good.trick.briscola.steal.mp3` becomes the row `'good.trick.briscola.steal'`
of `sounds`, `voice.trick.steal.mp3` a row of `voices`, `victory.mp3` the base row. The tool
(`tools/sound-fonts.ts add <name> --dir <folder>`) will write `fonts/<name>.ts` from the folder,
measure each file into `durationsMs`, refuse a stem that is no cue id or a file over the size cap,
and a manifest test will read every URL back. Until then a sample font is written by hand to the
same shape, and an undeclared duration is the 400 ms fallback.

## 9. Module map and boundaries

| Module | Zone | Holds |
| --- | --- | --- |
| `web/shared/lib/sound/cues.ts` | pure | `SOUND_CUES`, `SoundCue`, one comment per cue (section 2); `CueSpec` and `SHELL_CUES`, the shell's four rows every table spreads (section 5); the qualified ids `CueId`, `VoiceId`, `Buzz`, `baseOf`, `ladder`, `isSoundCue`, `isCueId`, `decodeCueId` (section 2.1) |
| `web/shared/lib/sound/sound.ts` | pure | `Sound`, `Note`, `OscillatorType` (moved here from `web/shared/edge/fx.ts`, which imports them); `soundMs` |
| `web/shared/lib/sound/phrase.ts` | pure | `Step`, `Voice`, `Sequence`, `Phrase`, `spec`, `sequenceOf`, `Slot`, `schedule`, `phraseMs`, `Placed`, `place`, `joinBuzz`, `PHRASE_GAP_MS` (section 2.2) |
| `web/shared/lib/sound/fonts.ts` | pure | `SOUND_FONTS`, `SoundFontName`, `DEFAULT_SOUND_FONT`, `SAMPLE_MS_FALLBACK`, `isSoundFont`, `badSoundFontMsg`, `fontByName`, `Resolved`, `resolveCue`, `resolveSound`, `resolveVoice` (the ladder, section 4) |
| `web/shared/lib/events.ts` | pure | `GameEvent<K, D>`, `EventCopy<E, C>`, `EventSound<E, R>`, `lastEventId`, `newEvents` (briscola-sound-history.md §3.5): the event stream sound and history read alike |
| `web/shared/ui/eventEffects.ts` | ui (pure) | `eventEffects(prev, next, phraseOf)`: the new events' phrases as one `phrases` shell effect; the shell's `ShellEffect` gains `{ type: 'phrases', phrases }`, run through the same `fx` dep as a cue (`web/shared/ui/shellEffects.ts`), which `bootShell` routes to the cue player's `play` or `playPhrases` |
| `web/shared/lib/sound/fonts/{default,felt,arcade}.ts` | pure | the fonts as data |
| `web/shared/edge/sound.ts` | edge | `playSound(audio, sound, deps)`: synth through `AudioCues.seq`; sample through `deps.fetchBuffer` and the context's `decodeAudioData`/`createBufferSource`, both optional on `AudioContextLike` so the oscillator fakes need no change; `silence` does nothing; every failure silent. Corrected at implementation: `deps` is `{ fetchBuffer, cache }`, the cache from `createSampleCache()` made once by main.ts, and the context comes from `AudioCues.context()`, an accessor added to `web/shared/edge/fx.ts` (its `ensure()`), so the `AudioCues` fakes gain one line. Since the phrases: `playSlot` books one `Slot` at `currentTime + atMs` (`AudioCues.seq` took a `start` for it), `playSlots` warms every sample of a schedule then books each slot in one tick, `playPhrase(audio, font, phrase, deps)`, `warmSamples`; a sample decoded more than `SAMPLE_LATE_MS` (30, a few render quanta: room for the decode promise's microtask, well under the 120 ms phrase gap) past its slot is skipped, never late (briscola-sound-history.md §8 risk 2) |
| `web/shared/edge/cuePlayer.ts` | edge | `createCuePlayer(deps)` over a `Record<E \| 'tap', Phrase>` table: `play(event, font)` (a row plays as it always did: one sound at 0, its buzz), `playPhrases(phrases, font)` (a run `PHRASE_GAP_MS` apart, one joined vibrate), `toggle`, `enabled`, `warm(font?)` (the context, and with a font the table's samples in it) |
| `web/games/<game>/src/ui/sound.ts` | game ui | the event → `{cue, buzz}` table (section 5) |
| `web/games/<game>/src/fx.ts` | game | plays a table entry through the edge with the App's font; the sound toggle |
| `web/games/<game>/src/storage.ts` | game | the key, decoder, reader, writer |
| `web/games/<game>/src/ui/state.ts` | game reducer | `App.soundFont`, `soundFont/set`, `writeSoundFont`, the `fx` effect carries the font |
| `web/shared/edge/boot.ts` | boot | `bootShell`: the boot drop before every home read, `__<game>.soundFont(name)` and `soundFontName()`; each `web/games/<game>/main.ts` passes `STORAGE_KEYS.soundFont` as `cfg.sound.fontKey` (C3) |

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
- **the shell's rows**: `SHELL_CUES` is four rows in order, each on a generic cue with a buzz
  (`cues.test.ts`); each game's fx.test.ts pins the four against its frozen copy and that its
  table's rows are those objects; cuePlayer.test.ts compiles a row by both `CueSpec` paths.
- **edge**: `playSound` for each kind over fakes; a failing fetch and a failing decode are silent;
  the sample cache fetches once per URL. Phrases (2026-09-25): a slot at an offset (a synth's
  `seq` start, a sample's `when`); a sample decoded past its slot skipped and one within the grace
  started, over a moving fake clock; `warmSamples` fetching once and playing nothing; a two-step
  phrase queued in one tick from declared lengths; the cue player's long row, a run with the
  joined buzz, `warm(font)`; the boot's one `fx` dep routing a cue to `play` and phrases to
  `playPhrases`, and warming in the App's font on each gesture.
- **lib, qualified** (2026-09-25): `ladder` cases and `baseOf`; `decodeCueId` accept/reject
  tables; `resolveCue` through the font, a `base`, then default, with lengths declared, summed or
  the fallback; `resolveVoice` to silence; `schedule` offsets (order, gaps, a silent step, a voice
  at 0 over a two-step phrase, a gain override); `place` and `joinBuzz`; `newEvents`/`lastEventId`;
  `eventEffects` (one effect in order, silent events dropped, nothing new, first paint).
- **game**: storage round trip and the refusal of unknown names (the legacy-capture parity suite,
  test/parity/gin.storage.test.ts, lists the key as this page's own); `soundFont/set` writes and
  the `fx` effect carries the font; `homeSnapshot()` drops a bad value (in `bootShell` since C3:
  web/shared/edge/boot.test.ts pins the drop, the e2e spec is the page's oracle); the e2e page-only spec
  (`e2e/gin-sound-font.spec.ts`, modelled on `gin-card-back.spec.ts`): a stored `arcade` shows after a
  reload through `__gin.soundFontName()`, `__gin.soundFont('felt')` applies and stores,
  `__gin.soundFont('plaid')` logs and refuses, a stored `tartan` is logged at boot and dropped.

## 11. Later

A master volume per game (a gain the player multiplies in); per-game default fonts (a game may name
one other than `default` in its table); the first sample font and its licensing; fidice's table;
"call the dice" voices for Sheshbesh as a font of its own.
