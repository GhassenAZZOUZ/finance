/** Template import (issue #8): .xlsx reader, template parser and import plan. Anonymized template only. */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { planImport } from "@/lib/import/apply";
import { MAX_IMPORT_BYTES, type TemplateData, monthText, parseTemplate, readTemplateFile } from "@/lib/import/template";
import { type Sheet, decodeXml, openWorkbook, parseSheet } from "@/lib/import/xlsx";
import { makeLoan, makeSettings, makeSnapshot, primaryGoal } from "../components/helpers";

const TEMPLATE = readFileSync("docs/plan_financier.template.xlsx");
const asFile = (bytes: Uint8Array, name = "plan_financier.xlsx") => ({
  name,
  size: bytes.length,
  arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
});

let budget: Sheet;
let loans: Sheet;
beforeAll(async () => {
  const book = await openWorkbook(new Uint8Array(TEMPLATE));
  budget = (await book.sheet("Budget"))!;
  loans = (await book.sheet("Crédits"))!;
});

const withCells = (sheet: Sheet, cells: Record<string, string | number | undefined>): Sheet => {
  const copy = new Map(sheet);
  for (const [ref, v] of Object.entries(cells)) {
    if (v === undefined) copy.delete(ref);
    else copy.set(ref, v);
  }
  return copy;
};

describe("xlsx reader", () => {
  it("lists the template's sheets and reads cached formula values", async () => {
    const book = await openWorkbook(new Uint8Array(TEMPLATE));
    expect(book.sheetNames).toEqual(["Guide", "Synthèse", "Budget", "Crédits", "Suivi réel", "Plan", "Calcul"]);
    expect(budget.get("A4")).toBe("Salaire net (après impôt à la source)");
    expect(budget.get("B7")).toBe(2900); // =SUM(B4:B6)
    expect(await book.sheet("Absent")).toBeNull();
  });

  it("reads inline strings, booleans and entities; skips empty cells", () => {
    const xml = `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a &amp; b</t></is></c><c r="B1" t="b"><v>1</v></c><c r="C1" s="2"/><c r="D1" t="str"><v>x&lt;y</v></c></row></sheetData>`;
    expect([...parseSheet(xml, [])]).toEqual([
      ["A1", "a & b"],
      ["B1", true],
      ["D1", "x<y"],
    ]);
    expect(decodeXml("&#233;&#x20AC;")).toBe("é€");
  });

  it("rejects bytes that are not a zip", async () => {
    await expect(openWorkbook(new TextEncoder().encode("Mois;Revenus\n2027-01;100"))).rejects.toThrow("not a zip");
  });
});

describe("monthText", () => {
  it.each([
    [46388, "2027-01"],
    [46568, "2027-06"],
    ["2027-01", "2027-01"],
    ["2027-3-15", "2027-03"],
    ["15/01/2027", "2027-01"],
    ["01/2027", "2027-01"],
    ["janvier", "janvier"],
  ])("%j → %s", (v, ym) => expect(monthText(v)).toBe(ym));
});

describe("parseTemplate", () => {
  it("reads the parameters, the 15 budget lines and the 6 loans of the template", () => {
    const result = parseTemplate(budget, loans);
    if (!result.ok) throw new Error(JSON.stringify(result));
    const { settings, primaryGoal, lines, loans: drafts } = result.data;
    // The spreadsheet's moving fund is the primary savings goal (SPEC D23).
    expect(primaryGoal).toEqual({ target: 400000, deadlineMonth: "2027-06", alreadySaved: 50000 });
    expect(settings).toEqual({
      startMonth: "2027-01",
      emergencyTarget: 400000,
      emergencyExisting: 80000,
      riskFreeRate: 0.024,
      earlyRepaymentPct: 0.6,
    });
    expect(lines.filter((l) => l.category === "income").map((l) => [l.label, l.amount, l.position])).toEqual([
      ["Salaire net (après impôt à la source)", 280000, 0],
      ["Primes / 13e mois (lissés par mois)", 0, 1],
      ["Autres revenus", 10000, 2],
    ]);
    expect(lines.filter((l) => l.category === "fixed")).toHaveLength(8);
    expect(lines.filter((l) => l.category === "variable").map((l) => l.amount)).toEqual([35000, 15000, 10000, 5000]);
    expect(drafts.map((l) => [l.name, l.type, l.principal, l.apr, l.monthlyPayment, l.principalPaidThroughMonth])).toEqual([
      ["Prêt auto", "Prêt affecté", 820000, 0.049, 24530, null],
      ["Carte revolving", "Revolving", 185000, 0.189, 7240, null],
      ["Prêt travaux", "Prêt personnel", 340000, 0.0615, 11875, null],
      ["Prêt étudiant", "Prêt étudiant", 210000, 0.012, 9500, null],
      ["Dette perso A", "Dette personnelle", 60000, 0, 15000, null],
      ["Dette perso B", "Dette personnelle", 25000, 0, 5000, null],
    ]);
  });

  it("accepts French text numbers, blank amounts (0), empty loan rows and inserted rows", () => {
    const b = withCells(budget, { B10: "1 100,50", B16: undefined });
    const l = withCells(loans, { A7: undefined, B7: undefined, C7: undefined, D7: undefined, E7: undefined, D5: "4,9 %" });
    const result = parseTemplate(b, l);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.data.lines.find((x) => x.label === "Loyer")?.amount).toBe(110050);
    expect(result.data.lines.find((x) => x.label.startsWith("Impôts"))?.amount).toBe(0);
    expect(result.data.loans).toHaveLength(5);
    expect(result.data.loans[0]?.apr).toBe(0.049);
  });

  it("lists errors with sheet and cell, and imports nothing", () => {
    const b = withCells(budget, { B10: "abc", B28: "bientôt", B36: 1.5 });
    const l = withCells(loans, { D6: -0.1, E8: 0, A5: undefined });
    const result = parseTemplate(b, l);
    expect(result).toEqual({
      ok: false,
      kind: "cells",
      errors: expect.arrayContaining([
        { sheet: "Budget", cell: "B10", message: "Montant invalide" },
        { sheet: "Budget", cell: "B28", message: "Mois invalide (AAAA-MM)" },
        { sheet: "Budget", cell: "B36", message: "Le taux doit être inférieur ou égal à 100 %" },
        { sheet: "Crédits", cell: "D6", message: "Le taux ne peut pas être négatif" },
        { sheet: "Crédits", cell: "E8", message: "La mensualité doit être supérieure à 0" },
      ]),
    });
    if (!result.ok && result.kind === "cells") expect(result.errors).toHaveLength(5);
  });

  it("refuses a 7th loan", () => {
    const l = withCells(loans, { A11: "Prêt 7", C11: 100, D11: 0.01, E11: 10, A12: "TOTAL" });
    const result = parseTemplate(budget, l);
    expect(result).toMatchObject({ ok: false, kind: "cells", errors: [{ sheet: "Crédits", cell: "A11", message: "6 crédits maximum : ligne en trop" }] });
  });

  it("rejects a workbook without the template's sections", () => {
    expect(parseTemplate(new Map([["A1", "Mois"]]), loans)).toMatchObject({ ok: false, kind: "file" });
    expect(parseTemplate(budget, new Map())).toMatchObject({ ok: false, kind: "file" });
  });
});

