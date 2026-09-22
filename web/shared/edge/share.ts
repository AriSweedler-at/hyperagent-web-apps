// The invite share (docs/MIGRATION.md step 12): the legacy gin `#shareCodeBtn` handler
// (legacy/gin-rummy/index.html) tries the Web Share sheet, then the clipboard, and tells the
// player what happened. The navigator is injected as a structural type so tests run on fakes and
// a browser without either API takes the fallback, as the legacy try/catch chain did: a share
// sheet the player dismissed (`AbortError`) is silent; a share that failed any other way falls
// through to the clipboard; a clipboard that failed reports `failed` so the page can show the
// code itself.

/**
 * `text` and `url` ride together on the share sheet, either may be left out; the clipboard gets
 * whichever are there, `text` then `url`, a space between.
 */
export type SharePayload = Readonly<{ title: string; text?: string; url?: string }>;

export type ShareNavigatorLike = Readonly<{
  share?: (payload: SharePayload) => Promise<void>;
  clipboard?: Readonly<{ writeText: (text: string) => Promise<void> }>;
}>;

export type ShareOutcome = 'shared' | 'aborted' | 'copied' | 'failed';

const isAbort = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as Partial<Error>).name === 'AbortError';

/** What the clipboard gets for `payload`: its text and its url, whichever are there. */
export const clipboardLine = (payload: SharePayload): string =>
  [payload.text, payload.url].filter((s): s is string => s !== undefined).join(' ');

/** Share `payload` through the sheet, else copy it; never throws. */
export const shareText = async (
  nav: ShareNavigatorLike,
  payload: SharePayload,
): Promise<ShareOutcome> => {
  try {
    if (nav.share !== undefined) {
      await nav.share(payload);
      return 'shared';
    }
  } catch (e) {
    if (isAbort(e)) return 'aborted';
  }
  try {
    if (nav.clipboard === undefined) return 'failed';
    await nav.clipboard.writeText(clipboardLine(payload));
    return 'copied';
  } catch {
    return 'failed';
  }
};
