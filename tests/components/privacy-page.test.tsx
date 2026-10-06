/** Privacy policy (issue #84): public page required by the Google Play listing. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyPage from "@/app/confidentialite/page";

afterEach(cleanup);

describe("PrivacyPage", () => {
  it("states what is kept, where, the Android specifics and the user's rights", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Politique de confidentialité" })).toBeTruthy();
    for (const title of ["Qui traite vos données", "Ce qui est enregistré", "Où et comment", "Dans l’application Android", "Vos droits"]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeTruthy();
    }
    expect(screen.getByText(/ni vendues, ni partagées/)).toBeTruthy();
    expect(screen.getByText(/ne sont\s+jamais envoyées/)).toBeTruthy();
    expect(screen.getByText(/Supprimer mon compte/)).toBeTruthy();
  });
});
