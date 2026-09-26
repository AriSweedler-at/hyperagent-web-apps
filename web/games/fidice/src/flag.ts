// The shell-path flag and the two URL residues main.ts reads while both boots live
// (docs/design/fidice-shell-adoption.md §4 M4; §6 risks 10, 14; §7 D2). `?shell=1` boots the shell
// path and is remembered under `fidice_shell` (storage.ts), `?shell=0` boots the old path and
// forgets it, any other query boots whatever is remembered (the old path until a device opts in),
// so a guest who follows a shell host's plain `?join=` invite has opted in once (§6 risk 17). The
// old path's share base drops the `shell` parameter so an opt-out never rides a `#join=` link; the
// shell path rewrites a bookmarked legacy invite (`#join=CODE`, src/app/controller.ts `start`) into
// the shell's `?join=CODE` before the boot's `applyInviteLink` reads the query (§6 lesson (e)), and
// copies the legacy page's name onto the shell's key when that key is empty. M6 deletes this file
// with the old boot. Pure over strings and the Store, so flag.test.ts pins every branch.
import { readName, readShellFlag, writeName, writeShellFlag, type Store } from './storage.ts';

/** The legacy page's name key (src/app/controller.ts NAME_KEY): read once by `adoptLegacyName`, never written here. */
export const LEGACY_NAME_KEY = 'fidice-name';

/** `?shell=` as the boot reads it: `1` opts in (remembered), `0` opts out (forgotten), anything else leaves the stored flag; whether the shell path boots. */
export const shellPathOn = (store: Store, param: string | null): boolean => {
  if (param === '1') {
    writeShellFlag(store, true);
    return true;
  }
  if (param === '0') {
    writeShellFlag(store, false);
    return false;
  }
  return readShellFlag(store);
};

/** A page query with `shell` taken out (the old path's share base, §6 risk 10): `?a=1&shell=0&b=2` is `?a=1&b=2`; a query of `shell` alone is empty. */
export const withoutShellParam = (search: string): string => {
  const kept = search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part !== '' && !/^shell(?:=|$)/.test(part));
  return kept.length === 0 ? '' : `?${kept.join('&')}`;
};

/** What `legacyInviteUrl` reads off the page's location. */
export type LocationLike = Readonly<{ pathname: string; search: string; hash: string }>;

/**
 * A bookmarked legacy invite (`#join=CODE`, §7 D2) as the shell spells it: the same path and query
 * with `?join=CODE` added and the hash gone, for `history.replaceState`; null for any other hash
 * (`#watch=` goes with D6: online spectators are dropped, so a watch link opens the home screen).
 */
export const legacyInviteUrl = (loc: LocationLike): string | null => {
  const m = /^#join=([A-Za-z0-9]{5})$/.exec(loc.hash);
  const code = m?.[1];
  if (code === undefined) return null;
  const query = loc.search.replace(/^\?/, '');
  return `${loc.pathname}?${query === '' ? '' : `${query}&`}join=${code.toUpperCase()}`;
};

/**
 * The name the old path saved, copied under the shell's key when that key is empty (§6 risk 14),
 * so a player's name follows them onto `?shell=1`; the old key is kept while both paths live.
 */
export const adoptLegacyName = (store: Store): void => {
  if (readName(store).ok) return;
  const legacy = store.readText(LEGACY_NAME_KEY);
  if (legacy.ok && legacy.value.trim() !== '') writeName(store, legacy.value.trim());
};
