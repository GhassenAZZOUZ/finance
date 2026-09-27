import { type Cents, roundHalfAwayFromZero } from "./money";
import { type YearMonth, monthsBetween } from "./months";
import { normalPayment } from "./payment";

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
 * simulation's rules (interest rounded to the cent, last payment capped, residual absorbed). SPEC D5c.
 */
export function projectBalance(balance: Cents, apr: number, monthlyPayment: Cents, payments: number): Cents {
  let b = Math.max(0, balance);
  for (let i = 0; i < payments && b > 0; i++) {
    const interest = roundHalfAwayFromZero((b * apr) / 12);
    b = b + interest - normalPayment(b + interest, monthlyPayment);
  }
  return b;
}

/**
 * Number of normal payments (at most `maxPayments`) after which the balance is fully repaid,
 * with the same rules as projectBalance; null if it is not repaid within `maxPayments`.
 */
export function paymentsUntilRepaid(balance: Cents, apr: number, monthlyPayment: Cents, maxPayments: number): number | null {
  let b = Math.max(0, balance);
  if (b === 0) return 0;
  for (let i = 1; i <= maxPayments; i++) {
    const interest = roundHalfAwayFromZero((b * apr) / 12);
    b = b + interest - normalPayment(b + interest, monthlyPayment);
    if (b <= 0) return i;
  }
  return null;
}
