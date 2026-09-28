import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import { ThemeSync } from "@/components/app/theme-toggle";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

/** Body text (`font-sans`). */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
});

/** Display serif: page titles and hero amounts (`font-heading`). */
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Plan financier",
  description: "Budget, crédits, épargne et suivi mensuel",
  // iOS "Sur l'écran d'accueil": full screen, with this name (issue #6). Icon: app/apple-icon.png.
  appleWebApp: { capable: true, title: "Plan financier", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // --background of each theme (app/globals.css).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f0e8" },
    { media: "(prefers-color-scheme: dark)", color: "#161512" },
  ],
  // Content reaches the screen edges in standalone mode; the shell pads with the safe-area insets.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${plexSans.variable} ${newsreader.variable} h-full antialiased`}
      // THEME_INIT_SCRIPT adds `.dark` before React hydrates.
      suppressHydrationWarning
    >
      <head>
        {/* Before the first paint: no flash of the wrong theme (issue #11). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
