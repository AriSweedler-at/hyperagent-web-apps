import { describe, expect, test } from 'vitest';

import { shareText, type SharePayload } from './share.ts';

const payload: SharePayload = { title: 'Gin Rummy', text: 'Join my game — room code ABCD.' };

describe('shareText', () => {
  test('the share sheet wins when it exists and succeeds', async () => {
    const shared: SharePayload[] = [];
    const nav = {
      share: (p: SharePayload) => {
        shared.push(p);
        return Promise.resolve();
      },
      clipboard: { writeText: () => Promise.reject(new Error('unused')) },
    };
    expect(await shareText(nav, payload)).toBe('shared');
    expect(shared).toEqual([payload]);
  });

  test('a dismissed sheet is silent; any other share failure falls through to the clipboard', async () => {
    const copied: string[] = [];
    const clipboard = {
      writeText: (t: string) => {
        copied.push(t);
        return Promise.resolve();
      },
    };
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    expect(await shareText({ share: () => Promise.reject(abort), clipboard }, payload)).toBe(
      'aborted',
    );
    expect(copied).toEqual([]);
    expect(
      await shareText({ share: () => Promise.reject(new Error('nope')), clipboard }, payload),
    ).toBe('copied');
    // A non-Error rejection (a string) is not an abort either.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test
    const rejectsText = (): Promise<void> => Promise.reject('string');
    expect(await shareText({ share: rejectsText, clipboard }, payload)).toBe('copied');
    expect(copied).toEqual([payload.text, payload.text]);
  });

  test('no sheet: the clipboard; neither, or a clipboard that throws: failed', async () => {
    expect(await shareText({ clipboard: { writeText: () => Promise.resolve() } }, payload)).toBe(
      'copied',
    );
    expect(await shareText({}, payload)).toBe('failed');
    expect(
      await shareText(
        { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
        payload,
      ),
    ).toBe('failed');
  });

  test('a url rides beside the text on the sheet; the clipboard gets the text, then the url', async () => {
    const withUrl: SharePayload = {
      ...payload,
      url: 'https://games.sweedler.com/gin-rummy/?join=ABCD',
    };
    const shared: SharePayload[] = [];
    const copied: string[] = [];
    const clipboard = {
      writeText: (t: string) => {
        copied.push(t);
        return Promise.resolve();
      },
    };
    const share = (p: SharePayload): Promise<void> => {
      shared.push(p);
      return Promise.resolve();
    };
    expect(await shareText({ share, clipboard }, withUrl)).toBe('shared');
    expect(shared).toEqual([withUrl]);
    expect(await shareText({ clipboard }, withUrl)).toBe('copied');
    expect(copied).toEqual([
      'Join my game — room code ABCD. https://games.sweedler.com/gin-rummy/?join=ABCD',
    ]);
  });
});
