"use client";

import { Button } from "@/components/atoms/Button";

/**
 * Last-resort boundary for errors in the root layout itself. Must render
 * its own html/body because the layout is the thing that failed.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main
          style={{
            margin: "0 auto",
            minHeight: "100dvh",
            maxWidth: 720,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "40px 16px",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 500 }}>
            Something went wrong.
          </h1>
          <p style={{ marginTop: 6, fontSize: 13.5, opacity: 0.75 }}>
            The app hit an error and could not render. Reload to try again.
          </p>
          <div
            style={{ marginTop: 20, display: "flex", gap: 8 }}
          >
            <Button type="button" variant="secondary" size="md" onClick={reset}>
              Try again
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}
