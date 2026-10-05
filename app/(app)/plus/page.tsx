import type { Metadata } from "next";
import { PlusView } from "./view";

export const metadata: Metadata = { title: "Plus · Boussole" };

/** Static shell; the account comes from the browser session (FinanceProvider). */
export default function Page() {
  return <PlusView />;
}
