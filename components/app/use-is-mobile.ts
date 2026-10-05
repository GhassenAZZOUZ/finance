"use client";

import { useSyncExternalStore } from "react";

/** Below Tailwind's `md` (48rem): the phone layouts of the mobile redesign (#108–#113). */
export const MOBILE_QUERY = "(max-width: 47.999rem)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * True on a phone-width window. False on the server, before hydration and where `matchMedia` is
 * missing (tests): components that need a mobile-only structure mount it only when this is true.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(MOBILE_QUERY).matches : false),
    () => false,
  );
}
