-- Minimal stand-in for the parts of Supabase that the migration relies on (tests only, PGlite).
-- auth.uid()/auth.jwt() read the JWT claims from the request.jwt.claims setting, like Supabase does.
create schema if not exists extensions;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  is_anonymous boolean not null default false
);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth, extensions to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
-- Supabase's defaults: new tables and functions in public are fully granted to the API roles.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
