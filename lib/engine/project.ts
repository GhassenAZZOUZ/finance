import { type Cents, roundHalfAwayFromZero } from "./money";
import { type YearMonth, monthsBetween } from "./months";

/**
 * Number of normal payments between a balance read after the payment of `paidThroughMonth`
 * and the plan start (whose own payment is month 1 of the plan): start − paidThrough − 1.
 * Negative when the balance was read after the plan start (it is then used as is).
 */
export function paymentsBeforeStart(paidThroughMonth: YearMonth, startMonth: YearMonth): number {
  return monthsBetween(paidThroughMonth, startMonth) - 1;
}

/**
 * Rolls a loan balance forward by `payments` normal monthly payments, with exactly the
 * simulation's rules (interest rounded to the cent, last payment capped). SPEC D5c.
 */
export function projectBalance(balance: Cents, apr: number, monthlyPayment: Cents, payments: number): Cents {
  let b = Math.max(0, balance);
  for (let i = 0; i < payments && b > 0; i++) {
    const interest = roundHalfAwayFromZero((b * apr) / 12);
    b = b + interest - Math.min(monthlyPayment, b + interest);
  }
  return b;
}
