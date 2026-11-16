"use client";

import { Button, type ButtonVariant } from "@/components/atoms/Button";

/**
 * Button tone reference.
 *
 * Every tone with its label and one-line usage, the three sizes, and how
 * the footer pair reads on the surface — so the View Txn decision can be
 * made by looking, not by guessing.
 */

const TONES: { tone: ButtonVariant; usage: string }[] = [
  { tone: "primary", usage: "The one decision on a surface. Ink-filled, strongest." },
  { tone: "secondary", usage: "The supporting action. Surface with a ring and shadow." },
  { tone: "accent", usage: "Brand-blue fill. Approvals and actions that leave." },
  { tone: "outline", usage: "Transparent with an edge. Quiet, but still a button." },
  { tone: "success", usage: "Green fill. Confirmations." },
  { tone: "destructive", usage: "Red fill. Irreversible actions." },
  { tone: "ghost", usage: "Muted fill, no ring. Dense rows and toolbars." },
  { tone: "quiet", usage: "Text until hovered. Tertiary actions." },
];

function ToneRow({ tone, usage }: { tone: ButtonVariant; usage: string }) {
  const label = tone.charAt(0).toUpperCase() + tone.slice(1);
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-28 shrink-0">
        <Button variant={tone} size="sm" className="w-full">
          {label}
        </Button>
      </span>
      <p className="min-w-0 text-xs leading-relaxed text-ink-2">{usage}</p>
    </div>
  );
}

export default function ButtonVariants() {
  return (
    <div className="w-full max-w-95 overflow-hidden rounded-card bg-surface shadow-card">
      <div className="primitive-card-pad" style={{ paddingTop: 14, paddingBottom: 14 }}>
        <div className="flex flex-col">
          {TONES.map((t) => (
            <ToneRow key={t.tone} tone={t.tone} usage={t.usage} />
          ))}
        </div>

        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs text-ink-3">Sizes, on secondary</p>
          <div className="mt-1.5 flex items-center gap-2">
            <Button variant="secondary" size="xs">
              Action
            </Button>
            <Button variant="secondary" size="sm">
              Action
            </Button>
            <Button variant="secondary" size="md">
              Action
            </Button>
          </div>
        </div>

        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs text-ink-3">The footer pair, on the surface</p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface px-2.5 py-2">
              <Button variant="outline" size="sm">
                Details
              </Button>
              <Button variant="ghost" size="sm">
                View Txn
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface px-2.5 py-2">
              <Button variant="secondary" size="sm">
                Details
              </Button>
              <Button variant="quiet" size="sm">
                View Txn
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
