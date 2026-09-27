import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ExportCard } from "./export-card";

export const metadata: Metadata = { title: "Mes données · Plan financier" };

/** Static shell; the export reads the user's data in the browser. */
export default function Page() {
  return (
    <>
      <PageHeader title="Mes données" description="Téléchargez une sauvegarde de vos saisies ou le plan calculé." />
      <ExportCard />
    </>
  );
}
