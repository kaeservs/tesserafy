"""The labelling aids, which exist to save a person round trips.

Run with: python -m unittest discover -s services/eval -t services/eval

What matters here is that a wrong quote is diagnosed usefully. A checker that
says "not found" and points at the wrong line is worse than one that says
nothing, because it sends the labeller to the wrong sentence.
"""

import unittest

from harness.dataset import Segment
from harness.label import nearest

SEGMENTS = [
    Segment("s1", "Thanks for making the time. Tell me how reporting works today."),
    Segment(
        "s2",
        "Exporting the weekly report takes us most of Friday afternoon. "
        "It's four spreadsheets, pasted together by hand.",
    ),
    Segment("s3", "Our warehouse team mostly works nights, so the timing matters."),
]


class NearestTest(unittest.TestCase):
    def test_points_at_the_line_that_contains_the_near_match(self) -> None:
        # One word wrong: afternoon became morning. The labeller needs to see
        # the sentence they meant, which is the long one.
        found = nearest(SEGMENTS, "takes us most of Friday morning")

        assert found is not None
        self.assertEqual(found[0].id, "s2")

    def test_is_not_fooled_by_a_short_unrelated_line(self) -> None:
        # Overall string similarity scores a long segment badly for being
        # long, which used to hand this case to s3. Containment does not.
        found = nearest(SEGMENTS, "four spreadsheets, pasted together by hand")

        assert found is not None
        self.assertEqual(found[0].id, "s2")

    def test_scores_a_full_match_higher_than_a_partial_one(self) -> None:
        whole = nearest(SEGMENTS, "Our warehouse team mostly works nights")
        partial = nearest(SEGMENTS, "warehouse xxxxxxxxxxxxxxxxxxxxxxxxxxxx")

        assert whole is not None and partial is not None
        self.assertGreater(whole[1], partial[1])

    def test_handles_an_empty_quote_without_dividing_by_zero(self) -> None:
        found = nearest(SEGMENTS, "")

        assert found is not None
        self.assertEqual(found[1], 0.0)


if __name__ == "__main__":
    unittest.main()
