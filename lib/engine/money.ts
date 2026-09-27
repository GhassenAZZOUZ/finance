/**
 * Money is always an integer number of cents (SPEC §4.0, decision D2 "xx.xx").
 * Rates (APR, percentages, ratios) are plain fractions and are never rounded.
 */
export type Cents = number;

/**
 * Excel `ROUND(x, 0)`: snap `x` to 15 significant digits (what Excel does, which absorbs
 * binary noise such as 31809.499999999996), then round half away from zero.
 */
export function roundHalfAwayFromZero(x: number): number {
  if (!Number.isFinite(x)) {
    throw new RangeError(`Cannot round a non-finite number: ${x}`);
  }
  const snapped = Number(x.toPrecision(15));
  const rounded = Math.round(Math.abs(snapped));
  return snapped < 0 && rounded !== 0 ? -rounded : rounded;
}

/** Euros (at most 2 decimals, as entered by the user) to cents. */
export function eurosToCents(euros: number): Cents {
  return roundHalfAwayFromZero(euros * 100);
}

export function centsToEuros(cents: Cents): number {
  return cents / 100;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
