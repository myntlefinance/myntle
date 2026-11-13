import { tool } from "ai";
import { z } from "zod";
import { NameInputError } from "@/lib/names/binding";
import { MAX_NAME_INPUT_LENGTH, nameChainForInput } from "@/lib/names/detect";
import {
  isNameResolutionError,
  type NameChain,
  type ResolvedName,
} from "@/lib/ports/names";
import type { Capability } from "../capability";

/**
 * Read-only name resolution for the assistant.
 *
 * These tools return a public resolved address, which is the answer the user
 * asked for. They never read or return the connected wallet, balances, or any
 * session-bound account, and they cannot sign. There is no address input: a
 * caller asks a name, and the tool answers with the address the chain holds.
 */

export const RESOLVE_ENS_NAME_CAPABILITY: Capability = {
  tool: "resolve_ens_name",
  tier: "read-public",
  subject: "any-address",
  approval: "none",
  attribution: "required",
  promptTerms: ["resolve_ens_name", ".eth name"],
};

export const RESOLVE_SNS_NAME_CAPABILITY: Capability = {
  tool: "resolve_sns_name",
  tier: "read-public",
  subject: "any-address",
  approval: "none",
  attribution: "required",
  promptTerms: ["resolve_sns_name", ".sns name"],
};

const FAILURE_MESSAGES = {
  unregistered: "That name is not registered.",
  invalid: "That name is not valid. Check the ending and try again.",
  unavailable: "Name lookup is unavailable. Try again shortly.",
} as const;

type NameFailureStatus = keyof typeof FAILURE_MESSAGES;

type NameLookupResult =
  | {
      status: "resolved";
      name: string;
      address: string;
      chain: NameChain;
      resolvedAt: string;
    }
  | {
      status: NameFailureStatus;
      name: string;
      chain: NameChain;
      message: string;
    };

function nameSchema(description: string) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(MAX_NAME_INPUT_LENGTH)
      .describe(description),
  });
}

/**
 * Resolves one name through the shared resolver port and translates its
 * closed taxonomy into the three failure statuses this tool exposes.
 *
 * `.sol` is held as unavailable by the resolver during the registry
 * transition. It is answered here as unavailable without a read attempt, so
 * this tool never enables `.sol`; every other suffix is invalid before any
 * network call, exactly as `nameChainForInput` defines it.
 */
async function resolveFresh(
  name: string,
  chain: NameChain,
): Promise<ResolvedName> {
  if (name.length > MAX_NAME_INPUT_LENGTH) throw new NameInputError("invalid");
  if (chain === "solana" && name.toLowerCase().endsWith(".sol")) {
    throw new NameInputError("unavailable");
  }
  if (nameChainForInput(name) !== chain) throw new NameInputError("invalid");

  const { getNameResolverPort } = await import("@/lib/adapters/registry");
  let hit: ResolvedName | null;
  try {
    hit = await getNameResolverPort().resolveName(chain, name);
  } catch (error) {
    // A typed resolver failure is the answer. Anything else is a real
    // failure, so it reaches the framework and the row shows a failed tool
    // rather than a successful lookup with no address.
    if (!isNameResolutionError(error)) throw error;
    throw new NameInputError(
      error.kind === "invalid_input" ? "invalid" : "unavailable",
    );
  }
  if (hit === null) throw new NameInputError("unregistered");
  return hit;
}

async function lookup(
  rawName: string,
  chain: NameChain,
): Promise<NameLookupResult> {
  const name = rawName.trim();
  if (name.length === 0) {
    return {
      status: "invalid",
      name,
      chain,
      message: FAILURE_MESSAGES.invalid,
    };
  }
  try {
    const hit = await resolveFresh(name, chain);
    return {
      status: "resolved",
      name: hit.name,
      address: hit.address,
      chain,
      resolvedAt: hit.resolvedAt,
    };
  } catch (error) {
    if (error instanceof NameInputError) {
      return {
        status: error.reason,
        name,
        chain,
        message: FAILURE_MESSAGES[error.reason],
      };
    }
    throw error;
  }
}

export function createResolveEnsNameTool() {
  return tool({
    description:
      "Resolve a .eth name to the public EVM address it points to. Use this only when the user asks what address a name resolves to: the balance, quote, swap, and withdrawal tools resolve a name they are given, so do not add a lookup first. Pass the name unchanged. Only .eth is supported. This reads public chain data and never touches the connected wallet or signs anything.",
    inputSchema: nameSchema(
      "The .eth name to resolve, passed unchanged. Only .eth names are supported.",
    ),
    execute: async ({ name }) => lookup(name, "evm"),
  });
}

export function createResolveSnsNameTool() {
  return tool({
    description:
      "Resolve a .sns name to the public Solana address it points to. Use this only when the user asks what address a name resolves to: the balance, quote, swap, and withdrawal tools resolve a name they are given, so do not add a lookup first. Pass the name unchanged. Only .sns is supported; .sol is not. This reads public chain data and never touches the connected wallet or signs anything.",
    inputSchema: nameSchema(
      "The .sns name to resolve, passed unchanged. Only .sns names are supported; .sol is not.",
    ),
    execute: async ({ name }) => lookup(name, "solana"),
  });
}

export const resolveEnsName = createResolveEnsNameTool();
export const resolveSnsName = createResolveSnsNameTool();
