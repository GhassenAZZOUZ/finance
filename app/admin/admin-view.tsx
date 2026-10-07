"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACTION_LABELS, ADMIN_ERRORS, type AdminEntry, type AuditEntry, callAdmin } from "@/lib/admin/client";
import { isNativeApp } from "@/lib/native/platform";
import { supabaseBrowser } from "@/lib/supabase/client";

type Stage =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "verify"; factorId: string }
  | { kind: "ready"; email: string | null }
  | { kind: "error"; message: string };

const dateTime = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

/**
 * `/admin/` (issue #156, US-13): website only, not in the menu. The `admin` Edge Function decides
 * who gets in (session, admin list, TOTP second factor); this page follows its answer: sign-in,
 * « Accès refusé », TOTP setup or code, then the back-office.
 */
export function AdminView() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  const enter = useCallback(async () => {
    const auth = supabaseBrowser().auth;
    const { data } = await auth.getSession();
    if (!data.session) {
      router.replace("/login/");
      return;
    }
    const me = await callAdmin<{ admin: true; email: string | null }>({ action: "whoami" });
    if (me.ok) return setStage({ kind: "ready", email: me.data.email });
    if (me.status === 401) return router.replace("/login/");
    if (me.error === "forbidden") return setStage({ kind: "denied" });
    if (me.error !== "mfa_required") return setStage({ kind: "error", message: ADMIN_ERRORS[me.error] ?? ADMIN_ERRORS.failed! });
    // Second factor: the code of an authenticator app (TOTP), set up once.
    const factors = await auth.mfa.listFactors();
    const verified = factors.data?.totp.find((f) => f.status === "verified");
    if (verified) return setStage({ kind: "verify", factorId: verified.id });
    for (const f of factors.data?.all ?? []) if (f.factor_type === "totp" && f.status !== "verified") await auth.mfa.unenroll({ factorId: f.id });
    const enrolled = await auth.mfa.enroll({ factorType: "totp", friendlyName: "Boussole admin" });
    if (enrolled.error || !enrolled.data) return setStage({ kind: "error", message: "La double authentification n’a pas pu être préparée." });
    setStage({ kind: "enroll", factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
  }, [router]);

  useEffect(() => {
    if (isNativeApp()) return;
    const start = setTimeout(() => void enter(), 0);
    return () => clearTimeout(start);
  }, [enter]);

  if (isNativeApp()) {
    return <p className="text-sm text-muted-foreground">L’administration se fait depuis le site web de Boussole.</p>;
  }

  switch (stage.kind) {
    case "loading":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Vérification de vos droits…
        </p>
      );
    case "denied":
      return (
        <section role="alert" className="rounded-2xl border border-bad-border bg-bad-bg p-5 text-bad">
          <h1 className="text-xl font-semibold">Accès refusé</h1>
          <p className="mt-1 text-sm">Cette page est réservée aux administrateurs de Boussole.</p>
        </section>
      );
    case "error":
      return (
        <p role="alert" className="text-sm text-bad">
          {stage.message}
        </p>
      );
    case "enroll":
    case "verify":
      return <SecondFactor stage={stage} onDone={() => void enter()} />;
    case "ready":
      return <BackOffice email={stage.email} />;
  }
}

function SecondFactor({ stage, onDone }: { stage: Extract<Stage, { kind: "enroll" | "verify" }>; onDone: () => void }) {
  const id = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error: verifyError } = await supabaseBrowser().auth.mfa.challengeAndVerify({ factorId: stage.factorId, code });
    setPending(false);
    if (verifyError) {
      setCode("");
      return setError("Code incorrect ou expiré. Saisissez le code affiché maintenant dans l’application.");
    }
    onDone();
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex max-w-md flex-col gap-4">
      <h1 id={`${id}-title`} className="flex items-center gap-2 text-xl font-semibold">
        <ShieldCheck aria-hidden className="size-5" />
        Double authentification
      </h1>
      {stage.kind === "enroll" ? (
        <>
          <p className="text-sm text-muted-foreground">
            L’administration demande un code d’une application d’authentification (Google Authenticator, 1Password…). Scannez ce QR code
            avec l’application, puis saisissez le code à 6 chiffres qu’elle affiche.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from Supabase, not an asset */}
          <img src={stage.qr} alt="QR code à scanner avec l’application d’authentification" className="size-48 rounded-lg border bg-white p-2" />
          <p className="text-[13px] text-muted-foreground">
            Sans appareil photo, saisissez cette clé dans l’application : <code className="break-all font-mono">{stage.secret}</code>
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Saisissez le code à 6 chiffres affiché par votre application d’authentification.</p>
      )}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <label htmlFor={`${id}-code`} className="text-sm font-medium">
          Code de l’application
        </label>
        <input
          id={`${id}-code`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-12 w-40 rounded-[10px] border border-input bg-card px-3 text-center font-mono text-xl tracking-[0.3em]"
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="min-h-11 self-start" disabled={pending || code.length !== 6}>
          {pending ? "Vérification…" : "Valider"}
        </Button>
      </form>
    </section>
  );
}

