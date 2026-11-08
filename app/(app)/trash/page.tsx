import TrashView from "@/components/app/TrashView";

export const metadata = {
  title: "Trash",
  description: "Deleted chats, restorable for 30 days.",
  robots: { index: false, follow: false },
};

export default function TrashPage() {
  return <TrashView />;
}
