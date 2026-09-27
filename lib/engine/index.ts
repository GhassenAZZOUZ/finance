/**
 * Finance plan engine: pure, deterministic, framework-free. See docs/SPEC.md.
 */
export * from "./types";
export * from "./money";
export * from "./months";
export { simulatePlan, computePriorities } from "./simulate";
export { compareActual, latestActual, statusFor, GAP_TOLERANCE } from "./actuals";
export { paymentsBeforeStart, paymentsUntilRepaid, projectBalance } from "./project";
export { normalPayment, RESIDUAL_ABSORB_THRESHOLD } from "./payment";
