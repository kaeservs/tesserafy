"""Labelling aids. The corpus is the binding constraint, so this is friction.

    python -m harness.label --check datasets/v1/criteria-windows.jsonl
    python -m harness.label --worksheet datasets/v1/transcripts/acme-discovery.vtt \
        [--criteria ../../criteria/discovery-v2.json]

Two jobs, both mechanical, both currently done by hand.

`--check` resolves every label in a corpus and reports *all* of the failures.
`dataset.resolve()` raises on the first one, which is right for a harness that
must refuse to grade against a corpus it cannot trust, and wrong for a person
part-way through adding twenty labels: it costs one round trip per mistake.
This says everything wrong at once, and for a quote that does not resolve it
says which kind of wrong — not found, or found in more than one place — and
shows the nearest line so a typo or a paraphrase is obvious.

`--worksheet` prints a transcript as the labeller needs to see it: one line
per segment, with the criteria definitions above it. Quotes have to match the
transcript exactly, so the only reliable way to write one is to copy it, and
the only reliable way to copy it is to have it in front of you.

Neither mode uses a model, deliberately. Labels proposed by a detector and
confirmed by a person are labels that agree with the detector about what is
worth looking at, and the gaps they share stay invisible. The corpus grades
the detector; it must not be drawn by it.
"""

from __future__ import annotations

import argparse
import json
import sys
from difflib import SequenceMatcher
from pathlib import Path

from harness import dataset
from harness.spike_s3 import segments_only

EVAL_ROOT = Path(__file__).resolve().parent.parent


def segments_of(transcript: Path) -> list[dataset.Segment]:
    """The same segments the pipeline would produce, from the same chunker.

    Through `pnpm ingest --dry-run --json` rather than a VTT parser written
    here. A second parser would be a second opinion about where a segment
    begins, and a label anchored to the wrong side of that disagreement is a
    label that silently grades a correct prediction as a miss. No model is
    called, so checking a corpus costs nothing.
    """
    # Absolute: the chunker runs from the repo root, so a path relative to
    # the eval directory would resolve against the wrong place.
    payload = segments_only(transcript.resolve())
    return [dataset.Segment(s["id"], s["text"]) for s in payload["segments"]]


def nearest(segments: list[dataset.Segment], quote: str) -> tuple[dataset.Segment, float] | None:
    """The segment a quote most nearly matches, for diagnosing a near miss.

    Scored by how much of the quote is found in the segment, not by how
    similar the two strings are overall. Overall similarity punishes a long
    segment for being long, so the line that actually contains the near-match
    loses to a short unrelated one — which is worse than showing nothing,
    because it sends the labeller to the wrong sentence.
    """
    best: tuple[dataset.Segment, float] | None = None
    for segment in segments:
        match = SequenceMatcher(None, quote.lower(), segment.text.lower()).find_longest_match()
        share = match.size / len(quote) if quote else 0.0
        if best is None or share > best[1]:
            best = (segment, share)
    return best


def check(corpus: Path) -> int:
    # Transcript paths in the corpus are relative to the eval root, the same
    # way the harness resolves them. Anything else quietly looks in the wrong
    # place and reports every transcript as missing.
    root = EVAL_ROOT
    items = dataset.load(corpus)

    problems = 0
    labels = 0

    for raw in items:
        item_id = raw.get("id") or "(no id)"
        source = raw.get("transcript")
        if not source:
            print(f"  {item_id}: no transcript path")
            problems += 1
            continue

        transcript = (root / source).resolve()
        if not transcript.exists():
            print(f"  {item_id}: transcript not found at {transcript}")
            problems += 1
            continue

        segments = segments_of(transcript)

        for index, raw_label in enumerate(raw.get("labels", []), start=1):
            labels += 1
            kind = raw_label.get("kind")
            quote = (raw_label.get("quote") or "").strip()
            where = f"  {item_id} label {index}"

            if not quote:
                print(f"{where}: no quote")
                problems += 1
                continue

            found = [
                segment for segment in segments if dataset.locate(segment.text, quote) is not None
            ]

            if len(found) == 1:
                continue

            if not found:
                close = nearest(segments, quote)
                print(f"{where}: not found — {quote!r}")
                if close and close[1] > 0.3:
                    # A near miss is nearly always a paraphrase or a dropped
                    # word rather than the wrong segment, and showing the line
                    # is faster than any message describing it.
                    print(f"      nearest line: {close[0].text}")
            else:
                print(f"{where}: appears in {len(found)} segments — {quote!r}")
                print("      extend it until it identifies one:")
                for segment in found[:3]:
                    print(f"        {segment.text}")
            problems += 1

    print(f"\n{labels} label(s) checked, {problems} problem(s).")
    if problems == 0:
        print("Every quote resolves to exactly one segment. The harness will load this.")
    return 1 if problems else 0


def worksheet(transcript: Path, criteria: Path | None) -> int:
    if criteria:
        loaded = json.loads(criteria.read_text(encoding="utf-8"))
        name = loaded.get("engagementType") or loaded.get("engagement_type") or criteria.stem
        version = loaded.get("version", "")
        print(f"# {name} v{version}\n")
        for criterion in loaded.get("criteria", []):
            print(f"{criterion['key']}")
            print(f"    {criterion['definition']}\n")

    print(f"# {transcript.name}\n")
    for segment in segments_of(transcript):
        print(segment.text)

    print(
        "\n# Copy a quote exactly. It must appear in one segment only — "
        "extend it rather than adding offsets.\n"
        "# Then: python -m harness.label --check <corpus.jsonl>"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", type=Path, help="a corpus .jsonl to validate")
    parser.add_argument("--worksheet", type=Path, help="a transcript to print for labelling")
    parser.add_argument("--criteria", type=Path, help="criteria to print above a worksheet")
    args = parser.parse_args(argv)

    if args.check:
        return check(args.check)
    if args.worksheet:
        return worksheet(args.worksheet, args.criteria)

    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
