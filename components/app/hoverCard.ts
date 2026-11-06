/* One detail card at a time across every chip surface.
 *
 * Inline chips each own their popup state, so without a shared claim two
 * cards can be mounted during a rapid hover change: the new one opens
 * instantly (warm) while the old one is still inside its close delay.
 * Claiming the surface closes the previous card before the new one paints. */

type ActiveCard = {
  id: string;
  close: () => void;
};

let active: ActiveCard | null = null;

function closeActive(exceptId: string) {
  if (!active || active.id === exceptId) return;
  const previous = active;
  active = null;
  previous.close();
}

/** Close the open card when a different chip starts showing its own. */
export function dismissHoverCard(id: string) {
  closeActive(id);
}

/** Make this card the only open one. */
export function claimHoverCard(id: string, close: () => void) {
  closeActive(id);
  active = { id, close };
}

/** Release the surface when the owning card closes or unmounts. */
export function releaseHoverCard(id: string) {
  if (active?.id === id) active = null;
}
