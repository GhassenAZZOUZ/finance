/**
 * ExportCard (/donnees, issue #7): reloads the data, then downloads the JSON backup or the plan
 * CSV in the chosen format; a failed load shows an error and downloads nothing.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportCard } from "@/app/(app)/donnees/export-card";
import { type RepositoryMock, createRepositoryMock, makeLoan, makeSettings, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, download: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo }));
vi.mock("@/lib/export/download", () => ({ downloadFile: mocks.download }));

beforeEach(() => {
  mocks.repo = createRepositoryMock(makeSnapshot({ settings: makeSettings(), loans: [makeLoan(1)] }));
  mocks.download.mockReset();
});
afterEach(cleanup);

describe("ExportCard", () => {
  it("downloads the versioned JSON backup", async () => {
    render(<ExportCard />);
    await userEvent.click(screen.getByRole("button", { name: "Exporter mes données (JSON)" }));
    expect(mocks.download).toHaveBeenCalledOnce();
    const [name, content, type] = mocks.download.mock.calls[0]!;
    expect(name).toMatch(/^finance-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(type).toBe("application/json");
    expect(JSON.parse(content)).toMatchObject({ version: 1, data: { loans: [{ id: "loan-1" }] } });
    expect(screen.getByRole("status").textContent).toContain("Sauvegarde téléchargée.");
  });

  it("downloads the plan CSV in the French format by default, international on request", async () => {
    render(<ExportCard />);
    await userEvent.click(screen.getByRole("button", { name: "Exporter le plan (CSV)" }));
    expect(mocks.download.mock.calls[0]![0]).toMatch(/^finance-plan-.*\.csv$/);
    expect(mocks.download.mock.calls[0]![1]).toMatch(/^﻿Mois;N°;/);

    await userEvent.click(screen.getByRole("radio", { name: /International/ }));
    await userEvent.click(screen.getByRole("button", { name: "Exporter le plan (CSV)" }));
    expect(mocks.download.mock.calls[1]![1]).toMatch(/^﻿Mois,N°,/);
    expect(screen.getByRole("status").textContent).toContain("300 mois");
  });

  it("shows an error and downloads nothing when loading fails", async () => {
    mocks.repo!.load.mockRejectedValueOnce(new Error("offline"));
    render(<ExportCard />);
    await userEvent.click(screen.getByRole("button", { name: "Exporter mes données (JSON)" }));
    expect(screen.getByRole("alert").textContent).toContain("aucun fichier n’a été téléchargé");
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("explains that the CSV needs a saved budget", async () => {
    mocks.repo = createRepositoryMock(makeSnapshot());
    render(<ExportCard />);
    await userEvent.click(screen.getByRole("button", { name: "Exporter le plan (CSV)" }));
    expect(screen.getByRole("alert").textContent).toContain("Enregistrez d’abord votre budget");
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
