"""The matching rule, which is what precision and recall actually mean here.

Run with: python -m unittest discover -s services/eval -t services/eval
"""

import unittest

from harness.match import Gold, Prediction, Span, pair, score


def prediction(kind: str, *spans: tuple[str, int, int], summary: str = "s") -> Prediction:
    return Prediction(kind=kind, summary=summary, spans=tuple(Span(*s) for s in spans))


def gold(kind: str, span: tuple[str, int, int], quote: str = "q") -> Gold:
    return Gold(kind=kind, quote=quote, span=Span(*span))


class PairTest(unittest.TestCase):
    def test_overlapping_span_of_the_same_kind_matches(self):
        result = pair([prediction("problem", ("s1", 10, 40))], [gold("problem", ("s1", 20, 50))])

        self.assertEqual(len(result.matched), 1)
        self.assertEqual(result.false_positives, ())
        self.assertEqual(result.false_negatives, ())

    def test_right_words_wrong_kind_does_not_match(self):
        result = pair(
            [prediction("feature_request", ("s1", 10, 40))], [gold("problem", ("s1", 10, 40))]
        )

        self.assertEqual(len(result.matched), 0)
        self.assertEqual(len(result.false_positives), 1)
        self.assertEqual(len(result.false_negatives), 1)

    def test_right_kind_wrong_segment_does_not_match(self):
        # A signal that quotes a different part of the call is wrong, however
        # well its summary reads.
        result = pair([prediction("problem", ("s9", 10, 40))], [gold("problem", ("s1", 10, 40))])

        self.assertEqual(len(result.matched), 0)

    def test_touching_but_not_overlapping_does_not_match(self):
        result = pair([prediction("problem", ("s1", 0, 10))], [gold("problem", ("s1", 10, 20))])

        self.assertEqual(len(result.matched), 0)

    def test_any_one_span_of_a_multi_quote_signal_can_match(self):
        result = pair(
            [prediction("problem", ("s5", 0, 5), ("s1", 15, 30))], [gold("problem", ("s1", 10, 40))]
        )

        self.assertEqual(len(result.matched), 1)

    def test_matching_is_one_to_one(self):
        # Two labels in one sentence must not both be satisfied by one signal;
        # otherwise a vague catch-all prediction scores as two hits.
        predictions = [prediction("problem", ("s1", 0, 100))]
        golds = [gold("problem", ("s1", 10, 20)), gold("problem", ("s1", 30, 40))]

        result = pair(predictions, golds)

        self.assertEqual(len(result.matched), 1)
        self.assertEqual(len(result.false_negatives), 1)

    def test_strongest_overlap_wins(self):
        predictions = [prediction("problem", ("s1", 0, 12)), prediction("problem", ("s1", 10, 40))]
        golds = [gold("problem", ("s1", 10, 40), quote="the long one")]

        result = pair(predictions, golds)

        self.assertEqual(len(result.matched), 1)
        self.assertEqual(result.matched[0][0].spans[0].start, 10)

    def test_extra_prediction_is_a_false_positive(self):
        result = pair(
            [prediction("problem", ("s1", 10, 40)), prediction("problem", ("s2", 0, 10))],
            [gold("problem", ("s1", 10, 40))],
        )

        self.assertEqual(len(result.false_positives), 1)

    def test_no_predictions_makes_every_label_a_miss(self):
        result = pair([], [gold("problem", ("s1", 0, 10)), gold("feature_request", ("s2", 0, 10))])

        self.assertEqual(len(result.false_negatives), 2)


class ScoreTest(unittest.TestCase):
    def test_precision_and_recall(self):
        pairings = [
            pair(
                [prediction("problem", ("s1", 0, 10)), prediction("problem", ("s2", 0, 10))],
                [gold("problem", ("s1", 0, 10)), gold("problem", ("s3", 0, 10))],
            )
        ]

        result = score(pairings)

        self.assertEqual((result.true_positives, result.false_positives, result.false_negatives), (1, 1, 1))
        self.assertAlmostEqual(result.precision, 0.5)
        self.assertAlmostEqual(result.recall, 0.5)
        self.assertAlmostEqual(result.f1, 0.5)

    def test_scores_can_be_restricted_to_one_kind(self):
        pairings = [
            pair(
                [prediction("problem", ("s1", 0, 10))],
                [gold("problem", ("s1", 0, 10)), gold("feature_request", ("s2", 0, 10))],
            )
        ]

        problems = score(pairings, "problem")
        requests = score(pairings, "feature_request")

        self.assertEqual(problems.recall, 1.0)
        self.assertEqual(requests.recall, 0.0)

    def test_undefined_rates_are_none_not_zero(self):
        # "nothing was labelled" and "it found nothing" are different facts.
        empty = score([pair([], [])])

        self.assertIsNone(empty.precision)
        self.assertIsNone(empty.recall)
        self.assertIsNone(empty.f1)
        self.assertIsNone(empty.as_dict()["f1"])

    def test_totals_add_across_items(self):
        pairings = [
            pair([prediction("problem", ("s1", 0, 10))], [gold("problem", ("s1", 0, 10))]),
            pair([prediction("problem", ("s1", 0, 10))], [gold("problem", ("s1", 0, 10))]),
        ]

        self.assertEqual(score(pairings).true_positives, 2)


if __name__ == "__main__":
    unittest.main()
