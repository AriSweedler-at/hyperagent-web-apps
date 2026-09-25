// The iPhone Safari audio unlock (docs/design/sound-fonts.md §12). Two things a Web Audio context
// cannot do for itself on an iPhone: the ringer (silent) switch mutes every AudioContext whose page
// has never played a media element, and a context left `suspended` or `interrupted` only resumes
// inside a gesture. `createAudioUnlock` owns the first: on iOS 17+ it asks for the `playback`
// audio session (`navigator.audioSession.type`), which the switch does not govern; on every iOS it
// plays one looping, silent, inline `<audio>` made from an embedded WAV, the media element WebKit
// wants to have seen before Web Audio may sound over the switch. Both are feature-checked, so on
// Chrome and Firefox (no `audioSession`; an `<audio>` that plays nothing anyone hears) they cost
// one hidden element, and a document without `createElement` (the boot test's fake) gets nothing.
// `unlock()` runs inside the gesture that turns sound on (the speaker button's tap: bootShell's
// `onToggle`) and on the first gesture over a page whose sound is already on; the element is made
// once and `.play()` is asked again on every call, since a paused loop (a backgrounding) is the
// unlock lost. Every failure is silent, as the rest of this edge.

/** The `document` as the unlock reads it: `createElement` optional, so the boot's fakes need nothing. */
export type UnlockDocumentLike = Readonly<{
  createElement?: (tag: 'audio') => UnlockAudioLike;
  body: Readonly<{ appendChild: (node: UnlockAudioLike) => unknown }>;
}>;

/**
 * The `<audio>` element, the fields the unlock sets and the one call it makes. A media element is
 * mutable by nature; the three fields are set through a cast, as fx.ts sets an oscillator's type.
 */
export type UnlockAudioLike = Readonly<{
  src: string;
  loop: boolean;
  preload: string;
  setAttribute: (name: string, value: string) => void;
  play: () => Promise<void> | undefined;
}>;

/** The `navigator` with WebKit's audio session (iOS 17+), optional everywhere else. */
export type UnlockNavigatorLike = Readonly<{
  audioSession?: Readonly<{ type: string }>;
}>;

/**
 * Silence: an 8 kHz, 8-bit, mono WAV of 32 centre (0x80) samples, 4 ms, 76 bytes (a header with
 * no samples is refused by WebKit); unlock.test.ts decodes and checks the header.
 */
export const SILENT_WAV_URI =
  'data:audio/wav;base64,UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

export type AudioUnlock = Readonly<{
  /** Inside a gesture: the session asked for, the silent loop made once and played (again). */
  unlock: () => void;
  /** The silent element exists (a page that never saw a gesture with sound on has none). */
  unlocked: () => boolean;
}>;

export const createAudioUnlock = (
  doc: UnlockDocumentLike,
  nav: UnlockNavigatorLike,
): AudioUnlock => {
  let element: UnlockAudioLike | null = null;
  const askSession = (): void => {
    const session = nav.audioSession;
    try {
      if (session !== undefined) (session as { type: string }).type = 'playback';
    } catch {
      /* a read-only or refusing session: the silent loop still runs */
    }
  };
  const makeElement = (): UnlockAudioLike | null => {
    if (doc.createElement === undefined) return null;
    try {
      const audio = doc.createElement('audio');
      const fields = audio as { src: string; loop: boolean; preload: string };
      fields.src = SILENT_WAV_URI;
      fields.loop = true;
      fields.preload = 'auto';
      audio.setAttribute('playsinline', '');
      audio.setAttribute('aria-hidden', 'true');
      audio.setAttribute('hidden', '');
      doc.body.appendChild(audio);
      return audio;
    } catch {
      return null;
    }
  };
  const unlock = (): void => {
    askSession();
    element ??= makeElement();
    try {
      // `play()` returns a promise in every current browser; older WebKit returned nothing.
      element?.play()?.catch(() => undefined);
    } catch {
      /* not allowed outside a gesture, or no source: nothing to do */
    }
  };
  return { unlock, unlocked: () => element !== null };
};
