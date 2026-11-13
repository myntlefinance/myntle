import type { Metadata } from "next";
import { NotFoundView } from "@/components/app/NotFoundView";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The page you are looking for does not exist.",
  robots: { index: false, follow: false },
};

/** A `notFound()` thrown inside the app already sits in the provider layout,
 * so this boundary must not mount a second one. */
export default function AppNotFound() {
  return <NotFoundView />;
}
