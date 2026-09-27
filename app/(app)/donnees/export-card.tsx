"use client";

import { Download, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRepository } from "@/lib/data/client-store";
import { computePlan } from "@/lib/domain/plan";
import { backupFileName, buildBackup, serializeBackup } from "@/lib/export/backup";
import { type CsvFormat, planCsvFileName, planToCsv } from "@/lib/export/csv";
import { downloadFile } from "@/lib/export/download";

type Busy = "json" | "csv" | null;

const LOAD_ERROR = "Impossible de charger vos données : aucun fichier n’a été téléchargé. Vérifiez votre connexion et réessayez.";

/**
 * Downloads (issue #7): a JSON backup of every input and the 300-month plan as CSV. Both reload
 * the data through the repository first, so the file reflects what is saved (RLS applies) and a
 * failed load downloads nothing.
 */
export function ExportCard() {
  const [format, setFormat] = useState<CsvFormat>("fr");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(kind: Exclude<Busy, null>) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      let snapshot;
      try {
        snapshot = await getRepository().load();
      } catch {
        setError(LOAD_ERROR);
        return;
      }
      const now = new Date();
      if (kind === "json") {
        downloadFile(backupFileName(now), serializeBackup(buildBackup(snapshot, now)), "application/json");
        setNotice("Sauvegarde téléchargée.");
        return;
      }
      const plan = computePlan(snapshot);
      if (!plan) {
        setError("Enregistrez d’abord votre budget : le plan n’est pas encore calculé.");
        return;
      }
      downloadFile(planCsvFileName(now), planToCsv(plan.result, format), "text/csv;charset=utf-8");
      setNotice(`Plan téléchargé (${plan.result.months.length} mois).`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h2>Exporter</h2>
        </CardTitle>
        <CardDescription>Les fichiers sont créés dans votre navigateur : rien n’est stocké sur un serveur.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm">
        <section aria-labelledby="export-json-title" className="flex flex-col gap-2">
          <h3 id="export-json-title" className="font-medium">
            Sauvegarde complète
          </h3>
          <p className="text-muted-foreground">
            Budget, crédits (archivés compris), mois exceptionnels et saisies de suivi, au format JSON. Gardez-la en lieu sûr.
          </p>
          <div>
            <Button type="button" className="min-h-11 md:min-h-9" disabled={busy !== null} onClick={() => void run("json")}>
              <Download aria-hidden className="size-4" />
              {busy === "json" ? "Préparation…" : "Exporter mes données (JSON)"}
            </Button>
          </div>
        </section>

        <section aria-labelledby="export-csv-title" className="flex flex-col gap-3">
          <h3 id="export-csv-title" className="font-medium">
            Plan mois par mois
          </h3>
          <p className="text-muted-foreground">Les 300 mois du plan, à ouvrir dans un tableur.</p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">Format des nombres</legend>
            <FormatOption value="fr" current={format} onChange={setFormat}>
              Français : 1234,56 et « ; » (Excel en français)
            </FormatOption>
            <FormatOption value="intl" current={format} onChange={setFormat}>
              International : 1234.56 et « , »
            </FormatOption>
          </fieldset>
          <div>
            <Button type="button" variant="outline" className="min-h-11 md:min-h-9" disabled={busy !== null} onClick={() => void run("csv")}>
              <Download aria-hidden className="size-4" />
              {busy === "csv" ? "Préparation…" : "Exporter le plan (CSV)"}
            </Button>
          </div>
        </section>

        <div aria-live="polite" className="empty:hidden">
          {notice ? (
            <p role="status" className="rounded-md border border-good-border bg-good-bg px-3 py-2 font-medium text-good">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="flex items-center gap-2 rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-bad">
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FormatOption({
  value,
  current,
  onChange,
  children,
}: {
  value: CsvFormat;
  current: CsvFormat;
  onChange: (v: CsvFormat) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 md:min-h-8">
      <input
        type="radio"
        name="csv-format"
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        className="size-4 accent-primary"
      />
      {children}
    </label>
  );
}
