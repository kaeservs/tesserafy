Labelled evaluation data. Versioned in git — this corpus is the project asset
that takes longest to rebuild.

Start collecting during Phase 0; the harness that reads it arrives in Phase 3.
Spike S3 produces the first 50 labelled snippets.

Run output goes to services/eval/runs/, which is gitignored.

## Adding to it

    python -m harness.label --worksheet <transcript.vtt> --criteria <criteria.json>
    python -m harness.label --check <corpus.jsonl>

The worksheet prints the criteria and then the transcript as the chunker
segments it, so a quote can be copied rather than retyped. `--check` resolves
every label and reports all of the failures at once, saying whether a quote
was not found or found in more than one place, and showing the nearest line
when it was not found.

Neither uses a model. Labels proposed by a detector and confirmed by a person
are labels that agree with the detector about what is worth looking at, and
the gaps they share stay invisible. The corpus grades the detector; it must
not be drawn by it.
