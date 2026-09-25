// Feedback effects that degrade silently: the screen wake lock that keeps a host phone awake in
// the lobby, vibration, and the oscillator cues the legacy gin `fx` object plays. Every browser
// API is injected as a structural type so tests run on fakes and a browser without the feature
// (or one that throws) simply does nothing, exactly as the legacy try/catch wrappers behave. The
// note and voice types live in web/shared/lib/sound/sound.ts since the fonts (docs/design/
// sound-fonts.md) needed them below the edge; they are re-exported here for the cues' callers.
import type { Note, OscillatorType } from '../lib/sound/sound.ts';

export type { Note, OscillatorType };

export type WakeLockSentinelLike = Readonly<{
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}>;

export type NavigatorLike = Readonly<{
  wakeLock?: Readonly<{ request: (type: 'screen') => Promise<WakeLockSentinelLike> }>;
  vibrate?: (pattern: number | ReadonlyArray<number>) => boolean;
}>;

export type WakeLock = Readonly<{
  /** Request the lock if supported and not held; resolves once the request settled either way. */
  hold: () => Promise<void>;
  /** Release the lock if held. */
  drop: () => void;
  held: () => boolean;
}>;

/** The legacy `holdWakeLock` / `dropWakeLock` pair, with the sentinel kept in a closure. */
export const createWakeLock = (nav: NavigatorLike): WakeLock => {
  let sentinel: WakeLockSentinelLike | null = null;
  const hold = async (): Promise<void> => {
    try {
      if (nav.wakeLock === undefined || sentinel !== null) return;
      const acquired = await nav.wakeLock.request('screen');
      sentinel = acquired;
      acquired.addEventListener('release', () => {
        if (sentinel === acquired) sentinel = null;
      });
    } catch {
      /* unsupported, denied or the page is hidden: the lobby simply does not stay awake */
    }
  };
  const drop = (): void => {
    try {
      sentinel?.release().catch(() => undefined);
    } catch {
      /* ignore */
    }
    sentinel = null;
  };
  return { hold, drop, held: () => sentinel !== null };
};

