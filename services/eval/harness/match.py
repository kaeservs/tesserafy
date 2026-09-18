"""Matching predictions to labels, and the metrics that follow.

A prediction matches a label when the kind agrees and the prediction's
evidence overlaps the labelled span in the same segment. That is deliberate:
the product's claim is that every signal is backed by the words it came from,
so a signal that quotes the wrong sentence is wrong even when its summary
reads well.

No model is involved in scoring. An LLM judge would grade paraphrase nicely
and move the number every time the judge changed, which makes a series of
measurements incomparable — and a metric you cannot compare across weeks
cannot tell you whether a prompt change helped.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Span:
    segment_id: str
    start: int
    end: int

    def overlap(self, other: "Span") -> int:
        if self.segment_id != other.segment_id:
            return 0
        return max(0, min(self.end, other.end) - max(self.start, other.start))


@dataclass(frozen=True)
class Prediction:
    kind: str
    summary: str
    spans: tuple[Span, ...]


@dataclass(frozen=True)
class Gold:
    kind: str
    quote: str
    span: Span


@dataclass(frozen=True)
class Pairing:
    """One item's outcome: what matched, and what did not."""

    matched: tuple[tuple[Prediction, Gold], ...]
    false_positives: tuple[Prediction, ...]
    false_negatives: tuple[Gold, ...]


def pair(predictions: list[Prediction], golds: list[Gold]) -> Pairing:
    """Greedy one-to-one assignment, strongest overlap first.

    Greedy rather than optimal: an exact assignment would change historical
    numbers whenever the algorithm was tuned, and with a handful of signals per
    conversation the two agree in practice. Ties break on the earlier label, so
    the result never depends on dict ordering.
    """
    candidates = []
    for p_index, prediction in enumerate(predictions):
        for g_index, gold in enumerate(golds):
            if prediction.kind != gold.kind:
                continue
            best = max((span.overlap(gold.span) for span in prediction.spans), default=0)
            if best > 0:
                candidates.append((best, -g_index, -p_index, p_index, g_index))

    candidates.sort(reverse=True)

    used_predictions: set[int] = set()
    used_golds: set[int] = set()
    matched: list[tuple[Prediction, Gold]] = []
    for _, _, _, p_index, g_index in candidates:
        if p_index in used_predictions or g_index in used_golds:
            continue
        used_predictions.add(p_index)
        used_golds.add(g_index)
        matched.append((predictions[p_index], golds[g_index]))

    return Pairing(
        matched=tuple(matched),
        false_positives=tuple(p for i, p in enumerate(predictions) if i not in used_predictions),
        false_negatives=tuple(g for i, g in enumerate(golds) if i not in used_golds),
    )


@dataclass(frozen=True)
class Score:
    true_positives: int
    false_positives: int
    false_negatives: int

    @property
    def precision(self) -> float | None:
        predicted = self.true_positives + self.false_positives
        return self.true_positives / predicted if predicted else None

    @property
    def recall(self) -> float | None:
        actual = self.true_positives + self.false_negatives
        return self.true_positives / actual if actual else None

    @property
    def f1(self) -> float | None:
        p, r = self.precision, self.recall
        if p is None or r is None or p + r == 0:
            return None
        return 2 * p * r / (p + r)

    def as_dict(self) -> dict:
        # None, not 0.0, when a rate is undefined: "no problems were labelled"
        # and "it found none of them" are different facts, and reporting the
        # first as 0.0 quietly poisons any average taken later.
        return {
            "true_positives": self.true_positives,
            "false_positives": self.false_positives,
            "false_negatives": self.false_negatives,
            "precision": self.precision,
            "recall": self.recall,
            "f1": self.f1,
        }


def score(pairings: list[Pairing], kind: str | None = None) -> Score:
    """Totals across items, optionally restricted to one kind."""

    def counts(p: Pairing) -> tuple[int, int, int]:
        tp = sum(1 for _, gold in p.matched if kind is None or gold.kind == kind)
        fp = sum(1 for pred in p.false_positives if kind is None or pred.kind == kind)
        fn = sum(1 for gold in p.false_negatives if kind is None or gold.kind == kind)
        return tp, fp, fn

    totals = [counts(p) for p in pairings]
    return Score(
        true_positives=sum(t[0] for t in totals),
        false_positives=sum(t[1] for t in totals),
        false_negatives=sum(t[2] for t in totals),
    )
