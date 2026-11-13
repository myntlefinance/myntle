import { describe, expect, it } from "vitest";
import {
  createPrepareDepositTool,
  prepareDepositInputSchema,
  PREPARE_DEPOSIT_CAPABILITY,
} from "./deposit";
import { TOOL_APPROVALS } from "../approval-policy";
import { createTools } from "../registry";

const ASSET_ID =
  "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

describe("prepare_deposit", () => {
  it("is registered as a user-approval capability", () => {
    const registered = createTools();
    expect(registered.prepare_deposit).toBeDefined();

    expect(PREPARE_DEPOSIT_CAPABILITY).toMatchObject({
      tool: "prepare_deposit",
      tier: "act",
      subject: "session",
      approval: "user-approval",
    });
    expect(TOOL_APPROVALS.prepare_deposit).toBe("user-approval");
  });

  it("acknowledges only, with no address and no payload", async () => {
    const tool = createPrepareDepositTool();
    const result = await tool.execute!(
      { assetId: ASSET_ID, amount: "1000000", source: "external" },
      { toolCallId: "call-deposit", messages: [], context: {} },
    );

    expect(result).toEqual({
      acknowledged: true,
      action: "deposit",
      assetId: ASSET_ID,
      amount: "1000000",
      note: "The interface will show the exact deposit address.",
    });
    expect(result).not.toHaveProperty("depositAddress");
    expect(result).not.toHaveProperty("intent");
    expect(JSON.stringify(result).toLowerCase()).not.toContain("confidential");
  });

  it("requires a positive whole amount in the smallest unit", () => {
    for (const amount of ["0", "-1", "1.5", "", "01", "1e6"]) {
      expect(
        prepareDepositInputSchema.safeParse({ assetId: ASSET_ID, amount }).success,
        `${amount} must be rejected`,
      ).toBe(false);
    }
    expect(
      prepareDepositInputSchema.safeParse({ assetId: ASSET_ID, amount: "1" })
        .success,
    ).toBe(true);
  });
});
