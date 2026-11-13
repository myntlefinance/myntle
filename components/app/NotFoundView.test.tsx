import { describe, it, expect, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/components/primitives/SidebarNav", () => ({
  default: () => "sidebar",
}));

vi.mock("@/components/app/AccountControl", () => ({
  AccountControl: () => "account-control",
}));

vi.mock("@/components/app/threadQueries", () => ({
  useThreads: () => ({ data: [] }),
  useTrashed: () => ({ data: [] }),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ status: "signed-out" }),
}));

import { NotFoundView } from "@/components/app/NotFoundView";

describe("NotFoundView", () => {
  const html = ReactDOMServer.renderToStaticMarkup(<NotFoundView />);

  it("renders the app page frame rather than a bare message", () => {
    expect(html).toContain("sidebar");
    expect(html).toContain("h-[100dvh]");
    expect(html).toContain("rounded-[14px]");
    expect(html).toContain("h-11");
    expect(html).toContain("Page not found");
  });

  it("shows the bare 404 mark at its display size, without an icon tile", () => {
    expect(html).toContain('width="216"');
    expect(html).not.toContain("shadow-hairline");
  });

  it("says what happened in prose and offers both ways out", () => {
    expect(html).toContain("This page does not exist.");
    expect(html).toContain(
      "The link may be wrong, or the page may have moved.",
    );
    expect(html).toContain("New chat");
    expect(html).toContain("Portfolio");
    expect(html).toContain("tabler-icon-pencil");
    expect(html).toContain("tabler-icon-wallet");
  });
});
