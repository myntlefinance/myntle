/* ─────────────────────────────────────────────────────────
 * AUTH EVENTS
 * The window events that announce a session change. They live
 * in their own module so listeners can subscribe without
 * importing the provider, which pulls the whole wallet tree in
 * behind it.
 * ───────────────────────────────────────────────────────── */

export const SIGN_IN_EVENT = "myntle:sign-in";
export const SIGN_OUT_EVENT = "myntle:sign-out";
