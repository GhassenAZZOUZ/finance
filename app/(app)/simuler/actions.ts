/** « Appliquer au plan » (issue #98), run in the browser (static app): saves the simulated values in one transaction. */
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import { errorMessage, reportError } from "@/lib/errors";
import { type Scenario, type SimulationBase, appliedPlan } from "./logic";

export type ApplyResult = { ok: true } | { ok: false; message: string };

/**
 * Writes the simulated parameters and budget line amounts over the saved plan (`save_budget`: all or
 * nothing). The data reload that follows restarts the simulator from the new plan.
 */
export async function applySimulationAction(base: SimulationBase, scenario: Scenario): Promise<ApplyResult> {
  const { settings, lines } = appliedPlan(base, scenario);
  try {
    await getRepository().saveBudget(settings, lines);
  } catch (error) {
    reportError(error, "simuler.apply");
    return { ok: false, message: errorMessage(error, "Impossible d’appliquer la simulation pour le moment. Votre plan n’a pas changé.") };
  }
  notifyDataChanged();
  return { ok: true };
}
