import type { Metadata } from "next";
import { AdminView } from "./admin-view";

export const metadata: Metadata = { title: "Administration · Boussole", robots: { index: false, follow: false } };

/** Back-office (#156): not in the menu, outside the app shell (no user finance data is loaded). */
export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 md:px-8">
      <AdminView />
    </main>
  );
}
