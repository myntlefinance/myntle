#!/usr/bin/env python3
"""Generate the walkthrough voice with Eleven v4 through OpenRouter.

One file per line: lines/NN.txt -> final/NN.mp3. Existing files are skipped,
so a rerun only pays for what is missing. --force regenerates everything,
--only 09 regenerates one line, --dry-run prints the text and cost.

The tag prefixes are the only direction in the script. Eleven v4 reads them as
performance notes; the plain text stays clean in lines/, so the same words can
be reused with another voice later.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

MODEL = "elevenlabs/eleven-v4"
URL = "https://openrouter.ai/api/v1/audio/speech"
KEY_URL = "https://openrouter.ai/api/v1/key"
ROOT = Path(__file__).resolve().parent

# The blog's own examples: [warm] for the open and the close, and nothing that
# risks being read aloud. The rest of the performance comes from punctuation.
TAGS = {
    "01": "[warm] ",
    "14": "[warm] ",
}

PRICE_PER_MILLION = 80.0


def lines() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for path in sorted((ROOT / "lines").glob("*.txt")):
        text = path.read_text(encoding="utf-8").strip()
        if text:
            out.append((path.stem, TAGS.get(path.stem, "") + text))
    return out


def check_key(key: str) -> None:
    req = urllib.request.Request(KEY_URL, headers={"Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            json.load(res)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        sys.exit(f"OpenRouter rejected the key ({exc.code}): {body}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="george", help="ElevenLabs voice id (default: george)")
    ap.add_argument("--force", action="store_true", help="regenerate files that already exist")
    ap.add_argument("--only", help="one line number, for example 09")
    ap.add_argument("--dry-run", action="store_true", help="print the text and cost, call nothing")
    ap.add_argument("--check", action="store_true", help="validate the key and exit")
    args = ap.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        sys.exit("OPENROUTER_API_KEY is not set.")
    if args.check:
        check_key(key)
        print("key ok")
        return

    selected = [(n, t) for n, t in lines() if args.only is None or n == args.only]
    if not selected:
        sys.exit("no lines matched")

    out_dir = ROOT / "final"
    out_dir.mkdir(exist_ok=True)

    total_chars = 0
    made = 0
    for n, text in selected:
        target = out_dir / f"{n}.mp3"
        total_chars += len(text)
        if target.exists() and not args.force:
            print(f"{n}  skip  {len(text):4d} chars  {target.name}")
            continue
        print(f"{n}  say   {len(text):4d} chars  {text[:72]}...")
        if args.dry_run:
            continue

        body = json.dumps(
            {
                "model": MODEL,
                "input": text,
                "voice": args.voice,
                "response_format": "mp3",
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            URL,
            data=body,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as res:
                audio = res.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            sys.exit(f"{n}: OpenRouter failed ({exc.code}): {detail}")
        if not audio:
            sys.exit(f"{n}: empty response")
        target.write_bytes(audio)
        made += 1
        print(f"      wrote {target.name}  {len(audio):,} bytes")

    cost = total_chars * PRICE_PER_MILLION / 1_000_000
    print(f"\n{total_chars:,} characters, about ${cost:.3f} at ${PRICE_PER_MILLION:.0f}/M. {made} generated.")


if __name__ == "__main__":
    main()
