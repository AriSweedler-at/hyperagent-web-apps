// Phrases (docs/design/sound-fonts.md §2.2; docs/design/briscola-sound-history.md §3.2): what one
// event plays when one sting is not enough. Ordered `steps` play back to back, each after the one
// before ends (plus its `gapMs`), so "the briscola sting THEN the victory" is two steps; `voices`
// are announcer lines laid over the steps at an offset from the phrase's start, in the `voice.*`
// namespace the default font leaves silent; one `buzz` pattern per phrase, as a table row has
// always had. A row of a game's table (`CueSpec`, cues.ts) IS a phrase: the one-step
// `spec(cue, buzz)`, so gin's and backgammon's tables and every fx.test.ts pin stand with no edit.
// Pure: `schedule` turns a phrase into `{sound, atMs, ms}` slots from the font's DECLARED lengths
// (a synth's from its notes, a sample's from `durationsMs`), so the edge (web/shared/edge/sound.ts)
// only starts each sound at its offset and never waits on a decode to know when the next begins.
import type { Buzz, CueId, CueSpec, VoiceId } from './cues.ts';
import { resolveCue, resolveVoice, type SoundFont } from './fonts.ts';
import type { Sound } from './sound.ts';

/** One sting of a phrase; `gapMs` is silence between the previous step's end and this one (0). */
export type Step = Readonly<{ cue: CueId; gapMs?: number }>;
/** A layer over the steps: starts `atMs` after the phrase does; `gain` overrides the font's. */
export type Voice = Readonly<{ cue: VoiceId; atMs: number; gain?: number }>;
/** The long form of a phrase. */
export type Sequence = Readonly<{
  steps: ReadonlyArray<Step>;
  voices?: ReadonlyArray<Voice>;
  buzz: Buzz;
}>;
/** What a table row holds: a sequence, or today's row, which is the one-step phrase `spec(cue, buzz)`. */
export type Phrase = Sequence | CueSpec;

/** Today's `CueSpec` as a phrase: one step, no voices, the row's buzz. */
export const spec = (cue: CueId, buzz: Buzz): Sequence => ({ steps: [{ cue }], buzz });

/** Either form as the long one. */
export const sequenceOf = (phrase: Phrase): Sequence =>
  'cue' in phrase ? spec(phrase.cue, phrase.buzz) : phrase;

/**
 * The pause between two events' phrases played in one paint (sound-history.md §8 risk 3): a trick
 * and the result it ends the game with arrive in one frame, and the win sting must not start
 * under the trick's.
 */
export const PHRASE_GAP_MS = 120;

/** One sound to start: at `atMs` from the phrase's start, booked for `ms`. */
export type Slot = Readonly<{ sound: Sound; atMs: number; ms: number }>;

const withGain = (sound: Sound, gain: number | undefined): Sound =>
  gain === undefined || sound.kind === 'silence' ? sound : { ...sound, gain };

type Laid = Readonly<{ end: number; slots: ReadonlyArray<Slot> }>;

/** Every step and voice as a slot, silence included (it still takes its declared time). */
const laid = (font: SoundFont, phrase: Phrase): Laid => {
  const { steps, voices = [] } = sequenceOf(phrase);
  const stepped = steps.reduce<Laid>(
    (acc, step, i) => {
      const { sound, ms } = resolveCue(font, step.cue);
      const atMs = i === 0 ? 0 : acc.end + (step.gapMs ?? 0);
      return { end: atMs + ms, slots: [...acc.slots, { sound, atMs, ms }] };
    },
    { end: 0, slots: [] },
  );
  const voiced = voices.map((voice): Slot => {
    const { sound, ms } = resolveVoice(font, voice.cue);
    return { sound: withGain(sound, voice.gain), atMs: voice.atMs, ms };
  });
  const slots = [...stepped.slots, ...voiced];
  return { end: Math.max(0, ...slots.map((s) => s.atMs + s.ms)), slots };
};

/** What plays, and when, from the font's declared lengths; silent slots are left out. */
export const schedule = (font: SoundFont, phrase: Phrase): ReadonlyArray<Slot> =>
  laid(font, phrase).slots.filter((slot) => slot.sound.kind !== 'silence');

/** Where the last step or voice ends: the next phrase in a run starts after it. */
export const phraseMs = (font: SoundFont, phrase: Phrase): number => laid(font, phrase).end;

/** A phrase in a run: its start, its slots already shifted to it, and its buzz. */
export type Placed = Readonly<{ atMs: number; slots: ReadonlyArray<Slot>; buzz: Buzz }>;

/** Phrases back to back, `gapMs` apart, each starting where the one before ends. */
export const place = (
  font: SoundFont,
  phrases: ReadonlyArray<Phrase>,
  gapMs: number,
): ReadonlyArray<Placed> =>
  phrases.reduce<Readonly<{ end: number; placed: ReadonlyArray<Placed> }>>(
    (acc, phrase) => {
      const atMs = acc.placed.length === 0 ? 0 : acc.end + gapMs;
      const slots = schedule(font, phrase).map((s) => ({ ...s, atMs: s.atMs + atMs }));
      const buzz = sequenceOf(phrase).buzz;
      return { end: atMs + phraseMs(font, phrase), placed: [...acc.placed, { atMs, slots, buzz }] };
    },
    { end: 0, placed: [] },
  ).placed;

const pattern = (buzz: Buzz): ReadonlyArray<number> => (typeof buzz === 'number' ? [buzz] : buzz);
const total = (ms: ReadonlyArray<number>): number => ms.reduce((a, b) => a + b, 0);

/**
 * One `navigator.vibrate` pattern for a run of phrases (sound-history.md §3.4 "one vibrate"): each
 * phrase's buzz starts with its sound, so the pause before it is its start less what the pattern
 * already lasts. A pattern alternates on/off; when the run so far ends on an off (an even length,
 * the empty run included) a 0 ms on is slipped in so the pause stays an off.
 */
export const joinBuzz = (
  parts: ReadonlyArray<Readonly<{ buzz: Buzz; atMs: number }>>,
): ReadonlyArray<number> =>
  parts.reduce<ReadonlyArray<number>>((acc, part) => {
    const pause = Math.max(0, part.atMs - total(acc));
    const lead = acc.length % 2 === 0 ? [0, pause] : [pause];
    return [...acc, ...lead, ...pattern(part.buzz)];
  }, []);
