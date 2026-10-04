/**
 * Remote error reporting (tech-debt 1b): when NEXT_PUBLIC_SENTRY_DSN is set at build time, Sentry
 * is loaded after start-up and receives every error passed to reportError. Without a DSN nothing
 * is loaded. Financial data must not leave the browser: no PII, no console breadcrumbs, no tracing.
 */
import { addErrorReporter } from "@/lib/errors";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  import("@sentry/browser")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: process.env.NODE_ENV,
        // Sentry 11 replaced `sendDefaultPii` with `dataCollection`, whose defaults collect user info,
        // cookies, headers, bodies and query params: turn every category off explicitly.
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          graphQL: { document: false, variables: false },
          genAI: { inputs: false, outputs: false },
        },
        // console.error breadcrumbs could carry logged values; fetch/navigation ones are enough.
        beforeBreadcrumb: (breadcrumb) => (breadcrumb.category === "console" ? null : breadcrumb),
      });
      addErrorReporter((error, context) => Sentry.captureException(error, { tags: { context } }));
    })
    .catch((error: unknown) => console.error("[sentry.init]", error));
}
