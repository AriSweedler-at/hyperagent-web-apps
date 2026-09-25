// The state side of "an event happens, its phrase plays" (docs/design/briscola-sound-history.md
// §3.5): a game whose view carries an event stream (web/shared/lib/events.ts) calls this from its
// `rendered` hook with the stream it painted last and the one it paints now, and its own sound
// binding (`EventSound`, closed over `me` and the role). The new events' phrases become ONE
// `phrases` effect, played back to back PHRASE_GAP_MS apart (§8 risk 3: a trick and the result it
// ends the game with arrive in one frame), and the memory is the stream itself: a re-sent frame
// carries no new id, so nothing plays twice, and a first paint (`prev` null) replays nothing.
// Gin and backgammon keep their `cuesBetween` diffs and `fx` effects until they adopt events.
import { newEvents } from '../lib/events.ts';
import type { Phrase } from '../lib/sound/phrase.ts';
import type { ShellEffect, ShellTypes } from './shell.ts';

export const eventEffects = <E extends Readonly<{ id: number }>, G extends ShellTypes>(
  prev: ReadonlyArray<E> | null,
  next: ReadonlyArray<E>,
  phraseOf: (event: E) => Phrase | null,
): ReadonlyArray<ShellEffect<G>> => {
  const phrases = newEvents(prev, next).flatMap((event) => {
    const phrase = phraseOf(event);
    return phrase === null ? [] : [phrase];
  });
  return phrases.length === 0 ? [] : [{ type: 'phrases', phrases }];
};
