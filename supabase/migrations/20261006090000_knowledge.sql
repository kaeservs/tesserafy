-- A company's knowledge: the documents its sellers answer from — pricing,
-- product sheets, objection handling, case studies — so the overlay's Assist
-- and Ask can answer "how long does rollout take?" with the company's own
-- words instead of "confirm that" (Cluely's "upload your docs").
--
-- A document is split into passages, each embedded by the same gte-small
-- function inside Supabase that embeds calls: nothing goes to a new service.
-- Passages are found by meaning and by keyword together (match_knowledge),
-- because gte-small alone ranks by phrasing more than by subject, and a
-- product question usually names the thing it is about.
--
-- The passages and their vectors are read and written only through the
-- retrieval module in packages/ai (ADR 0004): the table has no read policy,
-- and scripts/check-retrieval-guard.mjs refuses its name anywhere else.
-- Documents themselves are readable by every member; owners add and delete
-- them. Closing the company deletes them with everything else it held.

create table public.knowledge_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 200),
  source      text not null check (source in ('upload', 'pasted')),
  file_name   text check (file_name is null or length(file_name) between 1 and 255),
  characters  integer not null default 0 check (characters >= 0),
  passages    integer not null default 0 check (passages >= 0),
  status      text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error       text check (error is null or length(error) <= 500),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (company_id, id)
);

create index knowledge_documents_company_idx on public.knowledge_documents (company_id, created_at desc);

comment on table public.knowledge_documents is
  'Documents a company''s sellers answer from. Members read; owners add and delete. Passages live in knowledge_chunks.';

alter table public.knowledge_documents enable row level security;

create policy "members read their company's knowledge"
  on public.knowledge_documents for select to authenticated
  using ((select private.is_company_member(company_id)));


create table public.knowledge_chunks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  document_id  uuid not null,
  ordinal      integer not null check (ordinal >= 0),
  text         text not null check (length(trim(text)) between 1 and 2000),
  embedding    extensions.vector(384) not null,
  search       tsvector generated always as (to_tsvector('english', text)) stored,
  unique (document_id, ordinal),
  foreign key (company_id, document_id)
    references public.knowledge_documents (company_id, id) on delete cascade
);

create index knowledge_chunks_company_idx on public.knowledge_chunks (company_id);
create index knowledge_chunks_search_idx on public.knowledge_chunks using gin (search);

comment on table public.knowledge_chunks is
  'Passages of knowledge documents, embedded. No read policy: only match_knowledge, through retrieve() (ADR 0004).';

alter table public.knowledge_chunks enable row level security;


create function private.is_company_owner_of_document(p_document public.knowledge_documents)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_company_owner(p_document.company_id);
$$;


