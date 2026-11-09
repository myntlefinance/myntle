"use client";

import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { sendSolanaDeposit } from "../solana-transfer";
import { trackFundingConnection } from "./release";
import {
  gasShortfall,
  solanaGasNeed,
  tokenShortfall,
  type FundingCheck,
  type FundingConnection,
  type FundingDeposit,
  type FundingSendInput,
  type FundingSendResult,
} from "./types";

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";

function solanaConnection() {
  return import("@solana/web3.js").then(
    ({ Connection }) => new Connection(SOLANA_RPC, "confirmed"),
  );
}

/**
 * Read the exact SPL balance and the SOL available for fees.
 *
 * An uninitialised associated token account has no balance yet; the read
 * treats that as zero and leaves the shortfall to the dialogue. A balance RPC
 * failure propagates so the dialogue can show an honest error instead of
 * pretending the wallet is empty.
 */
export async function checkSolanaDeposit(
  deposit: FundingDeposit,
  address: string,
): Promise<FundingCheck> {
  const { PublicKey } = await import("@solana/web3.js");
  const net = await solanaConnection();
  const owner = new PublicKey(address);
  const amount = BigInt(deposit.amountRaw);
  const nativeBalance = BigInt(await net.getBalance(owner));

  let tokenBalance: bigint | null = null;
  let enoughToken = true;
  let destinationAtaExists = true;
  if (deposit.tokenContract) {
    const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
    const mint = new PublicKey(deposit.tokenContract);
    const ata = getAssociatedTokenAddressSync(mint, owner);
    try {
      const balance = await net.getTokenAccountBalance(ata);
      tokenBalance = BigInt(balance.value.amount);
    } catch (cause) {
      // A missing associated token account is a real zero balance. Any other
      // failure is an RPC problem and must not be painted as "insufficient".
      const message = cause instanceof Error ? cause.message : "";
      if (/could not find account|account not found|invalid param/i.test(message)) {
        tokenBalance = 0n;
      } else {
        throw cause;
      }
    }
    enoughToken = tokenBalance >= amount;
    // The send path creates the destination ATA when the 1Click address has
    // none, and the sender pays its rent. Check the destination, not the
    // sender's account: a fresh deposit address is the common case.
    const destination = getAssociatedTokenAddressSync(
      mint,
      new PublicKey(deposit.address),
    );
    destinationAtaExists = (await net.getAccountInfo(destination)) !== null;
  } else {
    enoughToken = nativeBalance >= amount;
  }

  const gasNeed = solanaGasNeed({
    tokenTransfer: !!deposit.tokenContract,
    destinationAtaExists,
    amount,
  });
  const enoughGas = nativeBalance >= gasNeed;

  let shortfall: string | undefined;
  if (!enoughToken) {
    shortfall = deposit.tokenContract
      ? tokenShortfall(
          amount,
          tokenBalance ?? 0n,
          deposit.decimals,
          deposit.symbol,
        )
      : tokenShortfall(amount, nativeBalance, 9, "SOL");
  } else if (!enoughGas) {
    shortfall = gasShortfall(
      gasNeed,
      nativeBalance,
      9,
      "SOL",
      !deposit.tokenContract,
    );
  }

  return {
    tokenBalance,
    nativeBalance,
    enoughToken,
    enoughGas,
    shortfall,
  };
}

export function createSolanaFundingConnection(input: {
  wallet: Wallet;
  account: WalletAccount;
  address: string;
  send?: (input: FundingSendInput) => Promise<FundingSendResult>;
}): FundingConnection {
  return {
    kind: "solana",
    address: input.address,
    walletName: input.wallet.name,
    walletIcon: input.wallet.icon,
    check: (deposit) => checkSolanaDeposit(deposit, input.address),
    send:
      input.send ??
      ((deposit) =>
        sendSolanaDeposit({
          wallet: input.wallet,
          account: input.account,
          address: input.address,
          depositAddress: deposit.address,
          amount: deposit.amountRaw,
          tokenMint: deposit.tokenContract,
        }).then((txHash) => ({ txHash }))),
  };
}

/** Reuse a connected Solana account without a second `standard:connect`. */
export function createConnectedSolanaFunding(input: {
  address: string;
  send: (input: FundingSendInput) => Promise<FundingSendResult>;
  walletName?: string;
  walletIcon?: string;
}): FundingConnection {
  return {
    kind: "solana",
    address: input.address,
    walletName: input.walletName,
    walletIcon: input.walletIcon,
    connected: true,
    check: (deposit) => checkSolanaDeposit(deposit, input.address),
    send: input.send,
  };
}

/**
 * Connect a Solana funding wallet through its Wallet Standard feature.
 *
 * The wallet object comes from the registry the browser advertises; it is not
 * the app's connection state, and connecting here never writes that state.
 */
export async function connectSolanaFunding(
  wallet: Wallet,
): Promise<FundingConnection> {
  let account = wallet.accounts[0];
  const feature = wallet.features["standard:connect"] as
    | {
        connect: (input?: unknown) => Promise<{
          accounts: readonly WalletAccount[];
        }>;
      }
    | undefined;
  if (feature) {
    const result = await feature.connect();
    account = result.accounts[0] ?? account;
  }
  if (!account) throw new Error("This wallet did not share an account");
  // The funding wallet may be a different one from the app's session wallet.
  // Its grant is released on sign-out so it cannot bleed into the next login.
  trackFundingConnection(async () => {
    const disconnect = wallet.features["standard:disconnect"] as
      | { disconnect: () => Promise<void> }
      | undefined;
    await disconnect?.disconnect();
  });
  return createSolanaFundingConnection({
    wallet,
    account,
    address: account.address,
  });
}
