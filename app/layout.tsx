import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ProvidersLoader } from "./providers-loader";
import { AgentationDev } from "@/components/app/AgentationDev";
import { ThemeSync } from "@/components/site/ThemeSync";
import "./globals.css";

/* The font variables live on <html>, not <body>. Tailwind's preflight puts
 * font-family on the html element and reads --default-font-family from there,
 * and a custom property set on <body> cannot be read by its own parent. The
 * mono variable is named --font-mono-face because --font-mono is already the
 * theme's own token, and a token cannot reference itself. */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face" });

/* No production origin is committed anywhere, so the canonical origin comes
 * from the deployment: an explicit override, else Vercel's own project URL.
 * Absolute preview URLs resolve once one of them is set. */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined);

const description =
  "Myntle is a chat-first finance app. Connect a wallet you already have, describe the trade in plain language, and approve exactly what settles on chain.";

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: { default: "Myntle", template: "%s — Myntle" },
  description,
  applicationName: "Myntle",
  ...(siteUrl ? { alternates: { canonical: "/" } } : {}),
  openGraph: {
    type: "website",
    siteName: "Myntle",
    title: "Myntle",
    description,
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "Myntle",
    description,
  },
  icons: {
    icon: [{ url: "/myntle-logo.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  // Matches the page surface token in each theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "oklch(0.985 0.001 286.376)" },
    { media: "(prefers-color-scheme: dark)", color: "oklch(0.209 0.004 264.477)" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrains.variable}`}
    >
      <body>
        <ThemeSync />
        <ProvidersLoader>{children}</ProvidersLoader>
        <AgentationDev />
      </body>
    </html>
  );
}
