import { beforeEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { CAPABILITIES, createTools } from "./registry";
import { TOOL_APPROVALS } from "./approval-policy";

const signedIn = {
  activeAddress: "0x32596df10ff2ac5acde8406e6adcc8d047921073",
  activeChain: "evm",
};

describe("tool capabilities", () => {
  beforeEach(() => {
    // The prompt builder prefers this override when it is set, which would
    // hide the assembled sections from the checks below.
    delete process.env.SYSTEM_INSTRUCTIONS;
  });

  it("declares every registered tool exactly once", () => {
    const registered = Object.keys(createTools(signedIn)).sort();
    const declared = CAPABILITIES.map((c) => c.tool).sort();

    expect(declared).toEqual(registered);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("describes every capability in the assembled system prompt", () => {
    const prompt = buildSystemPrompt(signedIn).toLowerCase();

    for (const capability of CAPABILITIES) {
      for (const term of capability.promptTerms) {
        expect(
          prompt,
          `${capability.tool} is not described: the prompt is missing "${term}"`,
        ).toContain(term.toLowerCase());
      }
    }
  });

  it("gates every tool that moves money behind user approval", () => {
    const acting = CAPABILITIES.filter((c) => c.tier === "act");

    expect(acting.map((c) => c.tool)).toEqual([
      "prepare_swap",
      "prepare_limit_order",
      "prepare_deposit",
      "prepare_withdrawal",
    ]);
    for (const capability of acting) {
      expect(capability.approval, capability.tool).toBe("user-approval");
    }
  });

  it("configures exactly the user-approval capabilities on the route", () => {
    const acting = CAPABILITIES.filter((c) => c.approval === "user-approval")
      .map((c) => c.tool)
      .sort();

    expect(Object.keys(TOOL_APPROVALS).sort()).toEqual(acting);
    for (const tool of acting) {
      expect(
        TOOL_APPROVALS[tool as keyof typeof TOOL_APPROVALS],
      ).toBe("user-approval");
    }
  });

  it("makes a balance card name whose holdings it shows", () => {
    const balances = CAPABILITIES.find((c) => c.tool === "get_wallet_balances");

    // The card renders whichever address the tool used, so the declaration
    // has to keep the address in scope rather than assume the session's.
    expect(balances?.subject).toBe("any-address");
    expect(balances?.attribution).toBe("required");
  });

  it("keeps private reads bound to the session", () => {
    for (const capability of CAPABILITIES) {
      if (capability.tier === "read-private") {
        expect(capability.subject, capability.tool).toBe("session");
      }
    }
  });

  it("only lets an approved tool ask for a signature", () => {
    for (const capability of CAPABILITIES) {
      if (capability.approval === "user-approval") {
        expect(capability.tier, capability.tool).toBe("act");
      }
    }
  });
});
