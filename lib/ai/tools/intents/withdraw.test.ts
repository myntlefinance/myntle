import { describe, expect, it } from "vitest";
import {
  createPrepareWithdrawalTool,
  prepareWithdrawalInputSchema,
  PREPARE_WITHDRAWAL_CAPABILITY,
} from "./withdraw";
import { TOOL_APPROVALS } from "../approval-policy";
import { createTools } from "../registry";

const ASSET =
  "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";
const DESTINATION = "0xc8aEcA3431542a1340D7Ef0EEb4684311b5A3148";

describe("prepare_withdrawal", () => {
  it("is registered as a user-approval capability", () => {
    const registered = createTools();
    expect(registered.prepare_withdrawal).toBeDefined();

    expect(PREPARE_WITHDRAWAL_CAPABILITY).toMatchObject({
      tool: "prepare_withdrawal",
      tier: "act",
      subject: "session",
      approval: "user-approval",
      attribution: "required",
    });
    expect(TOOL_APPROVALS.prepare_withdrawal).toBe("user-approval");
  });

  it("acknowledges only, with no quote, address, payload, or figures", async () => {
    const tool = createPrepareWithdrawalTool();
    const result = await tool.execute!(
      {
        fromAssetId: ASSET,
        amount: "500000",
        destinationAddress: DESTINATION,
      },
      { toolCallId: "call-withdraw", messages: [], context: {} },
    );

    expect(result).toEqual({
      acknowledged: true,
      action: "withdraw",
      fromAssetId: ASSET,
      toAssetId: ASSET,
      amount: "500000",
      destination: DESTINATION,
      mode: "confidential-withdrawal",
      note: "The interface will show the destination and the fee from the stored quote. Do not call prepare_withdrawal again for this withdrawal unless the user asks for a new one.",
    });
    for (const forbidden of [
      "quoteId",
      "depositAddress",
      "intent",
      "figures",
      "recipientType",
      "amountOut",
    ]) {
      expect(result).not.toHaveProperty(forbidden);
    }
  });

  it("requires a positive whole amount in the smallest unit", () => {
    for (const amount of ["0", "-1", "1.5", "", "01", "1e6"]) {
      expect(
        prepareWithdrawalInputSchema.safeParse({
          fromAssetId: ASSET,
          amount,
          destinationAddress: DESTINATION,
        }).success,
        `${amount} must be rejected`,
      ).toBe(false);
    }
    expect(
      prepareWithdrawalInputSchema.safeParse({
        fromAssetId: ASSET,
        amount: "1",
        destinationAddress: DESTINATION,
      }).success,
    ).toBe(true);
  });

  it("requires a destination and an asset", () => {
    expect(
      prepareWithdrawalInputSchema.safeParse({
        fromAssetId: "",
        amount: "1",
        destinationAddress: DESTINATION,
      }).success,
    ).toBe(false);
    expect(
      prepareWithdrawalInputSchema.safeParse({
        fromAssetId: ASSET,
        amount: "1",
        destinationAddress: "",
      }).success,
    ).toBe(false);
  });
});
