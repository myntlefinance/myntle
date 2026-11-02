/**
 * One declaration per tool, kept in the tool's own file.
 *
 * Three things read this record: the system prompt test, which fails when a
 * registered tool is not described; the approval configuration in
 * `app/api/chat/route.ts`; and the UI, which uses `attribution` to decide
 * whether a card must name whose data it shows.
 *
 * It is not a runtime registry. `createTools` still assembles the toolset,
 * and each tool keeps its own schema and execute.
 */

/** How far the capability reaches, which decides what gates it. */
export type CapabilityTier =
  /** Public chain data. Costs a request, moves nothing. */
  | "read-public"
  /** Data tied to the signed-in account. Must be bound to the session. */
  | "read-private"
  /** Moves funds or changes policy. Needs the user's approval. */
  | "act";

/** Whose data the tool may touch. */
export type CapabilitySubject = "session" | "any-address" | "none";

export type Capability = {
  /** Must match the key in `createTools`. */
  tool: string;
  tier: CapabilityTier;
  subject: CapabilitySubject;
  approval: "none" | "user-approval";
  /** When required, the result and its card must name the address. */
  attribution: "required" | "none";
  /**
   * Literals the assembled system prompt must contain. A registered tool
   * cannot be under-described, which is how the assistant came to deny a
   * capability it had just used.
   */
  promptTerms: string[];
};
