The criterion state machine.

  unobserved -> candidate -> confirmed
                         \-> contradicted

Confirmed is latching: absence of evidence never demotes. Only an explicit
contradiction detector can move a confirmed criterion, and that is recorded as
an event. This rule is what stops the live score flickering — see
docs/decisions/0003-deterministic-scoring.md.

Pure functions only. No network, no clock, no randomness: the tests feed
synthetic detector sequences and assert the score trajectory.
