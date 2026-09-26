// An animation-speed preference (docs/design/briscola-battle.md §3.7, D8; Pokémon's "Battle Scene"
// option): `normal` is a game's designed timing, `quick` its ×0.6 column with floors, `off` its
// reduced-motion tables. Pure literals and their decoder, in the shared lib so a game's storage.ts
// (which may import only web/shared/lib and the two storage edges) and its ui/ clock name one
// type; `prefers-reduced-motion` wins over the preference wherever it is read.
import { literal, type Decoder } from './json.ts';

export const SPEEDS = ['normal', 'quick', 'off'] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 'normal';
export const isSpeed = (s: string): s is Speed => (SPEEDS as ReadonlyArray<string>).includes(s);
export const decodeSpeed: Decoder<Speed> = literal(...SPEEDS);
