import type { MetadataRoute } from "next";
import { BASE_PATH } from "@/lib/supabase/client";

export const dynamic = "force-static";

/**
 * Web app manifest (issue #6): installable from Chrome and Safari, opens standalone at the app
 * root. Every URL carries the GitHub Pages base path ("/finance" in production, "" locally).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${BASE_PATH}/`,
    name: "Cap",
    short_name: "Cap",
    description: "Budget, crédits, épargne et suivi mensuel",
    lang: "fr",
    start_url: `${BASE_PATH}/`,
    scope: `${BASE_PATH}/`,
    display: "standalone",
    // --background and --primary (app/globals.css).
    background_color: "#f3f0e8",
    theme_color: "#f3f0e8",
    icons: [
      { src: `${BASE_PATH}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${BASE_PATH}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${BASE_PATH}/icons/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Saisir le suivi du mois", short_name: "Suivi", url: `${BASE_PATH}/suivi/` }],
  };
}
