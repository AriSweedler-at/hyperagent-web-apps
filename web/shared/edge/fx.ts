// Feedback effects that degrade silently: the screen wake lock that keeps a host phone awake in
// the lobby, vibration, and the oscillator cues the legacy gin `fx` object plays. Every browser
// API is injected as a structural type so tests run on fakes and a browser without the feature
// (or one that throws) simply does nothing, exactly as the legacy try/catch wrappers behave.

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

export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';

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

export type AudioContextLike = Readonly<{
  /** 'suspended' | 'running' | 'closed' in browsers; typed open so fakes need no cast. */
  state: string;
  currentTime: number;
  destination: AudioNodeLike;
  resume: () => Promise<void>;
  createOscillator: () => OscillatorLike;
  createGain: () => GainLike;
}>;

/** One note: frequency in Hz, duration in seconds, and the gap to the next note (defaults to `dur`). */
export type Note = Readonly<{ freq: number; dur: number; gap?: number }>;

export type AudioCues = Readonly<{
  /** Play one tone `start` seconds from now; silent when disabled or the context is not running. */
  tone: (freq: number, start: number, dur: number, type?: OscillatorType, gain?: number) => void;
  /** Play notes back to back. */
  seq: (notes: ReadonlyArray<Note>, type?: OscillatorType, gain?: number) => void;
  setEnabled: (enabled: boolean) => void;
  enabled: () => boolean;
}>;

export type AudioCueOptions = Readonly<{
  /** Constructs the context on first use (a user gesture must have happened); may be undefined. */
  makeContext: (() => AudioContextLike) | undefined;
  enabled?: boolean;
}>;

/**
 * The legacy gin `fx.ensure`/`tone`/`seq`: a lazily created context, resumed when suspended, and
 * never queued into while it is not running (mobile browsers keep it suspended until a gesture).
 */
export const createAudioCues = (options: AudioCueOptions): AudioCues => {
  let enabled = options.enabled ?? true;
  let ctx: AudioContextLike | null = null;

  const ensure = (): AudioContextLike | null => {
    if (!enabled || options.makeContext === undefined) return null;
    try {
      ctx ??= options.makeContext();
      if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
      return ctx;
    } catch {
      return null;
    }
  };

  const tone: AudioCues['tone'] = (freq, start, dur, type = 'sine', gain = 0.18) => {
    const c = ensure();
    if (c?.state !== 'running') return;
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

  const seq: AudioCues['seq'] = (notes, type, gain) => {
    notes.reduce((t, note) => {
      tone(note.freq, t, note.dur, type, gain);
      return t + (note.gap ?? note.dur);
    }, 0);
  };

  return {
    tone,
    seq,
    setEnabled: (value) => {
      enabled = value;
    },
    enabled: () => enabled,
  };
};