function BackOffice({ email }: { email: string | null }) {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-[13px] tracking-[0.06em] text-muted-foreground uppercase">Boussole · administration</p>
        <h1 className="font-heading text-[32px] leading-tight font-medium">Back-office</h1>
        <p className="text-sm text-muted-foreground">Connecté en tant que {email}. Aucune donnée financière des utilisateurs n’est accessible ici.</p>
      </header>
      <Admins />
      <AuditLog />
    </div>
  );
}

function Admins() {
  const id = useId();
  const [admins, setAdmins] = useState<AdminEntry[] | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callAdmin<{ admins: AdminEntry[] }>({ action: "admins.list" });
    if (result.ok) setAdmins(result.data.admins);
    else setMessage({ text: ADMIN_ERRORS[result.error] ?? ADMIN_ERRORS.failed!, error: true });
  }, []);

  useEffect(() => {
    const start = setTimeout(() => void load(), 0);
    return () => clearTimeout(start);
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const result = await callAdmin({ action: "admins.add", email });
    if (!result.ok) return setMessage({ text: ADMIN_ERRORS[result.error] ?? ADMIN_ERRORS.failed!, error: true });
    setMessage({ text: `${email.trim()} est maintenant administrateur.`, error: false });
    setEmail("");
    void load();
  }

  async function remove(userId: string) {
    setConfirming(null);
    const result = await callAdmin({ action: "admins.remove", userId });
    if (!result.ok) return setMessage({ text: ADMIN_ERRORS[result.error] ?? ADMIN_ERRORS.failed!, error: true });
    setMessage({ text: "Administrateur retiré.", error: false });
    void load();
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex max-w-3xl flex-col gap-3">
      <h2 id={`${id}-title`} className="text-[17px] font-semibold">
        Administrateurs
      </h2>
      {message ? (
        <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-bad" : "text-sm text-good"}>
          {message.text}
        </p>
      ) : null}
      {admins ? (
        <ul className="flex flex-col divide-y divide-divider rounded-2xl border bg-card">
          {admins.map((a) => (
            <li key={a.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span>
                {a.email ?? a.userId} <span className="text-muted-foreground">· depuis le {dateTime(a.addedAt)}</span>
              </span>
              {confirming === a.userId ? (
                <span className="flex gap-1.5">
                  <Button type="button" variant="destructive" className="min-h-10" onClick={() => void remove(a.userId)}>
                    Confirmer le retrait
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-10" onClick={() => setConfirming(null)}>
                    Annuler
                  </Button>
                </span>
              ) : (
                <Button type="button" variant="ghost" className="min-h-10" onClick={() => setConfirming(a.userId)} aria-label={`Retirer ${a.email ?? "cet administrateur"}`}>
                  Retirer
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      )}
      <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-end gap-2">
        <label htmlFor={`${id}-email`} className="flex flex-col gap-1 text-sm font-medium">
          Ajouter un administrateur (e-mail d’un compte existant)
          <input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 w-72 rounded-[10px] border border-input bg-card px-3 text-sm font-normal"
          />
        </label>
        <Button type="submit" className="min-h-11" disabled={email.trim() === ""}>
          Ajouter
        </Button>
      </form>
    </section>
  );
}

function AuditLog() {
  const id = useId();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const start = setTimeout(() => {
      void callAdmin<{ entries: AuditEntry[] }>({ action: "audit.list" }).then((result) => {
        if (!live) return;
        if (result.ok) setEntries(result.data.entries);
        else setError(ADMIN_ERRORS[result.error] ?? ADMIN_ERRORS.failed!);
      });
    }, 0);
    return () => {
      live = false;
      clearTimeout(start);
    };
  }, []);

  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3">
      <h2 id={`${id}-title`} className="text-[17px] font-semibold">
        Journal d’audit
      </h2>
      <p className="text-sm text-muted-foreground">Les 200 dernières actions qui modifient quelque chose ou exportent des données ; conservées 12 mois.</p>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : entries === null ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune action pour l’instant.</p>
      ) : (
        <Table label="Journal d’audit">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Administrateur</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Compte visé</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap tabular-nums">{dateTime(e.at)}</TableCell>
                <TableCell>{e.admin}</TableCell>
                <TableCell>{ACTION_LABELS[e.action] ?? e.action}</TableCell>
                <TableCell>{e.target ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
