"use server";

import { refresh } from "next/cache";
import { RepositoryError } from "@/lib/data/repository";
import { getRepository } from "@/lib/data/session";
import { type Errors, type LoanForm, validateLoan } from "@/lib/domain/validation";
import { EMPTY_LOAN_FORM, loanDisplayName, readLoanForm, readLoanId } from "./loan-view";

export type LoanFormState =
  | { status: "idle"; values: LoanForm }
  | { status: "error"; errors: Errors; values: LoanForm }
  | { status: "success"; message: string; values: LoanForm };

export type DeleteLoanState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

const NOT_FOUND = "Crédit introuvable : il a peut-être déjà été supprimé. Rechargez la page.";
const SAVE_FAILED = "L’enregistrement a échoué. Réessayez dans un instant.";

/** Creates a loan, or updates it when the hidden `id` field is set. */
export async function saveLoan(_prev: LoanFormState, formData: FormData): Promise<LoanFormState> {
  const values = readLoanForm(formData);
  const id = readLoanId(formData);
  try {
    const repo = await getRepository();
    const { loans } = await repo.load();
    if (id && !loans.some((l) => l.id === id)) {
      return { status: "error", errors: { form: NOT_FOUND }, values };
    }
    const validated = validateLoan(values, loans.filter((l) => l.id !== id).length);
    if (!validated.ok) return { status: "error", errors: validated.errors, values };

    if (id) await repo.updateLoan(id, validated.value);
    else await repo.createLoan(validated.value);
    refresh();
    const index = id ? loans.findIndex((l) => l.id === id) : loans.length;
    const name = loanDisplayName(validated.value, index);
    return {
      status: "success",
      message: id ? `« ${name} » a été modifié.` : `« ${name} » a été ajouté.`,
      values: EMPTY_LOAN_FORM,
    };
  } catch (error) {
    const notFound = error instanceof RepositoryError && error.code === "not_found";
    return { status: "error", errors: { form: notFound ? NOT_FOUND : SAVE_FAILED }, values };
  }
}

/** Deletes the loan, or archives it when monthly check-ins reference it (SPEC D8). */
export async function deleteLoan(_prev: DeleteLoanState, formData: FormData): Promise<DeleteLoanState> {
  const id = readLoanId(formData);
  if (!id) return { status: "error", message: NOT_FOUND };
  try {
    const repo = await getRepository();
    const { loans } = await repo.load();
    const index = loans.findIndex((l) => l.id === id);
    const loan = loans[index];
    if (!loan) return { status: "error", message: NOT_FOUND };
    const name = loanDisplayName(loan, index);
    const outcome = await repo.removeLoan(id);
    refresh();
    return {
      status: "success",
      message:
        outcome === "deleted"
          ? `« ${name} » a été supprimé.`
          : `« ${name} » a été archivé (il a un historique de suivi).`,
    };
  } catch {
    return { status: "error", message: "La suppression a échoué. Réessayez dans un instant." };
  }
}
