-- pgvector landed in `public` despite the WITH SCHEMA clause on the prior
-- migration. Move it to `extensions` so `public` stays reserved for
-- application tables and the "extension installed in public" security
-- advisory stays clean. Safe to do now: no columns use the vector type yet.
alter extension vector set schema extensions;
