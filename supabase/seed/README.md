Seed data, applied after migrations.

criteria_definitions lives here: engagement types and their criteria are data,
not code. Adding "Customer Discovery" alongside "Sales" is a row, not a deploy.

Seeds are versioned — a conversation pins the criteria version it was scored
against so historical scores stay reproducible after weights are retuned.
