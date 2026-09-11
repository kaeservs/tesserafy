One module per latency tier — see docs/decisions/0002-tiered-ai-architecture.md.

  t1-detectors   <= 700 ms   claude-haiku-4-5    evidence spans, never a score
  t2-suggest     <= 3.5 s    claude-sonnet-5     off the critical path
  t3-synthesis   unbounded   claude-opus-5       post-call, batchable

T1 requests put the frozen prefix before the cache breakpoint and the rolling
window after it. Assert usage.cache_read_input_tokens is non-zero.
