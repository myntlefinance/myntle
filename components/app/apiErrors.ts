/* ─────────────────────────────────────────────────────────
 * API ERRORS
 * Two outcomes any signed-in read can produce, kept distinct so
 * a page can answer them differently: the session ended, or the
 * request failed. Everything else is a plain Error.
 * ───────────────────────────────────────────────────────── */

/** The session is gone; the page should offer sign-in, not a retry. */
export class AuthExpiredError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "AuthExpiredError";
  }
}
