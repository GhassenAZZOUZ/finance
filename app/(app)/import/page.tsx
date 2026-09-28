import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ImportView } from "./import-view";

export const metadata: Metadata = { title: "Importer le classeur · Plan financier" };

/** Static shell; the file is read in the browser. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Importer le classeur"
        description="Reprenez votre budget, vos paramètres et vos crédits depuis le classeur Excel « plan_financier »."
      />
      <ImportView />
    </>
  );
}
