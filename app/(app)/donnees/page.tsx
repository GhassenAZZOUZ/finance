import { FileSpreadsheet } from "lucide-react";
import type { Metadata } from "next";
import { ArrowLink } from "@/components/app/nav";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteAccountCard } from "./delete-account-card";
import { ExportCard } from "./export-card";
import { ReminderCard } from "./reminder-card";

export const metadata: Metadata = { title: "Mes données · Boussole" };

/** Static shell; the export reads the user's data in the browser. */
export default function Page() {
  return (
    <>
      <PageHeader title="Mes données" description="Téléchargez une sauvegarde de vos saisies ou le plan calculé, importez votre classeur, ou supprimez votre compte." />
      <ReminderCard />
      <ExportCard />
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet aria-hidden className="size-5 shrink-0" />
            <h2>Importer</h2>
          </CardTitle>
          <CardDescription>Reprenez le budget, les paramètres et les crédits du classeur Excel « plan_financier ».</CardDescription>
        </CardHeader>
        <CardContent>
          <ArrowLink href="/import">Importer le classeur</ArrowLink>
        </CardContent>
      </Card>
      <DeleteAccountCard />
    </>
  );
}
