/**
 * Hover intent, not hover.
 *
 * A pointer crossing a sidebar row is not a request to fetch anything. The
 * caller starts a timer on enter, cancels it on leave, and only fires after
 * the pointer has rested for the dwell. The controller is pure so the
 * timing can be tested without a DOM.
 */

export const HOVER_INTENT_DELAY_MS = 350;

export type HoverIntentController = {
  /** Start the dwell for a row. Touch and pen are ignored. */
  enter: (id: string, pointerType?: string) => void;
  /** Cancel only when the pointer leaves the row that owns the timer. */
  leave: (id: string) => void;
  cancel: () => void;
};

export function createHoverIntent(
  onIntent: (id: string) => void,
  delayMs = HOVER_INTENT_DELAY_MS,
): HoverIntentController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingId: string | null = null;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pendingId = null;
  };

  return {
    enter(id, pointerType) {
      // A tap is about to open the row on its own; prefetching it first would
      // spend a request on the same thread. Only a mouse rests on a row.
      if (pointerType && pointerType !== "mouse") return;
      // Moving within one row (row background to its menu button) must not
      // restart the dwell, or the prefetch never lands while the pointer moves.
      if (pendingId === id && timer !== null) return;
      cancel();
      pendingId = id;
      timer = setTimeout(() => {
        const fire = pendingId;
        timer = null;
        pendingId = null;
        if (fire !== null) onIntent(fire);
      }, delayMs);
    },
    leave(id) {
      if (pendingId === id) cancel();
    },
    cancel,
  };
}