describe("readTemplateFile", () => {
  it("parses the template file", async () => {
    expect(await readTemplateFile(asFile(new Uint8Array(TEMPLATE)))).toMatchObject({ ok: true });
  });

  it.each([
    ["a CSV", asFile(new TextEncoder().encode("a;b"), "plan.csv")],
    ["a PDF renamed .xlsx", asFile(new TextEncoder().encode("%PDF-1.7 ..."), "plan.xlsx")],
  ])("rejects %s with a French message", async (_, file) => {
    expect(await readTemplateFile(file)).toMatchObject({ ok: false, kind: "file", message: expect.stringContaining("modèle attendu") });
  });

  it("rejects a file over 5 MB before reading it", async () => {
    const read = vi.fn();
    const result = await readTemplateFile({ name: "plan.xlsx", size: MAX_IMPORT_BYTES + 1, arrayBuffer: read });
    expect(result).toEqual({ ok: false, kind: "file", message: "Fichier trop volumineux (5 Mo maximum)." });
    expect(read).not.toHaveBeenCalled();
  });
});

describe("planImport", () => {
  const data = (): TemplateData => {
    const r = parseTemplate(budget, loans);
    if (!r.ok) throw new Error("template");
    return r.data;
  };

  it("replaces a new user's defaults: line slots reused, all loans created", () => {
    const snapshot = makeSnapshot({
      lines: [
        { id: "i0", category: "income", label: "Salaire", amount: 0, position: 0, startMonth: null, endMonth: null },
        { id: "v0", category: "variable", label: "Courses", amount: 0, position: 0, startMonth: null, endMonth: null },
      ],
    });
    const plan = planImport(snapshot, data());
    expect(plan.settings.freeSavingsExisting).toBe(0);
    // No goal yet: the primary goal is created with the spreadsheet's name.
    expect(plan.primaryGoal).toEqual({ name: "Déménagement", target: 400000, deadlineMonth: "2027-06", alreadySaved: 50000 });
    expect(plan.lines.filter((l) => l.id).map((l) => [l.id, l.label])).toEqual([
      ["i0", "Salaire net (après impôt à la source)"],
      ["v0", "Courses"],
    ]);
    expect(plan.loanCreates).toHaveLength(6);
    expect(plan.loanUpdates).toEqual([]);
    expect(plan.loanRemovals).toEqual([]);
  });

  it("is idempotent: loans matched by name, others removed, free savings and contract end kept", () => {
    const snapshot = makeSnapshot({
      settings: makeSettings({ freeSavingsExisting: 12345 }),
      goals: [primaryGoal({ name: "Appartement" })],
      loans: [
        makeLoan(1, { name: "prêt AUTO ", contractEndMonth: "2030-01" }),
        makeLoan(2, { name: "Vieux prêt" }),
      ],
    });
    const plan = planImport(snapshot, data());
    expect(plan.settings.freeSavingsExisting).toBe(12345);
    expect(plan.primaryGoal).toMatchObject({ name: "Appartement", target: 400000 });
    expect(plan.loanUpdates).toEqual([{ id: "loan-1", draft: expect.objectContaining({ name: "Prêt auto", principal: 820000, contractEndMonth: "2030-01" }) }]);
    expect(plan.loanCreates.map((l) => l.name)).toEqual(["Carte revolving", "Prêt travaux", "Prêt étudiant", "Dette perso A", "Dette perso B"]);
    expect(plan.loanRemovals).toEqual(["loan-2"]);
  });
});
