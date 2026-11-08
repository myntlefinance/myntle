import PortfolioView from "@/components/app/PortfolioView";
import { parsePortfolioTab } from "@/components/app/portfolioTabs";

export const metadata = {
  title: "Portfolio",
  description: "Wallet and NEAR Intents settlement ledger balances.",
  robots: { index: false, follow: false },
};

/* The opening tab is read on the server so the first paint — skeleton
 * included — already agrees with the URL. Reading it in a mount effect
 * instead would first paint the wallet and then flip. */
export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab = parsePortfolioTab(tab);
  // The key follows the tab the URL names: a client navigation to the
  // same route with a different `?tab=` remounts the view on that tab,
  // while the replaceState writes inside it never change the key.
  return <PortfolioView key={initialTab} initialTab={initialTab} />;
}
