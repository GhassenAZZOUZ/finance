import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Confidentialité · Boussole" };

const REPOSITORY = "https://github.com/GhassenAZZOUZ/finance";

/**
 * Public page (no login): the privacy policy, required by the Google Play listing (issue #84) and
 * linked from the app. Keep it in step with SPEC (data stored, D30 statements, D19 Android app).
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12 text-[15px] leading-relaxed">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-[32px] leading-tight font-medium">Politique de confidentialité</h1>
        <p className="text-sm text-muted-foreground">Boussole, site web et application Android · mise à jour le 6 octobre 2026</p>
      </header>

      <Section title="En bref">
        <ul className="list-disc pl-5">
          <li>Vos données servent uniquement à faire fonctionner Boussole pour vous.</li>
          <li>Elles ne sont ni vendues, ni partagées, ni utilisées pour de la publicité ou du suivi.</li>
          <li>Aucune opération bancaire n’est enregistrée : un relevé importé est lu dans votre appareil.</li>
          <li>Vous pouvez tout supprimer à tout moment depuis « Mes données ».</li>
        </ul>
      </Section>

      <Section title="Qui traite vos données">
        <p>
          Boussole est une application personnelle de gestion de budget, développée et exploitée par son auteur, Ghassen Azzouz. Pour
          toute question ou demande sur vos données, ouvrez un ticket sur{" "}
          <a href={`${REPOSITORY}/issues`} className="font-medium text-link underline underline-offset-2">
            le dépôt du projet
          </a>{" "}
          sans y mettre de donnée personnelle : un contact privé vous sera proposé.
        </p>
      </Section>

      <Section title="Ce qui est enregistré">
        <ul className="list-disc pl-5">
          <li>Votre adresse e-mail, pour vous connecter et, si vous le souhaitez, recevoir le rappel mensuel.</li>
          <li>
            Ce que vous saisissez : budget, objectifs d’épargne, crédits, suivis mensuels et paramètres du plan.
          </li>
          <li>
            Pour un relevé bancaire importé : le nom du compte, le nom du fichier, le nombre d’opérations, les totaux et le total
            par ligne de budget. Les opérations elles-mêmes (dates, libellés, montants) restent dans votre appareil et ne sont
            jamais envoyées.
          </li>
          <li>Vos préférences : rappel mensuel, colonnes de vos relevés, règles d’affectation.</li>
        </ul>
      </Section>

      <Section title="Où et comment">
        <ul className="list-disc pl-5">
          <li>
            Les données sont hébergées par Supabase dans l’Union européenne (Paris). Chaque utilisateur n’accède qu’à ses propres
            données, contrôlé par la base de données elle-même.
          </li>
          <li>Les échanges sont chiffrés (HTTPS). Le site est servi par GitHub Pages.</li>
          <li>Les e-mails de connexion et de rappel sont envoyés par un service d’e-mail utilisé uniquement pour cela.</li>
          <li>
            Une sauvegarde chiffrée de la base est faite chaque semaine dans un dépôt privé, pour pouvoir restaurer les données en
            cas d’incident.
          </li>
          <li>
            Si le suivi des erreurs est activé, un rapport technique est envoyé à Sentry en cas d’erreur, sans adresse e-mail,
            cookie, contenu de formulaire ni donnée financière.
          </li>
        </ul>
      </Section>

      <Section title="Dans l’application Android">
        <ul className="list-disc pl-5">
          <li>Votre session est gardée dans le stockage sécurisé du téléphone (Android Keystore).</li>
          <li>
            Une copie de vos dernières données est gardée chiffrée sur le téléphone pour les consulter hors ligne ; elle est
            effacée quand vous vous déconnectez.
          </li>
          <li>Le verrouillage par empreinte ou visage est vérifié par le téléphone : Boussole ne reçoit aucune donnée biométrique.</li>
          <li>Aucun outil de mesure d’audience ni de publicité n’est intégré.</li>
        </ul>
      </Section>

      <Section title="Vos droits">
        <p>
          Vous pouvez consulter et corriger vos données dans l’application, les exporter (« Mes données → Exporter ») et supprimer
          votre compte et toutes vos données (« Mes données → Supprimer mon compte »). La suppression est immédiate ; les données
          disparaissent des sauvegardes suivantes. Vous pouvez aussi adresser une réclamation à la CNIL.
        </p>
      </Section>

      <p className="text-sm text-muted-foreground">
        <Link href="/" className="font-medium text-link underline underline-offset-2">
          Retour à Boussole
        </Link>
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
