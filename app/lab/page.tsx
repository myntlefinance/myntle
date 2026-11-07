import fs from "node:fs";
import path from "node:path";
import { ProvidersLoader } from "../providers-loader";
import { LabFrame } from "@/components/lab/LabFrame";
import { LAB } from "@/components/lab/registry";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import DepositCard from "@/components/lab/samples/DepositCard";
import SwapCard from "@/components/lab/samples/SwapCard";
import BridgeCard from "@/components/lab/samples/BridgeCard";
import WithdrawCard from "@/components/lab/samples/WithdrawCard";
import LimitOrderCard from "@/components/lab/samples/LimitOrderCard";
import ChipHoverCards from "@/components/lab/samples/ChipHoverCards";
import AuthProbe from "@/components/lab/samples/AuthProbe";
import UnlockCardStates from "@/components/lab/samples/UnlockCardStates";

export const metadata = {
  title: "Lab",
  description: "Prototypes, isolated from the product.",
  robots: { index: false, follow: false },
};

/**
 * The prototypes on this page.
 *
 * A new prototype needs an entry in the registry and a file in
 * `components/lab/samples/`. Nothing in the application imports either of
 * them, so nothing here can break the product.
 */
const PROTOTYPES: Record<string, React.ComponentType<{ variant?: string }>> = {
  "deposit-card": DepositCard,
  "swap-card": SwapCard,
  "bridge-card": BridgeCard,
  "withdraw-card": WithdrawCard,
  "limit-order-card": LimitOrderCard,
  "chip-hover-cards": ChipHoverCards,
  "auth-probe": AuthProbe,
  "unlock-card": UnlockCardStates,
};

/** Sources are read at build time so each frame can offer its own file. */
function readSource(file: string): string {
  const pathToFile = path.join(
    process.cwd(),
    "components",
    "lab",
    "samples",
    file,
  );
  try {
    return fs.readFileSync(pathToFile, "utf8");
  } catch {
    return "// The source file could not be read.";
  }
}

export default function LabPage() {
  return (
    <ProvidersLoader>
    <main className="min-h-[100dvh] bg-page text-ink">
      <div className="mx-auto max-w-[880px] px-6 pb-24">
        <header className="flex items-start justify-between gap-4 py-9">
          <div>
            <h1 className="text-[20px] font-medium tracking-[-0.01em] text-ink">
              Lab
            </h1>
            <p className="mt-1.5 max-w-[58ch] text-[13.5px] leading-relaxed text-ink-2">
              Prototypes for the parts of the product that are still being
              worked out. Nothing on this page is part of the application, and
              nothing here can break it.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <div className="rounded-[12px] border border-line bg-surface">
          {LAB.map((entry) => {
            const Component = PROTOTYPES[entry.id];
            if (!Component) return null;

            return (
              <LabFrame
                key={entry.id}
                title={entry.title}
                caption={entry.caption}
                file={`components/lab/samples/${entry.file}`}
                variants={entry.variants ?? ["Default"]}
                code={readSource(entry.file)}
                Component={Component}
                layout={entry.layout}
              />
            );
          })}
        </div>

        <p className="mt-6 text-[12.5px] leading-relaxed text-ink-3">
          To add a prototype, put a file in{" "}
          <span className="font-mono text-ink-2">components/lab/samples/</span>{" "}
          and add one line to{" "}
          <span className="font-mono text-ink-2">components/lab/registry.ts</span>.
        </p>
      </div>
    </main>
    </ProvidersLoader>
  );
}
