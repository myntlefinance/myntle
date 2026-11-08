import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  // The app layout renders the first-paint shell, and a layout cannot read
  // search params. Forward the portfolio tab as a request header so the
  // shell is rendered with the same tab the server page will open, instead
  // of painting the wallet rows and switching a beat after hydration.
  const headers = new Headers(request.headers);
  if (request.nextUrl.pathname === "/portfolio") {
    headers.set("x-portfolio-tab", request.nextUrl.searchParams.get("tab") ?? "");
  } else {
    headers.delete("x-portfolio-tab");
  }
  return NextResponse.next({ request: { headers } });
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
