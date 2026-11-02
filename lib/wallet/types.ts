export type ChainKind = "evm" | "solana" | "near";

export type SigningStandard = "erc191" | "raw_ed25519" | "nep413";

/**
 * A connected wallet, normalised.
 *
 * The three wallet libraries describe the same thing in three different ways,
 * and the application only ever needs these fields.
 */
export type ConnectedWallet = {
  kind: ChainKind;
  standard: SigningStandard;
  /** The address on the chain the wallet belongs to. */
  address: string;
  /**
   * The wallet app name for display (MetaMask, Phantom…), when the adapter
   * knows it. Absent on bare reconnects, where the address reads instead.
   */
  walletName?: string;
  /**
   * The wallet brand mark for display, when the adapter knows it. Served
   * inside an <img> tag only, which cannot execute script, and always with
   * the generic glyph as the error fallback.
   */
  walletIcon?: string;
  /**
   * The account the verifier knows this wallet as.
   *
   * This is not the address. An Ed25519 key produces a sixty-four character
   * hexadecimal account, a secp256k1 key produces the address itself, and a
   * named NEAR account keeps its name. The same wallet on two chains is two
   * accounts with two balances.
   */
  signerId: string;
  /**
   * The public key in the form the signed payload expects, or empty when the
   * standard recovers it from the signature instead.
   */
  publicKey: string;
};

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
