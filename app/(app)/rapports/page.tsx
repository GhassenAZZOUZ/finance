import type { Metadata } from "next";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = { title: "Rapports · Boussole" };

/** Static shell; the reports are computed in the browser from the user's check-ins (#145). */
export default function Page() {
  return <ReportsView />;
}
