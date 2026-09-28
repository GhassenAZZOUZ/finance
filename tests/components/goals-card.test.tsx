/**
 * GoalsCard (/budget, issue #10): lists the goals by priority with their status, adds a goal with
 * field errors, reorders, and never offers to delete the primary goal.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalsCard } from "@/app/(app)/budget/goals-card";
import type { SavingsGoal } from "@/lib/domain/types";
import type { GoalKpis } from "@/lib/engine";
import { type RepositoryMock, createRepositoryMock, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: mocks.notify }));

const GOALS: SavingsGoal[] = [
  { id: "moving", name: "Déménagement", target: 400_000, deadlineMonth: "2027-06", alreadySaved: 50_000, priority: 1, primary: true },
  { id: "car", name: "Voiture", target: 800_000, deadlineMonth: "2028-06", alreadySaved: 0, priority: 2, primary: false },
];
const KPIS: GoalKpis[] = [
  { id: "moving", name: "Déménagement", target: 400_000, deadlineMonth: "2027-06", monthlyNeeded: 0, deadlineBeforeStart: false, amountAtDeadline: 400_000, met: true, reachedMonth: "2027-03" },
  { id: "car", name: "Voiture", target: 800_000, deadlineMonth: "2028-06", monthlyNeeded: 0, deadlineBeforeStart: false, amountAtDeadline: 650_000, met: false, reachedMonth: null },
];

beforeEach(() => {
  mocks.repo = createRepositoryMock(makeSnapshot({ goals: GOALS }));
  mocks.notify.mockReset();
});
afterEach(cleanup);

const renderCard = () => render(<GoalsCard goals={GOALS} kpis={KPIS} hasSettings currentMonth="2026-09" />);

describe("GoalsCard", () => {
  it("lists goals by priority with their status (AC-07)", () => {
    renderCard();
    const items = within(screen.getByRole("group", { name: "Objectifs d’épargne" })).getAllByRole("listitem");
    expect(items.map((li) => within(li).getByRole("heading").textContent)).toEqual([
      "Priorité 1 : Déménagementprincipal",
      "Priorité 2 : Voiture",
    ]);
    expect(items[0]!.textContent).toContain("Atteint en mars 2027");
    expect(items[1]!.textContent).toMatch(/Hors délai : il manquera 1\s500,00\s€ fin juin 2028/);
  });

  it("offers no delete button for the primary goal", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: "Supprimer « Déménagement »" })).toBeNull();
    expect(screen.getByRole("button", { name: "Supprimer « Voiture »" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Monter « Déménagement »" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows field errors and saves nothing for an invalid goal (AC-06)", async () => {
    renderCard();
    const form = screen.getByRole("form", { name: "Ajouter un objectif" });
    await userEvent.type(within(form).getByLabelText("Nom de l’objectif"), "Vacances");
    await userEvent.type(within(form).getByLabelText("Montant visé (€)"), "0");
    await userEvent.type(within(form).getByLabelText("Date limite (AAAA-MM)"), "2020-01");
    await userEvent.click(within(form).getByRole("button", { name: "Ajouter l’objectif" }));
    expect(await within(form).findByText("L’objectif doit être supérieur à 0")).toBeTruthy();
    expect(within(form).getByText("La date limite est déjà passée")).toBeTruthy();
    expect(mocks.repo!.createGoal).not.toHaveBeenCalled();
  });

  it("adds a goal last (AC-02) and moves one up", async () => {
    renderCard();
    const form = screen.getByRole("form", { name: "Ajouter un objectif" });
    await userEvent.type(within(form).getByLabelText("Nom de l’objectif"), "Vacances");
    await userEvent.type(within(form).getByLabelText("Montant visé (€)"), "1500");
    await userEvent.type(within(form).getByLabelText("Date limite (AAAA-MM)"), "2027-08");
    await userEvent.click(within(form).getByRole("button", { name: "Ajouter l’objectif" }));
    await waitFor(() =>
      expect(mocks.repo!.createGoal).toHaveBeenCalledWith({ name: "Vacances", target: 150_000, deadlineMonth: "2027-08", alreadySaved: 0 }, 3),
    );
    expect((await screen.findByRole("status")).textContent).toContain("« Vacances » a été ajouté.");

    await userEvent.click(screen.getByRole("button", { name: "Monter « Voiture »" }));
    await waitFor(() => expect(mocks.repo!.orderGoals).toHaveBeenLastCalledWith(["car", "moving"]));
    expect(mocks.notify).toHaveBeenCalled();
  });
});
