/**
 * Shared error taxonomy for the anti-corruption layer.
 *
 * Every adapter throws these instead of leaking provider status text.
 * Messages stay generic (no provider names); provider detail belongs in
 * server-side logs, never in the thrown message and never to the client.
 */

export class InvalidInput extends Error {
  readonly code = "InvalidInput" as const;
  readonly retryable = false as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidInput";
  }
}

export class ProviderUnavailable extends Error {
  readonly code = "ProviderUnavailable" as const;
  readonly retryable = true as const;

  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailable";
  }
}

export class NotFound extends Error {
  readonly code = "NotFound" as const;
  readonly retryable = false as const;

  constructor(message: string) {
    super(message);
    this.name = "NotFound";
  }
}

/**
 * A selected provider cannot run: its key (or other required config) is
 * missing, or the configured name is unknown. Thrown by the registry in
 * `lib/adapters/registry.ts` before any adapter code runs.
 */
export class ProviderNotConfigured extends Error {
  readonly code = "ProviderNotConfigured" as const;
  readonly retryable = false as const;
  /** The configured provider name, e.g. the value of BALANCES_PROVIDER. */
  readonly provider: string;
  /** Server-side detail only (which key is missing). Never forward verbatim. */
  readonly detail?: string;

  constructor(provider: string, detail?: string) {
    super("The requested provider is not configured.");
    this.name = "ProviderNotConfigured";
    this.provider = provider;
    if (detail !== undefined) this.detail = detail;
  }
}

export type PortError =
  | InvalidInput
  | ProviderUnavailable
  | NotFound
  | ProviderNotConfigured;

export function isPortError(error: unknown): error is PortError {
  return (
    error instanceof InvalidInput ||
    error instanceof ProviderUnavailable ||
    error instanceof NotFound ||
    error instanceof ProviderNotConfigured
  );
}

/**
 * Only a transient provider failure is worth retrying. Bad input, a
 * missing record, and a missing key are all final until something else
 * changes first.
 */
export function isRetryablePortError(error: unknown): boolean {
  return error instanceof ProviderUnavailable;
}
