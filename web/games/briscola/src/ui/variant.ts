// The clash's variant (docs/design/briscola-battle.md §3.3, §3.4): one formula, many surfaces.
// The meaning-bearing slots are RULES over the trick (`trickFacts`, the engine's pure reading of a
// resolved trick: the winning card's suit picks the impact frame's family, `briscola` the sparkles,
// `steal` their second pulse, the trick's value class the freeze and the winner's shake); the
// flavour slots are the digits of one FNV-1a hash (web/shared/lib/hash.ts) over
// `startedAt:gameNo:no:cardIds`, decoded in mixed radix (arities 3·3·2·3·2·2·5·3·2 = 6480, divmod
// in that order, so every surface has 662,803 or 662,804 preimages). Every device at a table has
// the same inputs and so decodes the same clash; nothing crosses the wire and no `TrickData`
// field is added (the wire goldens stay byte-identical). `variantFrom(index, facts)` is the
// story/e2e hook's way in (`__briscola.variant(index)`, index 0 to 6479).
import { fnv1a32 } from '../../../../shared/lib/hash.ts';
import {
  trickFacts,
  type Suit,
  type TrickFacts,
  type TrickRecord,
  type ValueClass,
} from '../engine/index.ts';

// ---- the flavour digits ---------------------------------------------------------------------------------

/** d0 charge.dist · d1 charge.angle · d2 its sign · d3 tempo · d4 frame A/B · d5 ring/scatter · d6 loser pose · d7 winner after · d8 stack side. */
export const ARITIES = [3, 3, 2, 3, 2, 2, 5, 3, 2] as const;
export const VARIANT_COUNT = ARITIES.reduce<number>((n, a) => n * a, 1);
export type Digits = ReadonlyArray<number>;

/** The mixed-radix digits of an index (0 to `VARIANT_COUNT` − 1), least significant slot first. */
export const digitsOf = (index: number): Digits =>
  ARITIES.reduce<Readonly<{ rest: number; digits: ReadonlyArray<number> }>>(
    (acc, a) => ({ rest: Math.floor(acc.rest / a), digits: [...acc.digits, acc.rest % a] }),
    { rest: index, digits: [] },
  ).digits;

/** The index the digits spell (`digitsOf`'s inverse). */
export const indexOf = (digits: Digits): number =>
  ARITIES.reduceRight((idx, a, i) => idx * a + (digits[i] ?? 0), 0);

/** The seed every device can spell for one trick: when the match started, which game, which trick, which cards in play order. */
export const variantSeed = (
  startedAt: number,
  gameNo: number,
  trick: Pick<TrickRecord, 'no' | 'cards'>,
): string =>
  `${String(startedAt)}:${String(gameNo)}:${String(trick.no)}:${trick.cards.map((p) => p.card.id).join(',')}`;

/** The variant index of a seed. */
export const variantIndex = (seed: string): number => fnv1a32(seed) % VARIANT_COUNT;

// ---- the slots ----------------------------------------------------------------------------------------------

export const CHARGE_DISTS = [0.18, 0.24, 0.3] as const;
export const CHARGE_ANGLES = [6, 10, 14] as const;
export const TEMPOS = ['snappy', 'even', 'heavy'] as const;
export type Tempo = (typeof TEMPOS)[number];
/** What a tempo multiplies CHARGE, STRIKE and AFTERMATH by. */
export const TEMPO_SCALE: Readonly<Record<Tempo, number>> = { snappy: 0.85, even: 1, heavy: 1.15 };
export const FRAMES = ['a', 'b'] as const;
export type Frame = (typeof FRAMES)[number];
export const SPARKLE_SHAPES = ['ring', 'scatter'] as const;
export type SparkleShape = (typeof SPARKLE_SHAPES)[number];
export const LOSER_POSES = ['wilt', 'tear', 'fade', 'spin-out', 'flutter'] as const;
export type LoserPose = (typeof LOSER_POSES)[number];
export const WINNER_AFTERS = ['hold-high', 'slam-down', 'shimmy'] as const;
export type WinnerAfter = (typeof WINNER_AFTERS)[number];
export const STACK_SIDES = ['left', 'right'] as const;
export type StackSide = (typeof STACK_SIDES)[number];

