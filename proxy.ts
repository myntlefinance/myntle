import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  // Your auth and session middleware goes here.
  return NextResponse.next();
}

export const config = {
  matcher: [
    {
      // The workflow runtime calls back into the app on this path. If the
      // proxy intercepts it, the run fails with an error about a detached
      // ArrayBuffer, which points nowhere near the cause.
      source: "/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)",
    },
  ],
};