/** `navigator.vibrate` when it exists; silent otherwise or when it throws. */
export const vibrate = (nav: NavigatorLike, pattern: number | ReadonlyArray<number>): void => {
  try {
    nav.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
};

// --- audio ---------------------------------------------------------------------------------

export type AudioParamLike = Readonly<{
  setValueAtTime: (value: number, time: number) => unknown;
  exponentialRampToValueAtTime: (value: number, time: number) => unknown;
}>;

export type AudioNodeLike = Readonly<{ connect: (target: AudioNodeLike) => AudioNodeLike }>;

export type OscillatorLike = AudioNodeLike &
  Readonly<{
    type: OscillatorType;
    frequency: AudioParamLike;
    start: (time: number) => void;
    stop: (time: number) => void;
  }>;

export type GainLike = AudioNodeLike & Readonly<{ gain: AudioParamLike }>;

/** A decoded sample; the edge only holds it and hands it to a source. */
export type AudioBufferLike = Readonly<{ duration: number }>;

export type BufferSourceLike = AudioNodeLike &
  Readonly<{ buffer: AudioBufferLike | null; start: (time: number) => void }>;

export type AudioContextLike = Readonly<{
  /** 'suspended' | 'running' | 'closed' in browsers; typed open so fakes need no cast. */
  state: string;
  currentTime: number;
  destination: AudioNodeLike;
  resume: () => Promise<void>;
  createOscillator: () => OscillatorLike;
  createGain: () => GainLike;
  /** The sample seam (sound.ts); optional, so a fake for the oscillator cues needs neither. */
  decodeAudioData?: (data: ArrayBuffer) => Promise<AudioBufferLike>;
  createBufferSource?: () => BufferSourceLike;
}>;

export type AudioCues = Readonly<{
  /** Play one tone `start` seconds from now; silent when disabled or the context is not running. */
  tone: (freq: number, start: number, dur: number, type?: OscillatorType, gain?: number) => void;
  /** Play notes back to back, the first `start` seconds from now (0: at once, as every table row plays). */
  seq: (notes: ReadonlyArray<Note>, type?: OscillatorType, gain?: number, start?: number) => void;
  /** Create and resume the context without playing (the legacy `ensure()` on the first gesture). */
  warm: () => void;
  setEnabled: (enabled: boolean) => void;
  enabled: () => boolean;
  /**
   * The context the cues play through, made and resumed as `warm` does, or null while disabled or
   * without one: the sample player (sound.ts) decodes into it and plays from it.
   */
  context: () => AudioContextLike | null;
}>;

export type AudioCueOptions = Readonly<{
  /** Constructs the context on first use (a user gesture must have happened); may be undefined. */
  makeContext: (() => AudioContextLike) | undefined;
  enabled?: boolean;
}>;

/** A note asked for while the context was not yet running: booked again, at its offset, once it is. */
type PendingTone = Readonly<{
  freq: number;
  start: number;
  dur: number;
  type: OscillatorType;
  gain: number;
}>;

/**
 * How long a note may wait for the context to run (seconds). iPhone Safari resolves `resume()` a
 * few ms after the gesture that allowed it; a note still waiting a whole second later belongs to a
 * moment that has passed (a phrase from before the tab was backgrounded) and is dropped.
 */
export const PENDING_TONE_MAX_S = 1;

/**
 * The context states that want a `resume()`: `suspended` (every browser, before the first gesture)
 * and WebKit's `interrupted` (a phone call, the tab backgrounded, another app took the audio
 * session), which iPhone Safari leaves the context in until the page resumes it from a gesture.
 */
const wantsResume = (state: string): boolean => state === 'suspended' || state === 'interrupted';

/**
 * The legacy gin `fx.ensure`/`tone`/`seq`: a lazily created context, resumed when suspended (or
 * interrupted, as WebKit says after a backgrounding), and never queued into while it is not
 * running (mobile browsers keep it suspended until a gesture). A note asked for while the resume
 * is in flight is held and booked at its offset once the context runs, so the tap that unmutes
 * a phone chimes; the desktop path (a context made inside a gesture is running at once) is
 * untouched, since nothing is held when the state is already `running`.
 */
export const createAudioCues = (options: AudioCueOptions): AudioCues => {
  let enabled = options.enabled ?? true;
  let ctx: AudioContextLike | null = null;
  let pending: PendingTone[] = [];
  let pendingSince = 0;

  const ensure = (): AudioContextLike | null => {
    if (!enabled || options.makeContext === undefined) return null;
    try {
      ctx ??= options.makeContext();
      if (wantsResume(ctx.state)) {
        const c = ctx;
        c.resume()
          .then(() => {
            flushPending(c);
          })
          .catch(() => undefined);
      }
      return ctx;
    } catch {
      return null;
    }
  };

  /** Every held note, booked now at its offset, if the context runs; dropped when it still does not or they are stale. */
  const flushPending = (c: AudioContextLike): void => {
    const held = pending;
    pending = [];
    if (held.length === 0 || c.state !== 'running') return;
    if (c.currentTime - pendingSince > PENDING_TONE_MAX_S) return;
    held.forEach((t) => {
      tone(t.freq, t.start, t.dur, t.type, t.gain);
    });
  };

  const tone: AudioCues['tone'] = (freq, start, dur, type = 'sine', gain = 0.18) => {
    const c = ensure();
    if (c === null) return;
    if (c.state !== 'running') {
      // A resume is in flight (or the state is closed, in which case the flush finds nothing to do).
      if (pending.length === 0) pendingSince = c.currentTime;
      pending = [...pending, { freq, start, dur, type, gain }];
      return;
    }
    try {
      const t0 = c.currentTime + start;
      const o = c.createOscillator();
      const g = c.createGain();
      // Oscillator and gain nodes are mutable by nature; `type` is the one field set directly.
      (o as { type: OscillatorType }).type = type;
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch {
      /* a closed context or a bad parameter: no cue, no crash */
    }
  };

  // `start` lets a phrase (web/shared/edge/sound.ts `playSlot`) book a later step ahead of time:
  // Web Audio schedules by absolute time, so the notes queue now and sound then.
  const seq: AudioCues['seq'] = (notes, type, gain, start = 0) => {
    notes.reduce((t, note) => {
      tone(note.freq, t, note.dur, type, gain);
      return t + (note.gap ?? note.dur);
    }, start);
  };

  return {
    tone,
    seq,
    warm: () => {
      ensure();
    },
    setEnabled: (value) => {
      enabled = value;
    },
    enabled: () => enabled,
    context: ensure,
  };
};
