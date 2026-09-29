/**
 * Finance plan engine: pure, deterministic, framework-free. See docs/SPEC.md.
 */
export * from "./types";
export * from "./money";
export * from "./months";
export {
  simulatePlan,
  computePriorities,
  indexationYears,
  indexedAmount,
  isLineActive,
  isOverdraft,
  lineRate,
  penaltyFor,
} from "./simulate";
export { compareActual, latestActual, plannedSnapshot, statusFor, GAP_TOLERANCE } from "./actuals";
export { paymentsBeforeStart, paymentsUntilRepaid, projectBalance } from "./project";
export { normalPayment, RESIDUAL_ABSORB_THRESHOLD } from "./payment";
