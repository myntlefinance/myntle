import { headers } from "next/headers";
import { parsePortfolioTab } from "@/components/app/portfolioTabs";
import { ProvidersLoader } from "../providers-loader";

/**
 * The shared provider boundary for every interactive route.
 *
 * A layout keeps its state across navigation; a page does not. Mounting the
 * wallet and session providers inside each page tore the whole tree down on
 * every click, so the query cache, the wallet connection, and the session
 * were rebuilt from scratch while the screen sat blank in between.
 *
 * The portfolio tab arrives as a request header from the proxy: a layout
 * cannot read search params, and the first-paint shell has to agree with
 * `?tab=` before the client can read the URL.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tab = parsePortfolioTab(
    (await headers()).get("x-portfolio-tab"),
  );
  return (
    <ProvidersLoader initialPortfolioTab={tab}>{children}</ProvidersLoader>
  );
}
