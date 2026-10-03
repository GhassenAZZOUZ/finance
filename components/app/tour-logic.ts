/** Guided tour (« Guide »): steps and popover placement, kept free of React for the unit tests. */

export interface TourStep {
  /** `data-tour` token of the element to highlight; null for a centred step. */
  target: string | null;
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: null,
    title: "Bienvenue dans Cap",
    body: "Ce court guide vous présente les rubriques de l’application. Une minute suffit, et vous pourrez le revoir à tout moment.",
  },
  {
    target: "nav:/budget",
    title: "1. Le budget",
    body: "Commencez ici : revenus, charges, dépenses variables et paramètres du plan (date de début, objectifs). Tout le reste en découle.",
  },
  {
    target: "nav:/credits",
    title: "2. Les crédits",
    body: "Ajoutez vos crédits en cours. L’application choisit l’ordre de remboursement anticipé : le TAEG le plus élevé d’abord.",
  },
  {
    target: "nav:/",
    title: "Le tableau de bord",
    body: "La vue d’ensemble : où en est votre plan, vos objectifs et ce qu’il reste à faire.",
  },
  {
    target: "nav:/plan",
    title: "Le plan mois par mois",
    body: "Chaque mois, le disponible remplit vos objectifs dans l’ordre, puis se partage entre remboursement anticipé et épargne.",
  },
  {
    target: "nav:/suivi",
    title: "Le suivi",
    body: "En fin de mois, reportez vos soldes réels. Le badge compte les mois à saisir, et l’écart avec le plan s’affiche pendant la saisie.",
  },
  {
    target: "nav:/simuler",
    title: "Et si… ?",
    body: "Testez un changement (revenu, dépense, remboursement) et comparez-le à votre plan. Rien n’est enregistré.",
  },
  {
    target: "donnees",
    title: "Mes données",
    body: "Téléchargez une sauvegarde de vos saisies, exportez le plan calculé ou importez votre classeur Excel.",
  },
  {
    target: "guide",
    title: "À vous de jouer",
    body: "Relancez ce guide à tout moment avec « Guide de l’application » (dans le menu du compte sur mobile). Pour bien démarrer, renseignez d’abord votre budget.",
  },
];

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Side = "right" | "top" | "bottom" | "center";

/** Space kept between the highlighted element and the popover, and from the viewport edges. */
export const GAP = 14;
export const MARGIN = 16;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Where the popover goes: to the right of the target when it fits (desktop sidebar), otherwise
 * above it (mobile tab bar), otherwise below; centred when there is no target. Always inside the
 * viewport margins.
 */
export function placePopover(
  target: Box | null,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; side: Side } {
  const { width: w, height: h } = popover;
  const maxLeft = viewport.width - w - MARGIN;
  const maxTop = viewport.height - h - MARGIN;
  if (!target) {
    return { top: clamp((viewport.height - h) / 2, MARGIN, maxTop), left: clamp((viewport.width - w) / 2, MARGIN, maxLeft), side: "center" };
  }
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  if (viewport.width - right - GAP - MARGIN >= w) {
    return { top: clamp(target.top + target.height / 2 - h / 2, MARGIN, maxTop), left: right + GAP, side: "right" };
  }
  const left = clamp(target.left + target.width / 2 - w / 2, MARGIN, maxLeft);
  if (target.top - GAP - MARGIN >= h) return { top: target.top - GAP - h, left, side: "top" };
  return { top: clamp(bottom + GAP, MARGIN, maxTop), left, side: "bottom" };
}

/** Per-user "already seen" flag (kept in this browser). */
export function tourStorageKey(email: string | null): string {
  return `finance-tour-seen:${email ?? "anonymous"}`;
}
