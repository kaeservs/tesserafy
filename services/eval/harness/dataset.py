"""Loading and validating the labelled corpus.

A label points at a quote, not at character offsets. People cannot count
characters reliably, and a label whose offsets drift from the transcript is
worse than no label: it silently turns a correct prediction into a miss. So
the harness locates each quote in the transcript the same way the pipeline
does, and refuses to load a label it cannot find.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

KINDS = ("problem", "feature_request")


class DatasetError(Exception):
    """A corpus that cannot be trusted to grade anything."""


@dataclass(frozen=True)
class Label:
    kind: str
    quote: str
    segment_id: str
    start: int
    end: int
    note: str | None = None


@dataclass(frozen=True)
class Item:
    id: str
    transcript: Path
    labels: tuple[Label, ...]


@dataclass(frozen=True)
class Segment:
    id: str
    text: str


def load(path: Path) -> list[dict]:
    """Reads a JSONL corpus into raw dicts, with the line number on errors."""
    items: list[dict] = []
    with path.open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise DatasetError(f"{path.name} line {number}: {error}") from error
    if not items:
        raise DatasetError(f"{path.name} contains no items")
    return items


def resolve(
    raw: dict, segments: list[Segment], root: Path, kinds: tuple[str, ...] = KINDS
) -> Item:
    """Turns one raw item into labels anchored to real spans of real segments."""
    item_id = raw.get("id")
    if not item_id:
        raise DatasetError("an item has no id")

    source = raw.get("transcript")
    if not source:
        raise DatasetError(f"{item_id}: no transcript path")

    labels: list[Label] = []
    for index, raw_label in enumerate(raw.get("labels", []), start=1):
        kind = raw_label.get("kind")
        quote = (raw_label.get("quote") or "").strip()
        where = f"{item_id} label {index}"

        if kind not in kinds:
            raise DatasetError(f"{where}: kind must be one of {kinds}, got {kind!r}")
        if not quote:
            raise DatasetError(f"{where}: no quote")

        found = [(segment, span) for segment in segments if (span := locate(segment.text, quote))]
        if not found:
            raise DatasetError(
                f"{where}: quote not found in the transcript — {quote!r}. "
                "Labels must quote the transcript exactly."
            )
        if len(found) > 1:
            raise DatasetError(
                f"{where}: quote appears in {len(found)} segments — {quote!r}. "
                "Extend it until it identifies one."
            )

        segment, (start, end) = found[0]
        labels.append(
            Label(
                kind=kind,
                quote=segment.text[start:end],
                segment_id=segment.id,
                start=start,
                end=end,
                note=raw_label.get("note"),
            )
        )

    return Item(id=item_id, transcript=(root / source).resolve(), labels=tuple(labels))


def locate(text: str, quote: str) -> tuple[int, int] | None:
    """Exact match, or the same whitespace tolerance the extractor allows."""
    exact = text.find(quote)
    if exact != -1:
        return exact, exact + len(quote)

    pattern = r"\s+".join(re.escape(word) for word in quote.split())
    match = re.search(pattern, text)
    return (match.start(), match.end()) if match else None