/** IMPACT's hit-stop by the trick's value (§3.2; never × tempo). */
export const FREEZE_MS: Readonly<Record<ValueClass, number>> = {
  pointless: 120,
  small: 120,
  big: 160,
  huge: 200,
};
/** The winner's vibrate, in px, by the trick's value (the arena never moves). */
export const SHAKE_PX: Readonly<Record<ValueClass, number>> = {
  pointless: 0,
  small: 1,
  big: 1,
  huge: 2,
};

/** The hash's slots. */
export type Flavour = Readonly<{
  chargeDist: (typeof CHARGE_DISTS)[number];
  chargeAngle: (typeof CHARGE_ANGLES)[number];
  chargeSign: 1 | -1;
  tempo: Tempo;
  frame: Frame;
  sparkleShape: SparkleShape;
  pose: LoserPose;
  after: WinnerAfter;
  side: StackSide;
}>;

/** The trick's slots. */
export type Rules = Readonly<{
  /** The impact frame's family: the WINNING card's suit. */
  suit: Suit;
  briscola: boolean;
  steal: boolean;
  /** `none` unless the winner is a briscola. */
  sparkle: 'none' | SparkleShape;
  freezeMs: number;
  shakePx: number;
  valueClass: ValueClass;
}>;

export type Variant = Flavour & Rules & Readonly<{ index: number }>;

const pick = <T>(values: ReadonlyArray<T>, d: number | undefined): T => {
  const v = values[d ?? 0];
  if (v === undefined) throw new Error(`variant digit ${String(d)} out of range`);
  return v;
};

/** The flavour an index spells. */
export const flavourOf = (index: number): Flavour => {
  const d = digitsOf(index);
  return {
    chargeDist: pick(CHARGE_DISTS, d[0]),
    chargeAngle: pick(CHARGE_ANGLES, d[1]),
    chargeSign: d[2] === 0 ? 1 : -1,
    tempo: pick(TEMPOS, d[3]),
    frame: pick(FRAMES, d[4]),
    sparkleShape: pick(SPARKLE_SHAPES, d[5]),
    pose: pick(LOSER_POSES, d[6]),
    after: pick(WINNER_AFTERS, d[7]),
    side: pick(STACK_SIDES, d[8]),
  };
};

/** The rules over the trick; the last trick of a hand freezes `huge` whatever its points (§3.3's named rarity). */
export const rulesOf = (facts: TrickFacts, flavour: Flavour, lastTrick: boolean): Rules => {
  const valueClass: ValueClass = lastTrick ? 'huge' : facts.valueClass;
  return {
    suit: facts.winningCard.s,
    briscola: facts.briscola,
    steal: facts.steal,
    sparkle: facts.briscola ? flavour.sparkleShape : 'none',
    freezeMs: FREEZE_MS[valueClass],
    shakePx: SHAKE_PX[valueClass],
    valueClass,
  };
};

/** The variant at an index over a trick's facts: the hook's entry, and `variantOf`'s. */
export const variantFrom = (index: number, facts: TrickFacts, lastTrick = false): Variant => {
  const flavour = flavourOf(index);
  return { ...flavour, ...rulesOf(facts, flavour, lastTrick), index };
};

/** The clash every device at the table sees for this trick. */
export const variantOf = (
  trump: Suit,
  trick: TrickRecord,
  startedAt: number,
  gameNo: number,
  lastTrick = false,
): Variant =>
  variantFrom(
    variantIndex(variantSeed(startedAt, gameNo, trick)),
    trickFacts(trump, trick.cards),
    lastTrick,
  );
