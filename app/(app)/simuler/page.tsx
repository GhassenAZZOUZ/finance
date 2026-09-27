import type { Metadata } from "next";
import { SimulerView } from "./view";

export const metadata: Metadata = { title: "Et si… ? · Plan financier" };

/** Static shell; the user's data is loaded in the browser (FinanceProvider). */
export default function Page() {
  return <SimulerView />;
}
