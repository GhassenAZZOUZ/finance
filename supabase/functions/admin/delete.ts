/**
 * Account deletion from the back-office (issue #159, US-16). Owner decisions 2026-10-07: the admin
 * types the account's e-mail (compared ignoring case and surrounding spaces), gives a mandatory
 * reference of the owner's request (recorded in the audit log), cannot delete their own account nor
 * another admin's (remove them from the admins first); the user receives a confirmation e-mail.
 * Pure (no imports): shared by the Edge Function (Deno) and the unit tests (Node).
 */

export interface DeleteRequest {
  userId: string;
  confirmEmail: string;
  requestRef: string;
}

export type DeleteRefusal = "self" | "target_admin" | "email_mismatch";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalize = (email: string) => email.trim().toLowerCase();

/** The request, or null when malformed (no target, no typed e-mail, reference empty or over 200). */
export function parseDeleteRequest(body: Record<string, unknown>): DeleteRequest | null {
  const userId = typeof body.userId === "string" && UUID.test(body.userId) ? body.userId : null;
  const confirmEmail = typeof body.confirmEmail === "string" ? normalize(body.confirmEmail) : "";
  const requestRef = typeof body.requestRef === "string" ? body.requestRef.trim() : "";
  if (!userId || confirmEmail === "" || requestRef === "" || requestRef.length > 200) return null;
  return { userId, confirmEmail, requestRef };
}

/** Why the deletion is refused, or null. Checked before anything is cancelled or deleted. */
export function deleteRefusal(callerId: string, request: DeleteRequest, targetEmail: string | null, adminIds: string[]): DeleteRefusal | null {
  if (request.userId === callerId) return "self";
  if (adminIds.includes(request.userId)) return "target_admin";
  if (!targetEmail || normalize(targetEmail) !== request.confirmEmail) return "email_mismatch";
  return null;
}

/** The e-mail telling the user their account and data are deleted. No link: the account is gone. */
export function deletionEmail(subscriptionCancelled: boolean): { subject: string; text: string; html: string } {
  const lines = [
    "Bonjour,",
    "Comme vous l’avez demandé, votre compte Boussole et toutes vos données (budget, crédits, objectifs, suivis) ont été supprimés définitivement.",
    ...(subscriptionCancelled ? ["Votre abonnement Pro a été résilié : aucun autre paiement ne vous sera demandé."] : []),
    "Vous pouvez créer un nouveau compte à tout moment avec la même adresse ; il partira de zéro.",
    "Si vous n’êtes pas à l’origine de cette demande, répondez à cet e-mail.",
  ];
  return {
    subject: "Votre compte Boussole a été supprimé",
    text: lines.join("\n\n"),
    html: lines.map((l) => `<p>${l}</p>`).join("\n"),
  };
}
