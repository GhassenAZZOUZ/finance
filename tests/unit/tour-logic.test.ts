/** Guided tour: popover placement next to the highlighted element, always inside the viewport. */
import { describe, expect, it } from "vitest";
import { GAP, MARGIN, TOUR_STEPS, placePopover, tourStorageKey } from "@/components/app/tour-logic";

const popover = { width: 360, height: 200 };
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

describe("placePopover", () => {
  it("centres the popover when there is no target", () => {
    expect(placePopover(null, popover, desktop)).toEqual({ top: 350, left: 540, side: "center" });
  });

  it("puts it to the right of a sidebar link, vertically centred on it", () => {
    const link = { top: 200, left: 18, width: 212, height: 44 };
    expect(placePopover(link, popover, desktop)).toEqual({ top: 122, left: 230 + GAP, side: "right" });
  });

  it("keeps it inside the viewport when the link is near the top", () => {
    const link = { top: 10, left: 18, width: 212, height: 44 };
    expect(placePopover(link, popover, desktop).top).toBe(MARGIN);
  });

  it("puts it above a mobile tab, clamped to the side margins", () => {
    const tab = { top: 780, left: 325, width: 65, height: 56 };
    expect(placePopover(tab, { width: 358, height: 200 }, phone)).toEqual({ top: 780 - GAP - 200, left: MARGIN, side: "top" });
  });

  it("falls back below a target with no room above or to the right", () => {
    const button = { top: 8, left: 330, width: 44, height: 44 };
    expect(placePopover(button, { width: 358, height: 200 }, phone)).toEqual({ top: 52 + GAP, left: MARGIN, side: "bottom" });
  });
});

describe("tour content", () => {
  it("opens and closes on centred / « Guide » steps and visits every main tab", () => {
    expect(TOUR_STEPS[0]!.target).toBeNull();
    expect(TOUR_STEPS.at(-1)!.target).toBe("guide");
    for (const href of ["/", "/budget", "/credits", "/plan", "/suivi", "/simuler"]) {
      expect(TOUR_STEPS.some((s) => s.target === `nav:${href}`)).toBe(true);
    }
  });

  it("remembers the tour per user", () => {
    expect(tourStorageKey("a@example.test")).not.toBe(tourStorageKey("b@example.test"));
  });
});
