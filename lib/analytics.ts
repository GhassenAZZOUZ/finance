/**
 * Product events (issue #140: `paywall_viewed`). Boussole has no analytics service (privacy policy:
 * no audience measurement): an event is only dispatched in the page (`boussole:event`) and kept in
 * a short log in this browser's session, for debugging. Wiring a service later means changing this
 * file and the privacy policy.
 */
export type ProductEvent = { name: "paywall_viewed"; reason: string };

const LOG_KEY = "boussole.events";
const MAX_EVENTS = 50;

export function track(event: ProductEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("boussole:event", { detail: event }));
  try {
    const log = JSON.parse(window.sessionStorage.getItem(LOG_KEY) ?? "[]") as unknown[];
    log.push({ ...event, at: new Date().toISOString() });
    window.sessionStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_EVENTS)));
  } catch {
    // Storage unavailable: the event is still dispatched.
  }
}
