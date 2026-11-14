# Voice

The narration is **one continuous read** of the twelve sections, Eleven v4, voice `george`, saved at `final/full.mp3` (105.68 s, 1,934 characters). The picture is cut to the pauses in that read, so the performance carries from the opening line to the URL.

`final/lines.json` holds the start and end of each section, measured from the silences. That is what the composition uses for its cuts.

## Generate it again

```bash
cd demo/audio
python3 generate_full.py --check     # key and cost
python3 generate_full.py --force     # replace final/full.mp3
```

`--dry-run` prints the exact text and cost without calling the API. The script joins `lines/NN.txt` with `[pause]` and puts `[warm]` on the first and last section.

## Why one read

Separate requests reset the performance at every line: the intonation starts again and the join is a cut. One request keeps the pacing, breath and tone continuous; the edit follows it. The text is under the model's 10,000-character limit, so there is no stitching inside the generation either.

## Reusing it

- `final/full.mp3` is the master. Keep it; a new cut does not pay again.
- `final/lines.json` maps the twelve sections to their times.
- `lines/NN.txt` is the clean script, headers stripped.
- `generate.py` makes per-section files (`final/NN.mp3`) for a single-section fix. Use `--only 09 --force`.
- `lines-v1/` and `final/full-v1.mp3` are the earlier fourteen-line read, kept only for reference.

## Cost

1,934 characters at $80 per million is **$0.155**. The test key has $0.25; $0.2251 has been spent including the probe and the earlier read, leaving **$0.0249**. The current master cannot be regenerated on that key; a new key is needed for another pass.

## Pronunciation

The script uses **Myntle** and **myntle.xyz**, not the “Mintle” spelling from the draft. If the voice says the name wrong, the fix is a phonetic rewrite of just that word and a new read; the OpenRouter endpoint does not expose a pronunciation dictionary.
