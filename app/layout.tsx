import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
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
  themeColor: "#f3f0e8",
  // Content reaches the screen edges in standalone mode; the shell pads with the safe-area insets.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${plexSans.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
