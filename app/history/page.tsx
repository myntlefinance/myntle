import HistoryView from "@/components/app/HistoryView";
import { ProvidersLoader } from "../providers-loader";

export const metadata = {
  title: "History",
  description: "Every trade and deposit this account has approved.",
  robots: { index: false, follow: false },
};

export default function HistoryPage() {
  return (
    <ProvidersLoader>
      <HistoryView />
    </ProvidersLoader>
  );
}
