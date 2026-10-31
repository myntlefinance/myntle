import { NextRequest, NextResponse } from "next/server";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  const id = req.cookies.get(SESSION_COOKIE)?.value;
  if (!id) return NextResponse.json({ authenticated: false });
  const session = getSession(decodeURIComponent(id));
  if (!session) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    chain: session.chain,
    address: session.address,
  });
}
