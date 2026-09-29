/**
 * Savings goals actions (SPEC D23), run in the browser: validate, write through the repository,
 * keep the priorities 1..n contiguous, then reload the data. Every goal follows the same rules;
 * the primary one only needs a successor when it is deleted.
 */
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import { MAX_GOALS, type SavingsGoal } from "@/lib/domain/types";
import { type Errors, type GoalForm, validateGoal } from "@/lib/domain/validation";
import type { YearMonth } from "@/lib/engine";
import { errorMessage, reportError } from "@/lib/errors";

export type GoalActionResult = { ok: true; message: string } | { ok: false; errors: Errors };

const FAILED = "L’enregistrement a échoué. Réessayez dans un instant.";
function failure(error: unknown, context: string): GoalActionResult {
  reportError(error, context);
  return { ok: false, errors: { form: errorMessage(error, FAILED, { not_found: "Objectif introuvable : rechargez la page." }) } };
}

/** Priority order as the engine uses it. */
export function byPriority(goals: readonly SavingsGoal[]): SavingsGoal[] {
  return [...goals].sort((a, b) => a.priority - b.priority);
}

export async function addGoal(form: GoalForm, goals: readonly SavingsGoal[], currentMonth: YearMonth): Promise<GoalActionResult> {
  if (goals.length >= MAX_GOALS) return { ok: false, errors: { form: `${MAX_GOALS} objectifs maximum` } };
  // The first goal becomes the primary one, which may have no target yet.
  const valid = validateGoal(form, { currentMonth, primary: goals.length === 0 });
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
    return failure(error, "goals.add");
  }
}

export async function updateGoal(goal: SavingsGoal, form: GoalForm, currentMonth: YearMonth): Promise<GoalActionResult> {
  const valid = validateGoal(form, { currentMonth, primary: goal.primary, savedDeadline: goal.deadlineMonth });
  if (!valid.ok) return valid;
  try {
    await getRepository().updateGoal(goal.id, valid.value);
    notifyDataChanged();
    return { ok: true, message: `« ${valid.value.name} » a été modifié.` };
  } catch (error) {
    return failure(error, "goals.update");
  }
}

/**
 * Deletes a goal; the database closes the priority gap. The primary goal needs `newPrimary`, the
 * goal that replaces it, unless it is the last one (owner decision, SPEC D23).
 */
export async function deleteGoal(goal: SavingsGoal, goals: readonly SavingsGoal[], newPrimary?: SavingsGoal): Promise<GoalActionResult> {
  const others = goals.filter((g) => g.id !== goal.id);
  const successor = goal.primary && others.length > 0 ? others.find((g) => g.id === newPrimary?.id) : undefined;
  if (goal.primary && others.length > 0 && !successor) {
    return { ok: false, errors: { form: "Choisissez l’objectif qui devient l’objectif principal." } };
  }
  try {
    await getRepository().deleteGoal(goal.id, successor?.id);
    notifyDataChanged();
    const message = successor
      ? `« ${goal.name} » a été supprimé ; « ${successor.name} » devient l’objectif principal.`
      : `« ${goal.name} » a été supprimé.`;
    return { ok: true, message };
  } catch (error) {
    return failure(error, "goals.delete");
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
    return failure(error, "goals.move");
  }
}
