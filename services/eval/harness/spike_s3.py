"""Spike S3 — can a small model detect criteria from a short window?

    python -m harness.spike_s3 datasets/v1/criteria-windows.jsonl \
        --criteria datasets/criteria/discovery-v1.json \
        [--model claude-haiku-4-5] [--repeat 2] [--dry-run]

Three questions, one run:

  1. Accuracy — precision and recall per criterion, graded by the same span
     overlap rule as T3 (ADR 0009), so a detector that cites the wrong words
     is wrong however plausible its key.
  2. Latency — p50 and p95 against the 700 ms T1 budget in ADR 0002.
  3. Cache — whether the frozen prefix is actually being read back. A live
     45-minute call makes ~135 of these; a silently cold cache is the
     difference between the cost model and a surprise.

`--repeat` runs each window more than once: the first call of a conversation
writes the cache and the rest should read it, which is the pattern a live call
actually produces.
"""

from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from harness import dataset
from harness.match import Gold, Pairing, Prediction, Span, pair, score

EVAL_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = EVAL_ROOT.parent.parent


def detect(transcript: Path, criteria: Path, model: str | None) -> dict:
    command = ["pnpm", "--silent", "detect", str(transcript), "--criteria", str(criteria)]
    if model:
        command += ["--model", model]

    result = subprocess.run(
        command, cwd=REPO_ROOT, capture_output=True, text=True, shell=sys.platform == "win32"
    )
    if result.returncode != 0:
        raise RuntimeError(f"detect failed for {transcript.name}:\n{result.stderr.strip()}")
    return json.loads(result.stdout)


def to_predictions(payload: dict) -> list[Prediction]:
    return [
        Prediction(
            kind=o["criterion_key"],
            summary=f"{o['polarity']} ({o['confidence']}): {o['quote']}",
            spans=(Span(o["segment_id"], o["quote_start"], o["quote_end"]),),
        )
        for o in payload["observations"]
        # A contradiction is not a detection of the criterion; it is evidence
        # against it, and the labels here record presence only.
        if o["polarity"] == "supports"
    ]


def to_golds(item: dataset.Item) -> list[Gold]:
    return [
        Gold(kind=l.kind, quote=l.quote, span=Span(l.segment_id, l.start, l.end))
        for l in item.labels
    ]


def percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.0f}%"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("--criteria", type=Path, required=True)
    parser.add_argument("--model", default=None, help="defaults to the T1 model in packages/ai")
    parser.add_argument("--repeat", type=int, default=1, help="calls per window; >1 exercises the cache")
    parser.add_argument("--dry-run", action="store_true", help="validate labels, call nothing")
    args = parser.parse_args()

    criteria_path = (EVAL_ROOT / args.criteria).resolve()
    keys = tuple(c["key"] for c in json.loads(criteria_path.read_text(encoding="utf-8"))["criteria"])

    raw_items = dataset.load((EVAL_ROOT / args.corpus).resolve())

    pairings: list[Pairing] = []
    details: list[dict] = []
    latencies: list[int] = []
    cache_reads: list[int] = []
    tokens = {"input": 0, "output": 0, "cache_creation": 0, "cache_read": 0}
    model = detector = None
    rejected = 0

    for raw in raw_items:
        transcript = (EVAL_ROOT / raw["transcript"]).resolve()

        for attempt in range(args.repeat):
            if args.dry_run:
                payload = segments_only(transcript)
            else:
                payload = detect(transcript, criteria_path, args.model)
                usage = payload["usage"]
                latencies.append(usage["durationMs"])
                cache_reads.append(usage["cacheReadInputTokens"])
                tokens["input"] += usage["inputTokens"]
                tokens["output"] += usage["outputTokens"]
                tokens["cache_creation"] += usage["cacheCreationInputTokens"]
                tokens["cache_read"] += usage["cacheReadInputTokens"]
                rejected += len(payload["rejected"])
                model, detector = payload["model"], payload["detector"]

            segments = [dataset.Segment(s["id"], s["text"]) for s in payload["segments"]]
            item = dataset.resolve(raw, segments, EVAL_ROOT, keys)

            if args.dry_run:
                print(f"{item.id}: {len(item.labels)} label(s) resolved", file=sys.stderr)
                break

            # Only the first call of each window is scored; the repeats exist
            # to exercise the cache, not to weight a window more heavily.
            if attempt == 0:
                pairing = pair(to_predictions(payload), to_golds(item))
                pairings.append(pairing)
                details.append(
                    {
                        "id": item.id,
                        "false_positives": [
                            {"criterion": p.kind, "detail": p.summary} for p in pairing.false_positives
                        ],
                        "false_negatives": [
                            {"criterion": g.kind, "label": g.quote} for g in pairing.false_negatives
                        ],
                    }
                )

    if args.dry_run:
        print("Corpus is valid: every label resolves to exactly one span.", file=sys.stderr)
        return 0

    overall = score(pairings)
    by_criterion = {key: score(pairings, key) for key in keys}
    calls = len(latencies)

    report = {
        "measured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "spike": "S3",
        "corpus": str(args.corpus),
        "criteria": str(args.criteria),
        "windows": len(pairings),
        "calls": calls,
        "model": model,
        "detector": detector,
        "overall": overall.as_dict(),
        "by_criterion": {k: s.as_dict() for k, s in by_criterion.items()},
        "latency_ms": {
            "p50": statistics.median(latencies) if latencies else None,
            "p95": sorted(latencies)[max(0, int(len(latencies) * 0.95) - 1)] if latencies else None,
            "max": max(latencies) if latencies else None,
        },
        "cache": {
            "calls_with_cache_read": sum(1 for c in cache_reads if c > 0),
            "calls": calls,
            "tokens_read": tokens["cache_read"],
            "tokens_written": tokens["cache_creation"],
        },
        "tokens": tokens,
        "rejected_observations": rejected,
        "items_detail": details,
    }

    runs = EVAL_ROOT / "runs"
    runs.mkdir(exist_ok=True)
    stamp = report["measured_at"].replace(":", "").replace("-", "")
    out = runs / f"s3-{stamp}.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print()
    print(f"{len(pairings)} window(s), {calls} call(s) · {model}")
    print(f"{'':<24}{'precision':>12}{'recall':>10}{'f1':>8}")
    print(f"{'overall':<24}{percent(overall.precision):>12}{percent(overall.recall):>10}{percent(overall.f1):>8}")
    for key, s in by_criterion.items():
        print(f"{key:<24}{percent(s.precision):>12}{percent(s.recall):>10}{percent(s.f1):>8}")
    print()
    print(f"latency            p50 {report['latency_ms']['p50']} ms · p95 {report['latency_ms']['p95']} ms · budget 700 ms")
    print(f"cache              {report['cache']['calls_with_cache_read']}/{calls} calls read the prefix "
          f"({tokens['cache_read']} tokens read, {tokens['cache_creation']} written)")
    print(f"tokens             {tokens['input']} in / {tokens['output']} out")
    print(f"dropped quotes     {rejected}")
    print(f"written to         {out.relative_to(EVAL_ROOT)}")

    disagreements = [d for d in details if d["false_positives"] or d["false_negatives"]]
    if disagreements:
        print()
        print("Disagreements")
        for item in disagreements:
            print(f"  {item['id']}")
            for fp in item["false_positives"]:
                print(f"    + {fp['criterion']}: {fp['detail']}")
            for fn in item["false_negatives"]:
                print(f"    - {fn['criterion']} missed: {fn['label']!r}")
    return 0


def segments_only(transcript: Path) -> dict:
    result = subprocess.run(
        ["pnpm", "--silent", "ingest", str(transcript), "--dry-run", "--json"],
        cwd=REPO_ROOT, capture_output=True, text=True, shell=sys.platform == "win32",
    )
    if result.returncode != 0:
        raise RuntimeError(f"chunking failed for {transcript.name}:\n{result.stderr.strip()}")
    return json.loads(result.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
