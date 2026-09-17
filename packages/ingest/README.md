# @tesserafy/ingest

T0: transcripts into segments. No model, no network, no clock.

Every accepted format is parsed into `Turn[]` (`parseVtt`, or `parseTurns` for
JSON already in that shape), then chunked into `SegmentDraft[]` by
`toSegments`. A new export format is a new parser and nothing else.

Chunking merges consecutive cues from one speaker, then splits at a sentence
boundary once a turn passes the character budget (~600 tokens, the window
spike S3 tests detectors against). Evidence stays human-shaped; embeddings
stay bounded.

The caller reads files and writes rows. This package only transforms values,
so the whole of it tests without a filesystem or a database.
