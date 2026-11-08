/**
 * The page surface colour in each theme.
 *
 * `theme-color` is what paints the browser chrome, and the app chooses its
 * theme from storage rather than from `prefers-color-scheme`. Keeping both
 * values here lets the server metadata, the pre-paint script, and the toggle
 * agree on the same two colours.
 */
export const THEME_COLORS = {
  light: "oklch(0.985 0.001 286.376)",
  dark: "oklch(0.209 0.004 264.477)",
} as const;

/** Point every theme-color tag at the active surface. */
export function syncThemeColor(dark: boolean): void {
  if (typeof document === "undefined") return;
  const color = dark ? THEME_COLORS.dark : THEME_COLORS.light;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", color);
  }
}
