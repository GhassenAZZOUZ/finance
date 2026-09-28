/** Guided tour: opens once per user, steps through the tabs, can be skipped and replayed. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOUR_STEPS, tourStorageKey } from "@/components/app/tour-logic";
import { TourButton, TourProvider } from "@/components/app/tour";

const EMAIL = "tour@example.test";
let finance: { email: string } | null = { email: EMAIL };
vi.mock("@/components/app/finance-provider", () => ({ useOptionalFinance: () => finance }));

beforeEach(() => {
  finance = { email: EMAIL };
  localStorage.clear();
});
afterEach(cleanup);

const renderTour = () =>
  render(
    <TourProvider>
      <a href="/budget" data-tour="nav:/budget">
        Budget
      </a>
      <TourButton />
    </TourProvider>,
  );
const dialog = () => screen.queryByRole("dialog");

describe("TourProvider", () => {
  it("opens by itself on a user's first visit, focused on « Commencer »", () => {
    renderTour();
    expect(screen.getByRole("dialog", { name: TOUR_STEPS[0]!.title })).toBeTruthy();
    expect(screen.getByText(`Étape 1 sur ${TOUR_STEPS.length}`)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Commencer" }));
  });

  it("waits for the user's data before opening", () => {
    finance = null;
    renderTour();
    expect(dialog()).toBeNull();
  });

  it("does not open again once seen by this user", async () => {
    renderTour();
    await userEvent.click(screen.getByRole("button", { name: "Passer" }));
    expect(dialog()).toBeNull();
    expect(localStorage.getItem(tourStorageKey(EMAIL))).not.toBeNull();
    cleanup();
    renderTour();
    expect(dialog()).toBeNull();
  });

  it("steps forward and back, with the keyboard too", async () => {
    renderTour();
    await userEvent.click(screen.getByRole("button", { name: "Commencer" }));
    expect(screen.getByRole("dialog", { name: TOUR_STEPS[1]!.title })).toBeTruthy();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: TOUR_STEPS[2]!.title })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Précédent" }));
    expect(screen.getByRole("dialog", { name: TOUR_STEPS[1]!.title })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(dialog()).toBeNull();
  });

  it("ends with « Terminer » on the last step", async () => {
    renderTour();
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog", { name: TOUR_STEPS.at(-1)!.title })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Passer" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Terminer" }));
    expect(dialog()).toBeNull();
  });

  it("is replayed from the « Guide » button", async () => {
    localStorage.setItem(tourStorageKey(EMAIL), "seen");
    renderTour();
    expect(dialog()).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Guide de l’application" }));
    expect(screen.getByRole("dialog", { name: TOUR_STEPS[0]!.title })).toBeTruthy();
  });
});
