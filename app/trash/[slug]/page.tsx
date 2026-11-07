import TrashDetailView from "@/components/app/TrashDetailView";
import { ProvidersLoader } from "../../providers-loader";

export const metadata = {
  title: "Trash",
  description: "Preview a deleted chat.",
  robots: { index: false, follow: false },
};

export default async function TrashDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProvidersLoader>
      <TrashDetailView slug={decodeURIComponent(slug)} />
    </ProvidersLoader>
  );
}
