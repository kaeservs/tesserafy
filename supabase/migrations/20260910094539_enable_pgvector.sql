-- Enable pgvector for embedding storage and similarity search.
-- Installed into the `extensions` schema per Supabase convention, keeping
-- `public` reserved for application tables.
create extension if not exists vector with schema extensions;
