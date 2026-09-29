/** Error reporting (tech-debt 1b): context label, pluggable reporters, French messages by code. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepositoryError } from "@/lib/data/repository";
import { NETWORK_MESSAGE, addErrorReporter, errorMessage, reportError } from "@/lib/errors";

const FALLBACK = "Enregistrement impossible pour le moment. Réessayez.";

afterEach(() => vi.restoreAllMocks());

describe("reportError", () => {
  it("logs the error with its context label", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    reportError(error, "budget.save");
    expect(log).toHaveBeenCalledWith("[budget.save]", error);
  });

  it("forwards to plugged reporters until they are unplugged", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reporter = vi.fn();
    const unplug = addErrorReporter(reporter);
    const error = new Error("boom");
    reportError(error, "goals.add");
    expect(reporter).toHaveBeenCalledWith(error, "goals.add");
    unplug();
    reportError(error, "goals.add");
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it("survives a reporter that throws", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const unplug = addErrorReporter(() => {
      throw new Error("reporter down");
    });
    expect(() => reportError(new Error("boom"), "suivi.rebase")).not.toThrow();
    expect(log).toHaveBeenCalledWith("[errors.reporter]", expect.any(Error));
    unplug();
  });
});

describe("errorMessage", () => {
  it.each([
    ["not_found", "Élément introuvable : il a peut-être déjà été supprimé. Rechargez la page."],
    ["forbidden", "Cette action n’est pas autorisée."],
    ["42501", "Accès refusé : reconnectez-vous puis réessayez."],
    ["PGRST301", "Session expirée : reconnectez-vous."],
    ["PGRST303", "Session expirée : reconnectez-vous."],
    ["23505", "Cette donnée existe déjà. Rechargez la page."],
    ["23503", "Une donnée liée est introuvable. Rechargez la page."],
    ["23514", "Valeur refusée par la base de données. Vérifiez les montants saisis."],
    ["23502", "Valeur manquante refusée par la base de données. Vérifiez le formulaire."],
    ["22P02", "Valeur refusée par la base de données. Vérifiez le formulaire."],
    ["22003", "Montant trop grand pour être enregistré."],
    ["22023", "Formulaire invalide. Rechargez la page."],
    ["P0002", "Élément introuvable : il a peut-être déjà été supprimé. Rechargez la page."],
    ["P0003", "Il faut un objectif principal : choisissez celui qui remplace l’actuel."],
  ])("maps the %s code to a specific message", (code, message) => {
    expect(errorMessage(new RepositoryError("db", code), FALLBACK)).toBe(message);
  });

  it("prefers the caller's message for a code", () => {
    const error = new RepositoryError("Crédit introuvable", "not_found");
    expect(errorMessage(error, FALLBACK, { not_found: "Crédit introuvable : rechargez la page." })).toBe(
      "Crédit introuvable : rechargez la page.",
    );
  });

  it("recognises a network failure, thrown or wrapped by supabase-js", () => {
    expect(errorMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(NETWORK_MESSAGE);
    expect(errorMessage(new RepositoryError("TypeError: Failed to fetch", ""), FALLBACK)).toBe(NETWORK_MESSAGE);
    expect(errorMessage(new RepositoryError("TypeError: Load failed"), FALLBACK)).toBe(NETWORK_MESSAGE);
  });

  it("keeps the generic message for unknown errors", () => {
    expect(errorMessage(new RepositoryError("db", "XX000"), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(new RepositoryError("Réponse vide de la base de données"), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(new Error("boom"), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage("boom", FALLBACK)).toBe(FALLBACK);
  });
});
