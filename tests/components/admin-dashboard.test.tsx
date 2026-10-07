/** Admin dashboard (issue #160, US-17). Invented data only. */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardSection } from "@/app/admin/dashboard-section";
import type { DashboardFigures } from "@/lib/admin/client";

const mocks = vi.hoisted(() => ({ callAdmin: vi.fn() }));
vi.mock("@/lib/admin/client", async (original) => ({ ...(await original<typeof import("@/lib/admin/client")>()), callAdmin: mocks.callAdmin }));

const FIGURES: DashboardFigures = {
  users: 10,
  activeLast30Days: 6,
  paying: 3,
  trials: 2,
  offered: 1,
  inGrace: 2,
  mrrCents: 1149,
  current: { month: "2027-03", signups: 4, newSubscriptions: 1, cancellations: 0 },
  previous: { month: "2027-02", signups: 3, newSubscriptions: 2, cancellations: 1 },
};

const onShowList = vi.fn();
beforeEach(() => {
  mocks.callAdmin.mockReset();
  onShowList.mockReset();
});
afterEach(cleanup);

const value = (label: string) => screen.getByText(label).nextElementSibling!.textContent;

describe("DashboardSection", () => {
  it("shows every figure with its French label, zeros as 0", async () => {
    mocks.callAdmin.mockResolvedValue({ ok: true, data: FIGURES });
    render(<DashboardSection onShowList={onShowList} />);
    await screen.findByText("Utilisateurs");
    expect(mocks.callAdmin).toHaveBeenCalledWith({ action: "dashboard" });
    expect(value("Utilisateurs")).toBe("10");
    expect(screen.getByText("dont 6 actifs sur 30 jours")).toBeTruthy();
    expect(value("Abonnés Pro (payants)")).toBe("3");
    expect(value("Essais en cours")).toBe("2");
    expect(value("Pro offerts")).toBe("1");
    expect(value("Revenu mensuel estimé")?.replace(/\s/g, " ")).toBe("11,49 €");
    const current = within(screen.getByRole("heading", { name: /Ce mois-ci \(mars 2027\)/ }).parentElement!);
    expect(current.getByText("Inscriptions").nextElementSibling!.textContent).toBe("4");
    expect(current.getByText("Résiliations (fin d’accès)").nextElementSibling!.textContent).toBe("0");
    const previous = within(screen.getByRole("heading", { name: /Mois précédent \(février 2027\)/ }).parentElement!);
    expect(previous.getByText("Résiliations (fin d’accès)").nextElementSibling!.textContent).toBe("1");
  });

  it("opens the list filtered on the grace-period accounts", async () => {
    mocks.callAdmin.mockResolvedValue({ ok: true, data: FIGURES });
    const user = userEvent.setup({ delay: null });
    render(<DashboardSection onShowList={onShowList} />);
    await user.click(await screen.findByRole("button", { name: "Voir ces comptes" }));
    expect(onShowList).toHaveBeenCalledWith("Pro payant", "past_due");
  });

  it("shows a French error with a retry, and no figures", async () => {
    mocks.callAdmin.mockResolvedValueOnce({ ok: false, status: 500, error: "failed" }).mockResolvedValueOnce({ ok: true, data: FIGURES });
    const user = userEvent.setup({ delay: null });
    render(<DashboardSection onShowList={onShowList} />);
    expect((await screen.findByRole("alert")).textContent).toContain("L’action a échoué. Réessayez dans un instant.");
    expect(screen.queryByText("Utilisateurs")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Utilisateurs")).toBeTruthy();
  });
});
