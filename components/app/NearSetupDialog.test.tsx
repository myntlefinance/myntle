import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";

vi.mock("@/lib/wallet/registry", () => ({
  useWallet: () => ({
    getNearPublicKey: vi.fn(),
    registerNearIntentsKey: vi.fn(),
  }),
}));

vi.mock("@/lib/intents/near-setup", () => ({
  confirmNearSetup: vi.fn(),
  fetchNearSetup: vi.fn(),
  fundNearSetup: vi.fn(),
}));

vi.mock("@/lib/intents/user-session", () => ({
  notifySuperClosed: vi.fn(),
  SUPER_CANCEL_EVENT: "myntle:super-cancel",
}));

vi.mock("@/components/app/DialogShell", () => ({
  DialogShell: ({
    title,
    subtitle,
    children,
    footer,
  }: {
    title?: string;
    subtitle?: string;
    children?: React.ReactNode;
    footer?: React.ReactNode;
  }) => (
    <div>
      <p>{title}</p>
      <p>{subtitle}</p>
      {children}
      {footer}
    </div>
  ),
}));

import { NearSetupDialog } from "./NearSetupDialog";

describe("NEAR setup copy", () => {
  it("explains the one-time registration, the fee, and the approval", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <NearSetupDialog onClose={() => {}} onDone={() => {}} />,
    );

    expect(html).toContain("Set up your super account");
    expect(html).toContain("NEAR Intents needs to register this wallet");
    expect(html).toContain(
      "We send 0.0015 NEAR to cover the network fee",
    );
    expect(html).toContain("Checking your NEAR account…");
    expect(html).not.toContain("deploy");
    expect(html.toLowerCase()).not.toContain("near wallet");
  });
});
