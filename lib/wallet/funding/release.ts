"use client";

/**
 * The wallet authorisations made by the funding dialog.
 *
 * A funding connection is deliberately separate from the app's session
 * wallet, but the grant it obtains lives in the same wallet extension and
 * outlasts the dialog. Sign-out has to release those grants too, or the next
 * log-in starts from a selector in which a wallet still believes the site is
 * connected — the secondary connection interfering with the login.
 */
type Release = () => Promise<void> | void;

const releases = new Set<Release>();

/** Records how a funding connection gives its grant back. */
export function trackFundingConnection(release: Release): void {
  releases.add(release);
}

/** Releases every funding connection made since the last sign-out. */
export async function releaseFundingConnections(): Promise<void> {
  const pending = [...releases];
  releases.clear();
  await Promise.allSettled(
    // The async wrapper turns a synchronous throw into a rejection, so one
    // wallet that cannot release does not stop the others.
    pending.map(async (release) => {
      await release();
    }),
  );
}
