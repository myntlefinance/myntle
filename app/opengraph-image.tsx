import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/* The card every chat client unfurls: X, Discord, Telegram, Slack, Signal and
 * iMessage all read this one image. It carries the mark and a single line from
 * the home screen, and deliberately not the title or description, so a preview
 * says two things instead of repeating one.
 *
 * The colours are the dark theme's tokens from globals.css, converted to hex
 * because the image renderer does not take oklch. */
const PAGE = "#17181a"; // --page, dark
const INK = "#f2f3f4"; // --ink, dark

export const alt =
  "The Myntle mark above the words: Your money, in plain language.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interSemiBold = await readFile(
  join(process.cwd(), "assets/fonts/Inter-SemiBold.ttf"),
);
const mark = await readFile(join(process.cwd(), "public/myntle-logo.svg"), {
  encoding: "base64",
});

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          padding: 72,
          background: PAGE,
          color: INK,
          fontFamily: "Inter",
        }}
      >
        <img
          src={`data:image/svg+xml;base64,${mark}`}
          width={88}
          height={88}
          alt=""
        />
        <div
          style={{
            display: "flex",
            maxWidth: 1000,
            fontSize: 54,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.032em",
            textAlign: "center",
          }}
        >
          Your money, in plain language
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Inter",
          data: interSemiBold,
          weight: 600,
          style: "normal",
        },
      ],
    },
  );
}
