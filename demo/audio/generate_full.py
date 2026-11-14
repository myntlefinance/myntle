#!/usr/bin/env python3
"""Generate the walkthrough as one continuous read.

The shipped voice is a single request, so the performance carries across every
sentence. lines/NN.txt is joined with [pause] between lines, which is what the
edit cuts against. Per-line files can still be made with generate.py.

    python3 generate_full.py --check
    python3 generate_full.py
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
OUT = ROOT / "final" / "full.mp3"
PRICE_PER_MILLION = 80.0


def script() -> str:
    files = sorted((ROOT / "lines").glob("*.txt"))
    if not files:
        sys.exit("no lines found")
    parts: list[str] = []
    for i, path in enumerate(files):
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            sys.exit(f"{path.name} is empty")
        if i == 0 or i == len(files) - 1:
            text = "[warm] " + text
        parts.append(text)
    return " [pause] ".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="george")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        sys.exit("OPENROUTER_API_KEY is not set.")
    text = script()
    cost = len(text) * PRICE_PER_MILLION / 1_000_000

    if args.check:
        req = urllib.request.Request(KEY_URL, headers={"Authorization": f"Bearer {key}"})
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                json.load(res)
        except urllib.error.HTTPError as exc:
            sys.exit(f"OpenRouter rejected the key ({exc.code}): {exc.read().decode('utf-8', 'replace')}")
        print(f"key ok · script {len(text):,} chars · about ${cost:.3f}")
        return

    print(f"{len(text):,} chars, about ${cost:.3f}, voice {args.voice}")
    if args.dry_run:
        print(text)
        return
    if OUT.exists() and not args.force:
        sys.exit(f"{OUT} exists; pass --force to replace it")

    body = json.dumps(
        {"model": MODEL, "input": text, "voice": args.voice, "response_format": "mp3"}
    ).encode("utf-8")
    req = urllib.request.Request(
        URL,
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as res:
            audio = res.read()
    except urllib.error.HTTPError as exc:
        sys.exit(f"OpenRouter failed ({exc.code}): {exc.read().decode('utf-8', 'replace')}")
    if not audio:
        sys.exit("empty response")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_bytes(audio)
    print(f"wrote {OUT} · {len(audio):,} bytes")


if __name__ == "__main__":
    main()
