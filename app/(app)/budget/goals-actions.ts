/**
 * Savings goals actions (SPEC D23), run in the browser: validate, write through the repository,
 * keep the priorities 1..n contiguous, then reload the data.
 */
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import { RepositoryError } from "@/lib/data/repository";
import { MAX_GOALS, type SavingsGoal } from "@/lib/domain/types";
import { type Errors, type GoalForm, validateGoal } from "@/lib/domain/validation";
import type { YearMonth } from "@/lib/engine";

export type GoalActionResult = { ok: true; message: string } | { ok: false; errors: Errors };

const FAILED = "L’enregistrement a échoué. Réessayez dans un instant.";
const failure = (error: unknown): GoalActionResult => ({
  ok: false,
  errors: {
    form: error instanceof RepositoryError && error.code === "not_found" ? "Objectif introuvable : rechargez la page." : FAILED,
  },
});

/** Priority order as the engine uses it. */
export function byPriority(goals: readonly SavingsGoal[]): SavingsGoal[] {
  return [...goals].sort((a, b) => a.priority - b.priority || Number(b.primary) - Number(a.primary));
}

export async function addGoal(form: GoalForm, goals: readonly SavingsGoal[], currentMonth: YearMonth): Promise<GoalActionResult> {
  if (goals.length >= MAX_GOALS) return { ok: false, errors: { form: `${MAX_GOALS} objectifs maximum` } };
  const valid = validateGoal(form, { currentMonth });
  if (!valid.ok) return valid;
  try {
    const repo = getRepository();
    await repo.createGoal(valid.value, goals.length + 1);
    // Close any gap left by an earlier failure, the new goal last.
    const created = (await repo.load()).goals;
    await repo.orderGoals(byPriority(created).map((g) => g.id));
    notifyDataChanged();
    return { ok: true, message: `« ${valid.value.name} » a été ajouté.` };
  } catch (error) {
    return failure(error);
  }
}

/** The primary goal is only renamed here: its amounts are edited with the budget (① group). */
export async function updateGoal(goal: SavingsGoal, form: GoalForm, currentMonth: YearMonth): Promise<GoalActionResult> {
  let valid = validateGoal(form, { currentMonth, primary: goal.primary });
  if (goal.primary) {
    // Only the name comes from this form; the amounts stay those of the budget.
    const nameError = valid.ok ? undefined : valid.errors.name;
    if (nameError) return { ok: false, errors: { name: nameError } };
    const { target, deadlineMonth, alreadySaved } = goal;
    valid = { ok: true, value: { name: form.name.trim(), target, deadlineMonth, alreadySaved } };
  }
  if (!valid.ok) return valid;
  try {
    await getRepository().updateGoal(goal.id, valid.value);
    notifyDataChanged();
    return { ok: true, message: `« ${valid.value.name} » a été modifié.` };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteGoal(goal: SavingsGoal, goals: readonly SavingsGoal[]): Promise<GoalActionResult> {
  if (goal.primary) return { ok: false, errors: { form: "L’objectif principal ne peut pas être supprimé." } };
  try {
    const repo = getRepository();
    await repo.deleteGoal(goal.id);
    await repo.orderGoals(byPriority(goals).filter((g) => g.id !== goal.id).map((g) => g.id));
    notifyDataChanged();
    return { ok: true, message: `« ${goal.name} » a été supprimé.` };
  } catch (error) {
    return failure(error);
  }
}

/** Moves a goal one step up (-1) or down (+1) in the priority order. */
export async function moveGoal(goal: SavingsGoal, goals: readonly SavingsGoal[], step: -1 | 1): Promise<GoalActionResult> {
  const order = byPriority(goals);
  const from = order.findIndex((g) => g.id === goal.id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= order.length) return { ok: false, errors: { form: "Déplacement impossible." } };
  [order[from], order[to]] = [order[to]!, order[from]!];
  try {
    await getRepository().orderGoals(order.map((g) => g.id));
    notifyDataChanged();
    return { ok: true, message: `« ${goal.name} » est maintenant en position ${to + 1}.` };
  } catch (error) {
    return failure(error);
  }
}
