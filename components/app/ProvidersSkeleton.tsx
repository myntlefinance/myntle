"use client";

import { usePathname } from "next/navigation";
import {
  AppShellSkeleton,
  type AppShellVariant,
} from "@/components/app/AppShellSkeleton";
import type { PortfolioTab } from "@/components/app/portfolioTabs";

function variantFor(pathname: string | null): AppShellVariant {
  if (!pathname || pathname === "/") return "empty";
  if (pathname.startsWith("/chat/")) return "thread";
  if (pathname === "/portfolio") return "portfolio";
  if (pathname === "/history") return "history";
  if (pathname === "/trash") return "trash";
  if (pathname.startsWith("/trash/")) return "trash-thread";
  return "page";
}

/**
 * The provider boundary's first paint.
 *
 * Kept as its own client component because the variant follows the route:
 * a new chat opens on the empty state, a saved chat opens on the thread,
 * and each account page opens on its own header and body shape. One neutral
 * skeleton would still jump on all of them.
 *
 * The portfolio tab is rendered from the server-read header, not from
 * `useSearchParams`: the shell is outside the page, so the hook would only
 * resolve after hydration and the wallet shape would paint first.
 */
export function ProvidersSkeleton({
  initialPortfolioTab,
}: {
  initialPortfolioTab?: PortfolioTab;
}) {
  const pathname = usePathname();
  const variant = variantFor(pathname);
  return (
    <AppShellSkeleton
      variant={variant}
      tab={variant === "portfolio" ? initialPortfolioTab : undefined}
    />
  );
}

export default ProvidersSkeleton;
