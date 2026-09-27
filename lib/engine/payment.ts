import type { Cents } from "./money";

/** A residual below this after a normal payment is paid with it, as banks do (SPEC D13). */
export const RESIDUAL_ABSORB_THRESHOLD: Cents = 100;

/**
 * Normal payment of a month, given `due` = balance + interest: the monthly payment, capped at
 * `due` (last payment), and raised to `due` when less than 1 € would otherwise remain.
 */
export function normalPayment(due: Cents, monthlyPayment: Cents): Cents {
  return due - monthlyPayment < RESIDUAL_ABSORB_THRESHOLD ? due : monthlyPayment;
}
