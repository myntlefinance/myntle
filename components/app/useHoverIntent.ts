"use client";

import { useEffect, useMemo } from "react";
import {
  createHoverIntent,
  HOVER_INTENT_DELAY_MS,
  type HoverIntentController,
} from "./hoverIntent";

/**
 * One dwell timer for a list of rows.
 *
 * Pass a stable callback (a module function or a `useCallback`): a new
 * identity starts a fresh controller, which cancels any pending dwell.
 */
export function useHoverIntent(
  onIntent: (id: string) => void,
  delayMs = HOVER_INTENT_DELAY_MS,
): HoverIntentController {
  const intent = useMemo(
    () => createHoverIntent(onIntent, delayMs),
    [onIntent, delayMs],
  );

  useEffect(() => () => intent.cancel(), [intent]);

  return intent;
}
