-- Minimal stand-in for Supabase Realtime's authorization table (tests only, PGlite).
-- Realtime checks a private channel by running select/insert on realtime.messages as the
-- user, with the channel topic in the realtime.topic setting; realtime.topic() reads it.
create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null,
  event text,
  payload jsonb,
  private boolean default true,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')::text
$$;
grant usage on schema realtime to anon, authenticated;
grant select, insert on realtime.messages to authenticated;
grant usage, select on all sequences in schema realtime to authenticated;
grant execute on function realtime.topic() to anon, authenticated;
