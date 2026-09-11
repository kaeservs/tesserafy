The guarded retrieve().

companyId is a required positional argument. This is the only place in the
codebase permitted to construct a vector or evidence query. The AI pipeline
runs with a service-role key that bypasses RLS, so this function is the real
tenant boundary — see docs/decisions/0004-tenant-isolation-in-retrieval.md.

The cross-tenant test in packages/ai/test is release-blocking.
