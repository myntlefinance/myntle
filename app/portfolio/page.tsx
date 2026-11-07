import PortfolioView from "@/components/app/PortfolioView";
import { ProvidersLoader } from "../providers-loader";

export const metadata = {
  title: "Portfolio",
  description: "Wallet and NEAR Intents settlement ledger balances.",
  robots: { index: false, follow: false },
};

export default function PortfolioPage() {
  return (
    <ProvidersLoader>
      <PortfolioView />
    </ProvidersLoader>
  );
}
