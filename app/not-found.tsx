import type { Metadata } from "next";
import { NotFoundView } from "@/components/app/NotFoundView";
import { ProvidersLoader } from "./providers-loader";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The page you are looking for does not exist.",
  robots: { index: false, follow: false },
};

/**
 * Unmatched URLs, and any `notFound()` without a nearer boundary.
 *
 * The provider boundary is the same one the app layout mounts, so the rail's
 * account control, recents, and trash are live instead of inert. While the
 * wallet bundle loads, the page skeleton paints the shell (the `page`
 * variant), exactly as it does on every other route.
 */
export default function NotFound() {
  return (
    <ProvidersLoader>
      <NotFoundView />
    </ProvidersLoader>
  );
}