-- An owner starts a document; its passages follow once read and embedded.
create function public.create_knowledge_document(p_title text, p_source text, p_file_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.sole_company_of_caller();
  v_id         uuid;
begin
  if not private.is_company_owner(v_company_id) then
    raise exception 'create_knowledge_document: only an owner adds to the company''s knowledge' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 200 then
    raise exception 'create_knowledge_document: a title is 1 to 200 characters' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('upload', 'pasted') then
    raise exception 'create_knowledge_document: a document is uploaded or pasted' using errcode = '22023';
  end if;
  if (select count(*) from public.knowledge_documents d where d.company_id = v_company_id) >= 50 then
    raise exception 'create_knowledge_document: a company keeps up to 50 documents; delete one first' using errcode = '22023';
  end if;

  insert into public.knowledge_documents (company_id, title, source, file_name, created_by)
  values (v_company_id, trim(p_title), p_source, nullif(left(trim(coalesce(p_file_name, '')), 255), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- A document's passages, each with its vector; the document becomes ready.
-- Only for a document still being processed, by an owner of its company.
create function public.record_knowledge_chunks(p_document_id uuid, p_chunks jsonb, p_characters integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc   public.knowledge_documents;
  v_chunk jsonb;
  v_count integer := 0;
begin
  select * into v_doc from public.knowledge_documents d where d.id = p_document_id;
  if v_doc.id is null or not (select private.is_company_member(v_doc.company_id)) then
    raise exception 'record_knowledge_chunks: document not found' using errcode = 'P0002';
  end if;
  if not private.is_company_owner_of_document(v_doc) then
    raise exception 'record_knowledge_chunks: only an owner adds to the company''s knowledge' using errcode = '42501';
  end if;
  if v_doc.status <> 'processing' then
    raise exception 'record_knowledge_chunks: that document is already %', v_doc.status using errcode = '22023';
  end if;
  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) not between 1 and 400 then
    raise exception 'record_knowledge_chunks: 1 to 400 passages' using errcode = '22023';
  end if;

  for v_chunk in select * from jsonb_array_elements(p_chunks) loop
    insert into public.knowledge_chunks (company_id, document_id, ordinal, text, embedding)
    values (v_doc.company_id, v_doc.id, (v_chunk ->> 'ordinal')::integer, v_chunk ->> 'text',
            (v_chunk ->> 'embedding')::extensions.vector(384));
    v_count := v_count + 1;
  end loop;

  update public.knowledge_documents
     set status = 'ready', passages = v_count, characters = greatest(coalesce(p_characters, 0), 0), error = null
   where id = v_doc.id;
  return v_count;
end;
$$;

-- A document that could not be read or embedded says why, and holds nothing.
create function public.fail_knowledge_document(p_document_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.knowledge_documents;
begin
  select * into v_doc from public.knowledge_documents d where d.id = p_document_id;
  if v_doc.id is null or not private.is_company_owner_of_document(v_doc) then
    raise exception 'fail_knowledge_document: document not found' using errcode = 'P0002';
  end if;
  delete from public.knowledge_chunks where document_id = v_doc.id;
  update public.knowledge_documents
     set status = 'failed', passages = 0, error = left(coalesce(nullif(trim(p_error), ''), 'It could not be read.'), 500)
   where id = v_doc.id;
end;
$$;

create function public.delete_knowledge_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.knowledge_documents;
begin
  select * into v_doc from public.knowledge_documents d where d.id = p_document_id;
  if v_doc.id is null or not (select private.is_company_member(v_doc.company_id)) then
    raise exception 'delete_knowledge_document: document not found' using errcode = 'P0002';
  end if;
  if not private.is_company_owner_of_document(v_doc) then
    raise exception 'delete_knowledge_document: only an owner deletes from the company''s knowledge' using errcode = '42501';
  end if;
  delete from public.knowledge_documents where id = v_doc.id;
end;
$$;


-- The passages most relevant to a question: by meaning (the vector) and by
-- the words it uses (full text), merged by reciprocal rank so a passage near
-- the top of either list rises. The same tenant rule as match_segments: a
-- signed-in caller searches their own company only (ADR 0011), and retrieve()
-- checks every row that comes back (ADR 0004).
create function public.match_knowledge(
  p_company_id      uuid,
  p_query_embedding extensions.vector(384),
  p_query_text      text,
  p_match_count     integer
)
returns table (
  chunk_id     uuid,
  company_id   uuid,
  document_id  uuid,
  title        text,
  text         text,
  similarity   double precision,
  score        double precision
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_query tsquery;
begin
  if p_company_id is null then
    raise exception 'match_knowledge: p_company_id is required';
  end if;
  if (select auth.uid()) is not null
     and not (select private.is_company_member(p_company_id)) then
    raise exception 'match_knowledge: not a member of that company' using errcode = '42501';
  end if;
  if p_match_count is null or p_match_count < 1 or p_match_count > 20 then
    raise exception 'match_knowledge: p_match_count must be between 1 and 20';
  end if;

  -- Any of the question's words, not all of them: a spoken question carries
  -- words no passage will share.
  v_query := nullif(replace(plainto_tsquery('english', coalesce(p_query_text, ''))::text, '&', '|'), '')::tsquery;

  return query
  with by_meaning as (
    select c.id, row_number() over (order by c.embedding operator(extensions.<=>) p_query_embedding) as r,
           1 - (c.embedding operator(extensions.<=>) p_query_embedding) as similarity
      from public.knowledge_chunks c
     where c.company_id = p_company_id
     order by c.embedding operator(extensions.<=>) p_query_embedding
     limit 20
  ),
  by_words as (
    select c.id, row_number() over (order by ts_rank_cd(c.search, v_query) desc) as r
      from public.knowledge_chunks c
     where c.company_id = p_company_id and v_query is not null and c.search @@ v_query
     order by ts_rank_cd(c.search, v_query) desc
     limit 20
  ),
  merged as (
    select coalesce(m.id, w.id) as id,
           (coalesce(1.0 / (60 + m.r), 0) + coalesce(1.0 / (60 + w.r), 0))::double precision as score,
           m.similarity
      from by_meaning m full outer join by_words w on w.id = m.id
  )
  select c.id, c.company_id, c.document_id, d.title, c.text,
         coalesce(merged.similarity, 1 - (c.embedding operator(extensions.<=>) p_query_embedding))::double precision,
         merged.score
    from merged
    join public.knowledge_chunks c on c.id = merged.id
    join public.knowledge_documents d on d.company_id = c.company_id and d.id = c.document_id
   where d.status = 'ready'
   order by merged.score desc
   limit p_match_count;
end;
$$;

-- A closed company keeps nothing it knew.
create function private.forget_knowledge_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.closed_at is not null and old.closed_at is null then
    delete from public.knowledge_documents where company_id = new.id;
  end if;
  return new;
end;
$$;

create trigger companies_forget_knowledge_on_close
  after update of closed_at on public.companies
  for each row execute function private.forget_knowledge_on_close();

revoke all on function private.is_company_owner_of_document(public.knowledge_documents) from public, anon;
revoke all on function public.create_knowledge_document(text, text, text) from public, anon;
revoke all on function public.record_knowledge_chunks(uuid, jsonb, integer) from public, anon;
revoke all on function public.fail_knowledge_document(uuid, text) from public, anon;
revoke all on function public.delete_knowledge_document(uuid) from public, anon;
revoke all on function public.match_knowledge(uuid, extensions.vector, text, integer) from public, anon;
grant execute on function public.create_knowledge_document(text, text, text) to authenticated;
grant execute on function public.record_knowledge_chunks(uuid, jsonb, integer) to authenticated;
grant execute on function public.fail_knowledge_document(uuid, text) to authenticated;
grant execute on function public.delete_knowledge_document(uuid) to authenticated;
grant execute on function public.match_knowledge(uuid, extensions.vector, text, integer) to authenticated, service_role;
