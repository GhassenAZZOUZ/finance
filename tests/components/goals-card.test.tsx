/**
 * GoalsCard (/budget, issues #10 and tech-debt 6): lists the goals by priority with their status,
 * adds a goal with field errors, reorders, edits every goal the same way, and deletes the primary
 * goal only after choosing the goal that replaces it.
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

// The primary goal has a real id; the engine's KPIs name it PRIMARY_GOAL_ID ("moving").
const GOALS: SavingsGoal[] = [
  { id: "goal-primary", name: "Déménagement", target: 400_000, deadlineMonth: "2027-06", alreadySaved: 50_000, priority: 1, primary: true },
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

  it("edits the primary goal's amounts like any goal (SPEC D23)", async () => {
    renderCard();
    expect((screen.getByRole("button", { name: "Monter « Déménagement »" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Modifier « Déménagement »" }));
    const form = screen.getByRole("form", { name: "Modifier « Déménagement »" });
    const target = within(form).getByLabelText("Montant visé (€)");
    await userEvent.clear(target);
    await userEvent.type(target, "4500");
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(mocks.repo!.updateGoal).toHaveBeenCalledWith("goal-primary", {
        name: "Déménagement",
        target: 450_000,
        deadlineMonth: "2027-06",
        alreadySaved: 50_000,
      }),
    );
  });

  it("deletes another goal directly", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Supprimer « Voiture »" }));
    await waitFor(() => expect(mocks.repo!.deleteGoal).toHaveBeenCalledWith("car", undefined));
    expect((await screen.findByRole("status")).textContent).toContain("« Voiture » a été supprimé.");
  });

  it("deletes the primary goal only once its successor is chosen", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Supprimer « Déménagement »" }));
    expect(mocks.repo!.deleteGoal).not.toHaveBeenCalled();
    const group = screen.getByRole("group", { name: "Supprimer l’objectif principal « Déménagement »" });
    expect((within(group).getByLabelText("Nouvel objectif principal") as HTMLSelectElement).value).toBe("car");

    await userEvent.click(within(group).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("group", { name: "Supprimer l’objectif principal « Déménagement »" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Supprimer « Déménagement »" }));
    await userEvent.click(within(screen.getByRole("group", { name: /Supprimer l’objectif principal/ })).getByRole("button", { name: "Supprimer « Déménagement »" }));
    await waitFor(() => expect(mocks.repo!.deleteGoal).toHaveBeenCalledWith("goal-primary", "car"));
    expect((await screen.findByRole("status")).textContent).toContain("« Voiture » devient l’objectif principal.");
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
    await waitFor(() => expect(mocks.repo!.orderGoals).toHaveBeenLastCalledWith(["car", "goal-primary"]));
    expect(mocks.notify).toHaveBeenCalled();
  });
});
