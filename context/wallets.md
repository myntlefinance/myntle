# Wallets

The application is not a NEAR wallet application. It is a multi-chain finance application that settles through NEAR Intents, and the wallet the user connects determines which chain their money starts on and which signing standard their approval uses.

This document covers the wallet layer, the identity model it produces, and how the assistant's proposals are signed.

---

## The change, and why it is the right one

The earlier plan assumed a NEAR wallet, a NEAR account, NEAR gas, and a swap on a NEAR exchange. That plan had a problem that is easy to miss: a judge at the hackathon would need a NEAR account with gas before they could try anything, and getting one takes several minutes and a faucet.

NEAR Intents removes that problem entirely. The user signs a message with a wallet they already have, and the settlement happens inside NEAR's verifier contract. No NEAR account, no gas, no faucet, no waiting.

So the wallet layer becomes three adapters behind one interface, and the identity the application records becomes an Intents account rather than a NEAR account.

| Chain | Wallets | Signing standard | Address |
|---|---|---|---|
| EVM | MetaMask, Rabby, Rainbow, anything WalletConnect | **ERC-191** | `0x` plus 40 hex characters |
| Solana | Phantom, Solflare, Slope | **Raw Ed25519** | Base58, 44 characters |
| NEAR | MyNearWallet, Meteor, Sender, Ledger | **NEP-413** | `alice.near`, or 64 hex characters |
| Stellar | Freighter, Lumens | SEP-53 | 56 base32 characters |
| TON | Tonkeeper, EverWallet | TON Connect | Base64 |
| TRON | TronLink, Klever | TIP-191 | Starts with `T` |

Only the first three are in the first release. The others are free additions, because the verifier already speaks them and the adapter interface does not change.

---

## The adapter

Three libraries, each doing one job, wrapped in one interface of our own.

```
lib/wallet/
├── types.ts          the adapter interface and the chain descriptors
├── registry.ts       picks the adapter for the connected chain
├── evm.ts            wagmi and viem
├── solana.ts         the Solana wallet adapter
├── near.ts           near-connect
└── intent.ts         builds and signs the intent payload for each standard
```

```ts
export type ChainKind = "evm" | "solana" | "near";

export interface WalletAdapter {
  kind: ChainKind;
  /** The address on the chain the wallet belongs to. */
  address: string;
  /** The account the verifier knows this wallet as. */
  signerId: string;
  /** The signing standard this chain uses. */
  standard: "erc191" | "raw_ed25519" | "nep413";

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  signMessage(message: string): Promise<{ signature: string; publicKey: string }>;
  /** Signs an intent payload in this chain's standard. */
  signIntent(payload: IntentPayload): Promise<SignedIntent>;
}
```

The important detail is `signerId`. It is not the wallet's address. It is the identifier the verifier uses for the account, and it is derived from the public key.

An Ed25519 key produces a sixty-four character hexadecimal implicit account. A secp256k1 key produces a `0x` address. A named NEAR account keeps its name. Two people using the same wallet on two different chains are two different accounts, and the application records them as two different identities with two different sets of balances.

That is why the database keeps a `chain` column next to every address.

---

## The libraries

| Chain | Package | Licence | What it gives us |
|---|---|---|---|
| EVM | `wagmi` and `viem` | MIT | Connection, address, and `personal_sign` for ERC-191 |
| Solana | `@solana/wallet-standard` and `@wallet-standard/app` | Apache-2.0 | Connection, address, and `signMessage` for raw Ed25519 |
| NEAR | `@hot-labs/near-connect` and `near-connect-hooks` | MIT | Connection, address, and `signMessage` for NEP-413 |

**The Solana choice is not the obvious one, and the reason is worth recording.** The usual answer is `@solana/wallet-adapter`, and that answer is no longer available. The whole 0.19 line of the base package and of every per-wallet package has been withdrawn from npm, so there is nothing to install at that version. What replaced it is version 3, and version 3 requires React 19.3, `@solana/kit`, and `@solana/web3.js` version 3.

That last part is the problem. `@ai-sdk/react` declares a peer of `react: ^18 || ~19.0.1 || ~19.1.2 || ~19.2.1`, which excludes 19.3. The two cannot be installed together without a peer warning, and a peer warning on the AI SDK's React bindings is not something to carry into a build with a deadline.

The Wallet Standard sidesteps the whole problem. It is the standard that Phantom, Solflare, Backpack and the rest already implement, it has no peer dependencies at all, and it is a much smaller thing than the adapter family it replaces. For what this application needs, which is an address and a signed message, the standard is sufficient on its own.

```bash
bun add @solana/wallet-standard @wallet-standard/app @wallet-standard/base
```

The registry API is small.

```ts
import { getWallets } from "@wallet-standard/app";

const api = getWallets();
const wallets = api.get();               // everything registered right now
const off = api.on("register", sync);    // and anything that registers later
```

Signing goes through a named feature on the wallet.

```ts
const feature = wallet.features["solana:signMessage"];
const [output] = await feature.signMessage({ account, message: payload });
output.signature; // Uint8Array, Ed25519
```

There is also an option not to build the connection layer at all. NEAR Intents publishes a React widget, `@aurora-is-near/intents-swap-widget`, that handles multi-chain wallet connection and swapping out of the box. It is a good reference and a good fallback, and it is not what this application is, because the wallet belongs at the top of a chat application rather than inside a swap form. The widget also has its own visual language, and this product has its own.

### Two things about the standard

