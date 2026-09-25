// A player's display name as a form or a seat accepts it (docs/design/dry-round-2.md H4): trimmed,
// cut to the game's maximum, the game's fallback when nothing is left. Fidice spelled
// `trim().slice(0, 16) || 'Player'` at four sites (the name form, the pass-the-phone list, a bot's
// rename, a seated human); its `NAME_RULE` in domain/types.ts is the one home of 16/'Player' now.
// Gin and backgammon keep their own `nameOr`, which applies the fallback before the cut, and the
// wire cut `guestNameFor`, which cuts before it trims: neither is this function byte for byte.

/** What a game accepts as a name: at most `max` characters, `fallback` for an empty one. */
export type NameRule = Readonly<{ max: number; fallback: string }>;

/** `raw.trim().slice(0, max) || fallback`: a blank or whitespace-only name takes the fallback. */
export const normaliseName = (raw: string, rule: NameRule): string =>
  raw.trim().slice(0, rule.max) || rule.fallback;
