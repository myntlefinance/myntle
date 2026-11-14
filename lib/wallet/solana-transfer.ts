"use client";

import type { Wallet, WalletAccount } from "@wallet-standard/base";

/**
 * Build and send one Solana deposit from a Wallet Standard account.
 *
 * Native SOL travels as a SystemProgram transfer; SPL tokens travel between
 * associated token accounts, creating the destination account when missing.
 * The amount is the exact smallest-unit amount from the deposit record. The
 * card's status poll remains the authority; this only broadcasts the transfer.
 */
export const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

/**
 * Client-side Solana RPC endpoint. The keyed provider is server-only, so a
 * key-bearing value in the public variable is refused here and the default
 * public endpoint is used instead. The check is shape-based (a `/v2/<key>`
 * path segment or a key query parameter) so no provider string lives in
 * client code. Mirrors the server's `looksKeyBearing`.
 */
export function solanaRpcEndpoint(): string {
  const configured = process.env.NEXT_PUBLIC_SOLANA_RPC;
  if (
    configured &&
    configured.length > 0 &&
    !(
      /\/v2\/[^/?\s]+/.test(configured) ||
      /[?&](api[_-]?key|key)=/i.test(configured)
    )
  ) {
    return configured;
  }
  return DEFAULT_SOLANA_RPC;
}

export async function sendSolanaDeposit(input: {
  wallet: Wallet;
  account: WalletAccount;
  address: string;
  depositAddress: string;
  amount: string;
  tokenMint?: string | null;
}): Promise<string> {
  const { PublicKey, SystemProgram, Transaction, Connection } = await import(
    "@solana/web3.js"
  );
  const rpc = solanaRpcEndpoint();
  const net = new Connection(rpc, "confirmed");
  const toPubkey = new PublicKey(input.depositAddress);
  const fromPubkey = new PublicKey(input.address);
  const tx = new Transaction();

  if (input.tokenMint) {
    const {
      getAssociatedTokenAddressSync,
      createTransferInstruction,
      createAssociatedTokenAccountInstruction,
      getAccount,
    } = await import("@solana/spl-token");
    const mint = new PublicKey(input.tokenMint);
    const fromAta = getAssociatedTokenAddressSync(mint, fromPubkey);
    const toAta = getAssociatedTokenAddressSync(mint, toPubkey);
    try {
      await getAccount(net, toAta);
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          fromPubkey,
          toAta,
          toPubkey,
          mint,
        ),
      );
    }
    tx.add(
      createTransferInstruction(
        fromAta,
        toAta,
        fromPubkey,
        BigInt(input.amount),
      ),
    );
  } else {
    tx.add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: BigInt(input.amount),
      }),
    );
  }

  const { blockhash } = await net.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = fromPubkey;

  const feature = input.wallet.features[
    "solana:signAndSendTransaction"
  ] as
    | {
        signAndSendTransaction: (
          ...inputs: readonly {
            account: WalletAccount;
            transaction: Uint8Array;
          }[]
        ) => Promise<readonly { signature: Uint8Array }[]>;
      }
    | undefined;
  if (!feature) {
    throw new Error("This wallet cannot send transactions");
  }
  const serialized = await tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  const [output] = await feature.signAndSendTransaction({
    account: input.account,
    transaction: serialized,
  });
  const bytes = await output.signature;
  const { toHex } = await import("./types");
  return toHex(bytes);
}
