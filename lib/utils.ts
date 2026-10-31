import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names, letting later Tailwind utilities win over earlier ones.
 *
 * The primitives import this from `@/lib/utils`, and the registry
 * does not ship it, so it lives here.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
