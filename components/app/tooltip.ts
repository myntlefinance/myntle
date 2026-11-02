/* ─────────────────────────────────────────────────────────
 * EMIL KOWALSKI TOOLTIP COORDINATOR
 *
 * "Tooltips should delay before appearing to prevent accidental
 * activation. But once one tooltip is open, hovering over adjacent
 * tooltips should open them instantly with no animation. This feels
 * faster without defeating the purpose of the initial delay."
 *
 * - Cold hover: waits 400ms delay, then smoothly animates in (pop-in 125ms).
 * - Warm window: once any tooltip is active, adjacent tooltips open with
 *   0ms delay and 0ms animation duration.
 * - Cool-down: after mouse leaves for 400ms, reverts back to cold.
 * ───────────────────────────────────────────────────────── */

export let globalIsWarm = false;
export let globalWarmTimer: ReturnType<typeof setTimeout> | null = null;

export function onTooltipEnter() {
  if (globalWarmTimer) {
    clearTimeout(globalWarmTimer);
    globalWarmTimer = null;
  }
}

export function onTooltipLeave() {
  if (globalWarmTimer) clearTimeout(globalWarmTimer);
  globalWarmTimer = setTimeout(() => {
    globalIsWarm = false;
  }, 400);
}

export function activateWarmState() {
  globalIsWarm = true;
  if (globalWarmTimer) {
    clearTimeout(globalWarmTimer);
    globalWarmTimer = null;
  }
}

export function isTooltipWarm() {
  return globalIsWarm;
}

/** The pill shared by every tooltip in the product. */
export const TOOLTIP_PILL_CLASS =
  "pointer-events-none inline-flex h-5.5 items-center justify-center whitespace-nowrap rounded-full bg-inset px-2.5 text-[11.5px] font-medium shadow-hairline";

export const TOOLTIP_PILL_TEXT = "text-ink dark:text-white";

export const TOOLTIP_ENTER_ANIMATION =
  "pop-in 125ms cubic-bezier(0.23, 1, 0.32, 1) both";
