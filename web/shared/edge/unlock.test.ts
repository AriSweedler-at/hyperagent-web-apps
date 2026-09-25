// The iPhone Safari audio unlock over fakes (docs/design/sound-fonts.md §12): the silent loop is
// made once with the attributes WebKit wants and played on every call, the audio session is asked
// for `playback` when the navigator has one, a document without `createElement` (the boot test's
// fake) gets nothing, a refusing `play()` or session is silent, and the embedded WAV is a WAV.
import { describe, expect, test } from 'vitest';

import {
  SILENT_WAV_URI,
  createAudioUnlock,
  type UnlockAudioLike,
  type UnlockDocumentLike,
} from './unlock.ts';

type World = Readonly<{
  doc: UnlockDocumentLike;
  made: UnlockAudioLike[];
  appended: unknown[];
  plays: () => number;
  attrs: () => ReadonlyArray<readonly [string, string]>;
}>;

const world = (
  options: Readonly<{ createElement?: false; play?: 'reject' | 'throw' | 'void' }> = {},
): World => {
  const made: UnlockAudioLike[] = [];
  const appended: unknown[] = [];
  const attrs: (readonly [string, string])[] = [];
  const counts = { plays: 0 };
  const createElement = (): UnlockAudioLike => {
    const audio: UnlockAudioLike = {
      src: '',
      loop: false,
      preload: '',
      setAttribute: (name, value) => {
        attrs.push([name, value]);
      },
      play: () => {
        counts.plays += 1;
        if (options.play === 'throw') throw new Error('NotAllowedError');
        if (options.play === 'void') return undefined;
        return options.play === 'reject'
          ? Promise.reject(new Error('NotAllowedError'))
          : Promise.resolve();
      },
    };
    made.push(audio);
    return audio;
  };
  const doc: UnlockDocumentLike = {
    ...(options.createElement === false ? {} : { createElement }),
    body: {
      appendChild: (node) => {
        appended.push(node);
      },
    },
  };
  return { doc, made, appended, plays: () => counts.plays, attrs: () => attrs };
};

describe('createAudioUnlock', () => {
  test('the silent loop is made once, inline, looping, in the body; play is asked on every call', () => {
    const w = world();
    const u = createAudioUnlock(w.doc, {});
    expect(u.unlocked()).toBe(false);
    u.unlock();
    u.unlock();
    expect(u.unlocked()).toBe(true);
    expect(w.made).toHaveLength(1);
    expect(w.appended).toEqual([w.made[0]]);
    expect(w.made[0]).toMatchObject({ src: SILENT_WAV_URI, loop: true, preload: 'auto' });
    expect(w.attrs()).toEqual([
      ['playsinline', ''],
      ['aria-hidden', 'true'],
      ['hidden', ''],
    ]);
    expect(w.plays()).toBe(2);
  });

  test('the audio session is asked for playback when the navigator has one (iOS 17+); none elsewhere', () => {
    const session = { type: 'auto' };
    const w = world();
    createAudioUnlock(w.doc, { audioSession: session }).unlock();
    expect(session.type).toBe('playback');
    // A read-only session (a getter that refuses the write) is silent, and the loop still plays.
    const frozen = Object.freeze({ type: 'auto' });
    const w2 = world();
    expect(() => {
      createAudioUnlock(w2.doc, { audioSession: frozen }).unlock();
    }).not.toThrow();
    expect(w2.plays()).toBe(1);
  });

  test('a document without createElement gets nothing; a refusing, throwing or void play is silent', async () => {
    const none = world({ createElement: false });
    const u = createAudioUnlock(none.doc, {});
    u.unlock();
    expect(u.unlocked()).toBe(false);
    expect(none.appended).toEqual([]);

    (['reject', 'throw', 'void'] as const).forEach((play) => {
      const w = world({ play });
      expect(() => {
        createAudioUnlock(w.doc, {}).unlock();
      }).not.toThrow();
      expect(w.plays()).toBe(1);
    });
    await Promise.resolve();
  });

  test('the embedded silence is a PCM WAV: 8 kHz, 8-bit, mono, 32 centre samples', () => {
    const [head, b64] = SILENT_WAV_URI.split(',');
    expect(head).toBe('data:audio/wav;base64');
    const bytes = Uint8Array.from(atob(b64 ?? ''), (c) => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const ascii = (at: number, n: number): string =>
      String.fromCharCode(...bytes.subarray(at, at + n));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(8);
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(32);
    expect(bytes.length).toBe(76);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect([...bytes.subarray(44)].every((b) => b === 0x80)).toBe(true);
  });
});
