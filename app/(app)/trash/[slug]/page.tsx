import TrashDetailView from "@/components/app/TrashDetailView";

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
  return <TrashDetailView slug={decodeURIComponent(slug)} />;
}
