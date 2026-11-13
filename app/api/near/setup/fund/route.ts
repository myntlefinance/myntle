import { NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import { requireSession } from "@/lib/auth/session";
import {
  countNearSetupGrantsSince,
  createNearSetupGrant,
  updateNearSetupGrant,
} from "@/lib/db/near-setup";
import {
  getNearSetupState,
  readSetupPublicKey,
} from "@/lib/intents/near-setup-server";
import {
  nearSetupConfigured,
  nearSetupDailyGrants,
  nearSetupFaucetReady,
  nearSetupGrantYocto,
  sendNearSetupGrant,
} from "@/lib/near/intents-keys";

const NO_STORE = { "cache-control": "no-store" };
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sends the one-time network fee.
 *
 * The row is created before the transfer and `unique (account_id, public_key)`
 * is the hard stop. An existing grant of any status returns without sending,
 * even when the account's balance is now zero.
 */
export async function POST(req: Request) {
  const session = await requireSession(req);
  if (!session) {
    return NextResponse.json(
      { error: "Log in to set up your super account." },
      { status: 401, headers: NO_STORE },
    );
  }
  if (session.chain !== "near" || session.accountKind !== "wallet") {
    return NextResponse.json(
      { needsSetup: false, registered: false },
      { headers: NO_STORE },
    );
  }

  const userLimit = checkRateLimit(
    `near-setup-fund:${session.userId}`,
    3,
    60 * 60_000,
  );
  const ipLimit = checkRateLimit(
    `near-setup-fund-ip:${clientIp(req)}`,
    10,
    60 * 60_000,
  );
  if (userLimit.limited || ipLimit.limited) {
    const retryAfterMs = Math.max(
      userLimit.retryAfterMs,
      ipLimit.retryAfterMs,
    );
    return NextResponse.json(
      { error: "The network fee was requested too often. Try again later." },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "retry-after": String(Math.ceil(retryAfterMs / 1000)),
        },
      },
    );
  }

  const publicKey = await readSetupPublicKey(req);

  let state;
  try {
    state = await getNearSetupState(session, publicKey);
  } catch {
    return NextResponse.json(
      { error: "NEAR setup is unavailable right now. Try again later." },
      { status: 502, headers: NO_STORE },
    );
  }

  if (!state.needsSetup) {
    return NextResponse.json(state, { headers: NO_STORE });
  }
  if (!state.needsFunding || !state.publicKey) {
    // A grant already exists, the account already has gas, or the key could
    // not be resolved. None of these may send a second transfer.
    return NextResponse.json(state, { headers: NO_STORE });
  }

  if (!nearSetupConfigured()) {
    return NextResponse.json(
      { error: "NEAR setup is unavailable right now. Try again later." },
      { status: 503, headers: NO_STORE },
    );
  }

  const amount = state.amountYocto ?? nearSetupGrantYocto();

  try {
    const recent = await countNearSetupGrantsSince(
      new Date(Date.now() - DAY_MS).toISOString(),
    );
    if (recent >= nearSetupDailyGrants()) {
      return NextResponse.json(
        { error: "NEAR setup is unavailable right now. Try again later." },
        { status: 503, headers: NO_STORE },
      );
    }

    if (!(await nearSetupFaucetReady(amount))) {
      return NextResponse.json(
        { error: "NEAR setup is unavailable right now. Try again later." },
        { status: 503, headers: NO_STORE },
      );
    }

    const { created, grant } = await createNearSetupGrant({
      userId: session.userId,
      accountId: session.address,
      publicKey: state.publicKey,
      amount,
    });
    if (!created) {
      const current = await getNearSetupState(session, state.publicKey);
      return NextResponse.json(current, { headers: NO_STORE });
    }

    let txHash: string;
    try {
      const sent = await sendNearSetupGrant({
        receiverId: session.address,
        amountYocto: grant.amount,
      });
      txHash = sent.hash;
      await updateNearSetupGrant(grant.id, {
        status: "final",
        txHash,
        error: null,
      });
    } catch {
      await updateNearSetupGrant(grant.id, {
        status: "failed",
        error: "The network-fee transfer could not be sent.",
      });
      return NextResponse.json(
        {
          error:
            "The network fee could not be sent. Add a little NEAR to this account and try again.",
          needsSetup: true,
          registered: false,
          publicKey: state.publicKey,
          amountNear: state.amountNear,
          amountYocto: state.amountYocto,
          hasGas: false,
          needsFunding: false,
          grant: {
            status: "failed",
            txHash: null,
            error: "The network-fee transfer could not be sent.",
          },
        },
        { status: 502, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      {
        ...state,
        needsFunding: false,
        grant: { status: "final", txHash, error: null },
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "NEAR setup is unavailable right now. Try again later." },
      { status: 502, headers: NO_STORE },
    );
  }
}
