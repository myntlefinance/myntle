import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ProvidersLoader } from "./providers-loader";
import "./globals.css";

/* The font variables live on <html>, not <body>. Tailwind's preflight puts
 * font-family on the html element and reads --default-font-family from there,
 * and a custom property set on <body> cannot be read by its own parent. The
 * mono variable is named --font-mono-face because --font-mono is already the
 * theme's own token, and a token cannot reference itself. */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face" });

export const metadata: Metadata = {
  title: "Myntle",
  description: "Talk to your money. Every wallet, one conversation.",
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
        <ProvidersLoader>{children}</ProvidersLoader>
      </body>
    </html>
  );
}