**The types lose a property.** The published `SolanaSignMessageFeature` describes the feature under a computed key, and the property disappears when the type is imported through the re-export chain. The shape is written out locally in `lib/wallet/solana.ts` instead, which is three lines and removes the fragility.

**The registry must not be evaluated on the server.** The package reaches for `indexedDB` when it is evaluated, and the server has no such thing. The import is therefore inside the effect rather than at the top of the file, so the module is only ever evaluated in a browser.

### What the account is, per chain

The account the verifier knows is derived from the public key, and the derivation differs by curve. The Wallet Standard hands over the raw public key, which is what makes the Solana case straightforward.

| Chain | `signer_id` | `public_key` in the signed payload |
|---|---|---|
| EVM | The `0x` address | Recovered from the signature, so it is not sent |
| Solana | Hex of the 32 public key bytes | `ed25519:` plus the base58 address |
| NEAR | The account id | `ed25519:` plus the base58 key |

---

## Signing an intent

Every standard takes the same shape but encodes it differently.

| Standard | What the wallet signs | How it is verified |
|---|---|---|
| ERC-191 | The payload wrapped in `"\x19Ethereum Signed Message:\n"` framing | Recover the address from the signature and check it matches |
| Raw Ed25519 | The payload bytes directly | Verify the signature against the public key |
| NEP-413 | The payload serialised with a Borsh prefix and hashed | Verify against the account's key on chain |

For EVM, `viem` has `verifyMessage`, which recovers the address. For Solana, the `@noble/curves` Ed25519 verifier does it. For NEAR, `near-api-js/nep413` has `verifyMessage`, which additionally checks that the signing key is a full-access key on chain.

One detail catches people out on the EVM side. The verifier expects the recovery byte to be zero or one, and some clients shift it according to the chain id. Normalise it before submitting.

---

## The session

Connecting a wallet tells us an address. It does not prove the person is us, so the application issues a random thirty-two byte challenge, asks the wallet to sign it in its own standard, and verifies the signature on the server before creating a session.

The challenge is bound to the chain, the address, and the standard, so a signature captured on one chain cannot be replayed on another. The nonce is consumed once, and it expires after five minutes.

There is a second option, which is to let the Intents service handle the session. Its authentication endpoint exchanges signed data for an access token and a refresh token. That is simpler, and it means the application does not implement three verifiers. The reason to keep our own is control over the session lifetime and over what is stored, and because our own challenge flow is already written and tested against one chain.

---

## What the assistant is allowed to do with a wallet

The assistant never sees a wallet. It never sees an address. It never sees a signature.

It receives what the tools return, and the tools return balances, prices, and routes. When it wants to propose a trade, it calls the one tool that proposes. The application then builds the intent, shows it, and asks the wallet to sign it.

This boundary is what makes the product safe to put in front of strangers, and it is worth restating in the code rather than only in the documentation. There is no tool that signs. There is no tool that takes an address. The assistant proposes a trade in terms of two assets and an amount, and the application decides what to do with that.

---

## How the agent's key fits a multi-chain user

The bounded agent needs a key that can sign intents on the user's behalf. For a NEAR user, that key is added to the NEAR account as a function-call access key and registered with the verifier. For an EVM or Solana user there is no NEAR account to add a key to, and the answer is that a public key can be added to an account through a signed intent.

The flow is the same shape on every chain. The user signs an intent that adds the agent's public key to their account. The verifier registers it. The agent then signs intents under that key, and the user's balance is what the policy engine protects.

The agent's key has to match the curve of the account. An Ed25519 account takes an Ed25519 agent key, and a secp256k1 account takes a secp256k1 agent key. The signer id determines which.

Revocation is the same on every chain. Remove the public key from the verifier and the agent's signatures stop verifying immediately.

---

## The balance question

There are two balances for every user, and they are not the same thing.

The **on-chain balance** is what they hold in their wallet on their own chain. Reading it means asking that chain's node, and for a multi-chain application that means an adapter per chain.

The **verifier balance** is what they hold inside NEAR Intents. It is what a swap actually spends, and it is what the user sees after a trade settles. The balance endpoint returns it, and it is the number that matters for a swap.

A user with two hundred USDC in their MetaMask and nothing in the Intents ledger cannot swap through the signed-intent path, because the deposit has to land in the ledger first. The interface has to say that plainly rather than showing a balance that cannot be spent.

---

## What changes for the product

**Onboarding becomes a single button.** Connect a wallet and start asking questions. No account creation, no gas, no faucet, no waiting.

**The demonstration audience widens.** A judge with MetaMask can try the product in under a minute. That is the difference between a project people read about and a project people use.

**The cross-chain claim becomes real.** The trade genuinely starts on one chain and ends on another.

**The swap flow loses its on-chain complexity.** The RHEA route needed two wallet transactions, two storage deposits, a minimum-output check, and careful receipt inspection. The signed-intent route needs one signature.

**The settlement authority changes, and this has to be stated honestly.** With the RHEA route, the outcome was read from the NEAR chain directly. With Intents, the outcome is read from the 1Click status endpoint, which reports the settlement that happened inside the verifier contract. The principle that the network decides the outcome still holds, because the status endpoint is reporting an on-chain settlement rather than asking anyone. But it is one step removed, and the readme should say so rather than implying the application reads the chain itself.

**The RHEA route becomes optional.** The engine interface exists for exactly this, so the route can be added back as a second implementation later, available only to NEAR users who want a trade that settles entirely on the NEAR chain with no third party in the middle. For the first release it is not built, and the reason is that three chains with no gas beats one chain with a deterministic settlement property that most users cannot tell the difference between.
