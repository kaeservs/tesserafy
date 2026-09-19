"""Run the shipped extractor over a labelled corpus and score it.

    python -m harness.run datasets/v1/discovery-calls.jsonl [--limit N] [--dry-run]

Every run costs money and its result is only meaningful next to the thing it
measured, so each run records the detector version, the model, the date and
the token usage beside the numbers. A precision figure without those is a
number nobody can reproduce or compare.

Predictions come from `pnpm extract`, the same T0 + T3 path the product runs.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from harness import dataset
from harness.match import Gold, Pairing, Prediction, Span, pair, score

EVAL_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = EVAL_ROOT.parent.parent


def extract(transcript: Path) -> dict:
    """Runs the shipped extractor. stdout is JSON; stderr carries usage."""
    result = subprocess.run(
        ["pnpm", "--silent", "extract", str(transcript)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        shell=sys.platform == "win32",
    )
    if result.returncode != 0:
        raise RuntimeError(f"extract failed for {transcript.name}:\n{result.stderr.strip()}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"extract returned output that is not JSON for {transcript.name}: {error}\n"
            f"{result.stdout[:400]}"
        ) from error


def to_predictions(payload: dict) -> list[Prediction]:
    return [
        Prediction(
            kind=signal["kind"],
            summary=signal["summary"],
            spans=tuple(
                Span(e["segment_id"], e["quote_start"], e["quote_end"])
                for e in signal["evidence"]
            ),
        )
        for signal in payload["signals"]
    ]


def to_golds(item: dataset.Item) -> list[Gold]:
    return [
        Gold(kind=label.kind, quote=label.quote, span=Span(label.segment_id, label.start, label.end))
        for label in item.labels
    ]


def detail(item_id: str, pairing: Pairing) -> dict:
    """What matched and what did not, in the words of both sides."""
    return {
        "id": item_id,
        "matched": [
            {"kind": gold.kind, "label": gold.quote, "predicted": prediction.summary}
            for prediction, gold in pairing.matched
        ],
        "false_positives": [
            {
                "kind": p.kind,
                "summary": p.summary,
                "spans": [f"{s.segment_id}:{s.start}-{s.end}" for s in p.spans],
            }
            for p in pairing.false_positives
        ],
        "false_negatives": [{"kind": g.kind, "label": g.quote} for g in pairing.false_negatives],
    }


def percent(value: float | None) -> str:
    return "not measured" if value is None else f"{value * 100:.0f}%"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path, help="JSONL corpus, relative to services/eval")
    parser.add_argument("--limit", type=int, default=None, help="score only the first N items")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate the corpus and resolve every label without calling a model",
    )
    args = parser.parse_args()

    corpus_path = (EVAL_ROOT / args.corpus).resolve()
    raw_items = dataset.load(corpus_path)
    if args.limit:
        raw_items = raw_items[: args.limit]

    pairings: list[Pairing] = []
    details: list[dict] = []
    totals = {"input_tokens": 0, "output_tokens": 0}
    paraphrased = 0
    kept = 0
    detector = model = None

    for raw in raw_items:
        transcript = (EVAL_ROOT / raw["transcript"]).resolve()
        if not transcript.exists():
            raise dataset.DatasetError(f"{raw.get('id')}: transcript not found at {transcript}")

        if args.dry_run:
            # Resolve labels against the transcript's own segmentation. This is
            # what catches a label that quotes text no segment contains.
            payload = extract_segments_only(transcript)
        else:
            payload = extract(transcript)
            usage = payload.get("usage") or {}
            totals["input_tokens"] += usage.get("inputTokens", 0)
            totals["output_tokens"] += usage.get("outputTokens", 0)
            paraphrased += len(payload.get("rejected", []))
            kept += len(payload.get("signals", []))
            detector = payload.get("detector")
            model = payload.get("model")

        segments = [dataset.Segment(s["id"], s["text"]) for s in payload["segments"]]
        item = dataset.resolve(raw, segments, EVAL_ROOT)
        print(f"{item.id}: {len(item.labels)} label(s) resolved", file=sys.stderr)

        if args.dry_run:
            continue

        pairing = pair(to_predictions(payload), to_golds(item))
        pairings.append(pairing)
        details.append(detail(item.id, pairing))

    if args.dry_run:
        print("Corpus is valid: every label resolves to exactly one span.", file=sys.stderr)
        return 0

    overall = score(pairings)
    by_kind = {kind: score(pairings, kind) for kind in dataset.KINDS}

    report = {
        "measured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "corpus": str(args.corpus),
        "items": len(pairings),
        "detector": detector,
        "model": model,
        "overall": overall.as_dict(),
        "by_kind": {kind: s.as_dict() for kind, s in by_kind.items()},
        # Claims the extractor made and then dropped because the quote was not
        # verbatim. Not an error rate — those never reach a user — but the
        # clearest signal that a prompt change is pushing the model to
        # paraphrase.
        "paraphrase_rate": (paraphrased / (kept + paraphrased)) if (kept + paraphrased) else None,
        "criterion_correctness": "not measured — needs T1 detectors and criteria seed data",
        "usage": totals,
        # Counts say how well it did; only this says what it got wrong, which
        # is the half that tells you what to change.
        "items_detail": details,
    }

    runs = EVAL_ROOT / "runs"
    runs.mkdir(exist_ok=True)
    stamp = report["measured_at"].replace(":", "").replace("-", "")
    out = runs / f"{stamp}.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print()
    print(f"{report['items']} conversation(s) · {detector} · {model}")
    print(f"{'':<18}{'precision':>12}{'recall':>10}{'f1':>8}")
    for name, s in [("overall", overall), *by_kind.items()]:
        print(f"{name:<18}{percent(s.precision):>12}{percent(s.recall):>10}{percent(s.f1):>8}")
    print()
    print(f"paraphrase rate    {percent(report['paraphrase_rate'])}")
    print(f"tokens             {totals['input_tokens']} in / {totals['output_tokens']} out")
    print(f"written to         {out.relative_to(EVAL_ROOT)}")

    disagreements = [d for d in details if d["false_positives"] or d["false_negatives"]]
    if disagreements:
        print()
        print("Disagreements")
        for item in disagreements:
            print(f"  {item['id']}")
            for fp in item["false_positives"]:
                print(f"    + [{fp['kind']}] {fp['summary']}")
            for fn in item["false_negatives"]:
                print(f"    - [{fn['kind']}] missed: {fn['label']!r}")
    return 0


def extract_segments_only(transcript: Path) -> dict:
    """Chunking without the model, for --dry-run corpus validation."""
    result = subprocess.run(
        ["pnpm", "--silent", "ingest", str(transcript), "--dry-run", "--json"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        shell=sys.platform == "win32",
    )
    if result.returncode != 0:
        raise RuntimeError(f"chunking failed for {transcript.name}:\n{result.stderr.strip()}")
    return json.loads(result.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
