import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** First-login empty state: fill the Budget, then the Crédits (brief "onboarding"). */
export function Onboarding({ hasBudget, loanCount }: { hasBudget: boolean; loanCount: number }) {
  const steps = [
    {
      href: "/budget",
      title: "1. Renseignez votre budget",
      text: "Revenus, charges fixes, dépenses variables et paramètres du plan (date de début, objectifs).",
      done: hasBudget,
    },
    {
      href: "/credits",
      title: "2. Ajoutez vos crédits",
      text: "Capital restant dû, TAEG et mensualité de chaque crédit (6 au maximum). Facultatif si vous n’en avez pas.",
      done: loanCount > 0,
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bienvenue !</CardTitle>
        <CardDescription>Deux étapes pour obtenir votre plan mois par mois.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="block rounded-lg border p-4 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  {s.title}
                  {s.done ? <span className="text-sm text-good">✓ Fait</span> : null}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{s.text}</span>
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
