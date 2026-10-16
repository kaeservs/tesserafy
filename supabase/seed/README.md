Seed data, applied after migrations.

Two test tenants with overlapping content, for the tenant-isolation tests.
Criteria are data, not code, but they are not seeded here: the templates are
in a migration (`20260919170000_criteria_definitions.sql`) and later ones are
published with `pnpm criteria --add`. Adding an engagement type is a row, not
a deploy.

Seeds are versioned — a conversation pins the criteria version it was scored
against so historical scores stay reproducible after weights are retuned.
