-- =====================================================================================
-- Шахматная тетрадь — облако (этап 4): таблицы, RLS, функции.
-- Run the whole file in Supabase → SQL Editor. Safe to run again (idempotent).
--
-- Security model
--   * Row Level Security is ON for every table. The anon key in the app is safe only because of it.
--   * Coach: a normal (email) user whose address is in coach_allowlist; calls become_coach() once.
--   * Student: an ANONYMOUS user (Supabase Anonymous Sign-In) bound to a students row by a one-time
--     invite code from the coach (redeem_invite_code). No e-mail, no real name — only a nick.
--   * coach_allowlist, student_invites, redeem_attempts: no API access at all (no policies);
--     they are used only inside SECURITY DEFINER functions.
--   * The service_role key is never used by the app and must never be in the client or the repo.
-- =====================================================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ tables
create table if not exists public.coach_allowlist (
  email text primary key check (email = lower(email))
);

create table if not exists public.coaches (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Тренер' check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches (user_id) on delete cascade,
  nick text not null check (char_length(btrim(nick)) between 1 and 40),
  user_id uuid unique references auth.users (id) on delete set null,  -- the student's current device
  bound_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists students_coach_idx on public.students (coach_id);

create table if not exists public.student_invites (
  student_id uuid primary key references public.students (id) on delete cascade,
  code_prefix text not null unique check (code_prefix ~ '^[A-Z2-9]{4}$'),
  code_hash text not null,                 -- sha256(secret part + student id); the code itself is never stored
  failed_attempts integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.redeem_attempts (
  user_id uuid not null,
  at timestamptz not null default now(),
  ok boolean not null
);
create index if not exists redeem_attempts_user_idx on public.redeem_attempts (user_id, at);

create table if not exists public.sets (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches (user_id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  source text not null default '' check (char_length(source) <= 200),  -- book / author, filled by the app
  created_at timestamptz not null default now()
);
create index if not exists sets_coach_idx on public.sets (coach_id);

create table if not exists public.set_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.sets (id) on delete cascade,
  position integer not null default 0,
  kind text not null check (kind in ('puzzle', 'game')),
  title text not null default '' check (char_length(title) <= 120),
  start_fen text not null check (char_length(start_fen) between 15 and 100),
  movetext text not null default '' check (char_length(movetext) <= 20000),  -- moves, variations, coach's comments
  created_at timestamptz not null default now()
);
create index if not exists set_items_set_idx on public.set_items (set_id, position);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.sets (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (set_id, student_id)
);
create index if not exists assignments_student_idx on public.assignments (student_id);

create table if not exists public.progress (
  student_id uuid not null references public.students (id) on delete cascade,
  item_id uuid not null references public.set_items (id) on delete cascade,
  n integer not null default 0 check (n >= 0),       -- attempts
  ok integer not null default 0 check (ok >= 0),
  clean integer not null default 0 check (clean >= 0),
  fail integer not null default 0 check (fail >= 0),
  box smallint not null default 0 check (box between 0 and 5),
  last_at timestamptz,
  due_at timestamptz,
  res text not null default '' check (res in ('', 'clean', 'help', 'fail')),
  updated_at timestamptz not null default now(),
  primary key (student_id, item_id)
);
create index if not exists progress_item_idx on public.progress (item_id);

-- ------------------------------------------------------------------ helper functions
-- SECURITY DEFINER helpers avoid RLS recursion between tables; all use an empty search_path.
create or replace function public.is_anonymous() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.is_anonymous()
     and exists (select 1 from public.coaches c where c.user_id = auth.uid())
$$;

create or replace function public.my_student_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.students s where s.user_id = auth.uid()
$$;

create or replace function public.owns_student(p_student_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_coach() and exists (select 1 from public.students s where s.id = p_student_id and s.coach_id = auth.uid())
$$;

create or replace function public.owns_set(p_set_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_coach() and exists (select 1 from public.sets t where t.id = p_set_id and t.coach_id = auth.uid())
$$;

create or replace function public.set_assigned_to_me(p_set_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assignments a
                 where a.set_id = p_set_id and a.student_id = public.my_student_id())
$$;

create or replace function public.item_assigned_to_me(p_item_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.set_items i join public.assignments a on a.set_id = i.set_id
                 where i.id = p_item_id and a.student_id = public.my_student_id())
$$;

-- Code alphabet without look-alikes (no 0 O 1 I L): 31 symbols.
create or replace function public._random_code(p_len integer) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(p_len * 2);
  out text := '';
begin
  for i in 0 .. p_len - 1 loop
    out := out || substr(alphabet, ((get_byte(b, 2 * i) * 256 + get_byte(b, 2 * i + 1)) % 31) + 1, 1);
  end loop;
  return out;
end $$;

create or replace function public._code_hash(p_student_id uuid, p_secret text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p_secret || ':' || p_student_id::text, 'sha256'), 'hex')
$$;

-- New one-time code for a student (replaces the previous one). Format XXXX-XXXX-XXXX:
-- 4 lookup symbols + 8 secret symbols (31^8 ≈ 8.5·10^11), valid 7 days, 5 wrong tries lock it.
create or replace function public._issue_invite(p_student_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_prefix text;
  v_secret text;
  tries integer := 0;
begin
  loop
    v_prefix := public._random_code(4);
    exit when not exists (select 1 from public.student_invites
                          where code_prefix = v_prefix and student_id <> p_student_id);
    tries := tries + 1;
    if tries > 20 then raise exception 'code_space_exhausted'; end if;
  end loop;
  v_secret := public._random_code(8);
  insert into public.student_invites (student_id, code_prefix, code_hash, failed_attempts, expires_at, created_at)
  values (p_student_id, v_prefix, public._code_hash(p_student_id, v_secret), 0, now() + interval '7 days', now())
  on conflict (student_id) do update
    set code_prefix = excluded.code_prefix, code_hash = excluded.code_hash,
        failed_attempts = 0, expires_at = excluded.expires_at, created_at = now();
  return v_prefix || '-' || substr(v_secret, 1, 4) || '-' || substr(v_secret, 5, 4);
end $$;

-- ------------------------------------------------------------------ API functions (RPC)
-- Coach registration: only a signed-in e-mail user whose address is in coach_allowlist.
create or replace function public.become_coach(p_display_name text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if auth.uid() is null or public.is_anonymous() then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  if not exists (select 1 from public.coach_allowlist a where a.email = v_email) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  insert into public.coaches (user_id, display_name) values (auth.uid(), coalesce(left(v_name, 60), 'Тренер'))
  on conflict (user_id) do update set display_name = coalesce(left(v_name, 60), public.coaches.display_name);
  return jsonb_build_object('ok', true);
end $$;

-- Coach adds a student; returns the one-time code to show (only now — it is not stored).
create or replace function public.create_student(p_nick text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_nick text := btrim(coalesce(p_nick, ''));
begin
  if not public.is_coach() then return jsonb_build_object('ok', false, 'error', 'not_a_coach'); end if;
  if char_length(v_nick) < 1 or char_length(v_nick) > 40 then
    return jsonb_build_object('ok', false, 'error', 'bad_nick');
  end if;
  if (select count(*) from public.students where coach_id = auth.uid()) >= 100 then
    return jsonb_build_object('ok', false, 'error', 'too_many_students');
  end if;
  insert into public.students (coach_id, nick) values (auth.uid(), v_nick) returning id into v_id;
  return jsonb_build_object('ok', true, 'student_id', v_id, 'nick', v_nick, 'code', public._issue_invite(v_id));
end $$;

-- New code for an existing student (new phone, lost code). The old device keeps access until it is used.
create or replace function public.reissue_invite(p_student_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.owns_student(p_student_id) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'student_id', p_student_id, 'code', public._issue_invite(p_student_id));
end $$;

-- Student (anonymous user) enters the code. Errors are returned, not raised, so failed tries are counted.
create or replace function public.redeem_invite_code(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_inv public.student_invites%rowtype;
  v_nick text;
  v_coach text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  if public.is_coach() then return jsonb_build_object('ok', false, 'error', 'coach_cannot_join'); end if;
  if (select count(*) from public.redeem_attempts
      where user_id = auth.uid() and not ok and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;
  if v_code !~ '^[A-Z2-9]{12}$' then
    insert into public.redeem_attempts (user_id, ok) values (auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  select * into v_inv from public.student_invites where code_prefix = left(v_code, 4) for update;
  if not found then
    insert into public.redeem_attempts (user_id, ok) values (auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if v_inv.failed_attempts >= 5 then
    insert into public.redeem_attempts (user_id, ok) values (auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'code_locked');
  end if;
  if v_inv.expires_at < now() then
    insert into public.redeem_attempts (user_id, ok) values (auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'code_expired');
  end if;
  if v_inv.code_hash <> public._code_hash(v_inv.student_id, substr(v_code, 5, 8)) then
    update public.student_invites set failed_attempts = failed_attempts + 1 where student_id = v_inv.student_id;
    insert into public.redeem_attempts (user_id, ok) values (auth.uid(), false);
    return jsonb_build_object('ok', false, 'error',
      case when v_inv.failed_attempts + 1 >= 5 then 'code_locked' else 'invalid_code' end);
  end if;

  -- Success: this device becomes the student's device; a previous device loses access.
  update public.students set user_id = null where user_id = auth.uid() and id <> v_inv.student_id;
  update public.students set user_id = auth.uid(), bound_at = now(), last_seen_at = now()
   where id = v_inv.student_id returning nick into v_nick;
  delete from public.student_invites where student_id = v_inv.student_id;
  insert into public.redeem_attempts (user_id, ok) values (auth.uid(), true);
  select c.display_name into v_coach from public.coaches c
    join public.students s on s.coach_id = c.user_id where s.id = v_inv.student_id;
  return jsonb_build_object('ok', true, 'student_id', v_inv.student_id, 'nick', v_nick, 'coach_name', v_coach);
end $$;

-- Who am I: coach / student / none. Also marks the student as recently seen.
create or replace function public.whoami() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_sid uuid;
  v_nick text;
  v_coach text;
begin
  if auth.uid() is null then return jsonb_build_object('role', 'none'); end if;
  if public.is_coach() then
    return jsonb_build_object('role', 'coach',
      'display_name', (select display_name from public.coaches where user_id = auth.uid()));
  end if;
  update public.students set last_seen_at = now() where user_id = auth.uid()
    returning id, nick into v_sid, v_nick;
  if v_sid is null then return jsonb_build_object('role', 'none', 'anonymous', public.is_anonymous()); end if;
  select c.display_name into v_coach from public.coaches c
    join public.students s on s.coach_id = c.user_id where s.id = v_sid;
  return jsonb_build_object('role', 'student', 'student_id', v_sid, 'nick', v_nick, 'coach_name', v_coach);
end $$;

-- Student uploads progress rows. Merge rule (same as in the app): more attempts wins;
-- on a tie the later attempt wins. Rows for items not assigned to the student are ignored.
-- SECURITY INVOKER: Row Level Security still applies.
create or replace function public.push_progress(p_rows jsonb) returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_sid uuid := public.my_student_id();
  v_count integer;
begin
  if v_sid is null then raise exception 'not_a_student' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'bad_rows' using errcode = '22023';
  end if;
  with src as (
    select (r ->> 'item_id')::uuid as item_id,
           greatest(0, coalesce((r ->> 'n')::integer, 0)) as n,
           greatest(0, coalesce((r ->> 'ok')::integer, 0)) as ok,
           greatest(0, coalesce((r ->> 'clean')::integer, 0)) as clean,
           greatest(0, coalesce((r ->> 'fail')::integer, 0)) as fail,
           least(5, greatest(0, coalesce((r ->> 'box')::integer, 0)))::smallint as box,
           case when (r ->> 'last') is null then null else to_timestamp((r ->> 'last')::double precision / 1000) end as last_at,
           case when (r ->> 'due') is null then null else to_timestamp((r ->> 'due')::double precision / 1000) end as due_at,
           case when (r ->> 'res') in ('clean', 'help', 'fail') then r ->> 'res' else '' end as res
    from jsonb_array_elements(p_rows) as r
  ), up as (
    insert into public.progress as p (student_id, item_id, n, ok, clean, fail, box, last_at, due_at, res, updated_at)
    select v_sid, s.item_id, s.n, s.ok, s.clean, s.fail, s.box, s.last_at, s.due_at, s.res, now()
      from src s
     where public.item_assigned_to_me(s.item_id)
    on conflict (student_id, item_id) do update
      set n = excluded.n, ok = excluded.ok, clean = excluded.clean, fail = excluded.fail, box = excluded.box,
          last_at = excluded.last_at, due_at = excluded.due_at, res = excluded.res, updated_at = now()
      where excluded.n > p.n
         or (excluded.n = p.n and coalesce(excluded.last_at, '-infinity') > coalesce(p.last_at, '-infinity'))
    returning 1
  )
  select count(*) into v_count from up;
  return v_count;
end $$;

-- Keep-alive for the free plan (called by a scheduled GitHub Action with the anon key).
create or replace function public.ping() returns text
language sql stable set search_path = '' as $$ select 'ok'::text $$;

-- ------------------------------------------------------------------ Row Level Security
alter table public.coach_allowlist enable row level security;
alter table public.coaches         enable row level security;
alter table public.students        enable row level security;
alter table public.student_invites enable row level security;
alter table public.redeem_attempts enable row level security;
alter table public.sets            enable row level security;
alter table public.set_items       enable row level security;
alter table public.assignments     enable row level security;
alter table public.progress        enable row level security;
-- coach_allowlist, student_invites, redeem_attempts: intentionally no policies (no API access).

drop policy if exists coaches_select_self on public.coaches;
create policy coaches_select_self on public.coaches for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists coaches_update_self on public.coaches;
create policy coaches_update_self on public.coaches for update to authenticated
  using (user_id = (select auth.uid()) and public.is_coach()) with check (user_id = (select auth.uid()));

drop policy if exists students_select on public.students;
create policy students_select on public.students for select to authenticated
  using (public.owns_student(id) or user_id = (select auth.uid()));
drop policy if exists students_update_coach on public.students;
create policy students_update_coach on public.students for update to authenticated
  using (public.owns_student(id)) with check (public.owns_student(id));
drop policy if exists students_delete_coach on public.students;
create policy students_delete_coach on public.students for delete to authenticated
  using (public.owns_student(id));

-- sets: the coach check compares the row's own column (not owns_set()), because
-- "insert ... returning" checks the select policy on the new row, which a helper that
-- re-reads the same table cannot see yet in the statement's snapshot.
drop policy if exists sets_select on public.sets;
create policy sets_select on public.sets for select to authenticated
  using ((coach_id = (select auth.uid()) and not public.is_anonymous()) or public.set_assigned_to_me(id));
drop policy if exists sets_insert_coach on public.sets;
create policy sets_insert_coach on public.sets for insert to authenticated
  with check (coach_id = (select auth.uid()) and public.is_coach());
drop policy if exists sets_update_coach on public.sets;
create policy sets_update_coach on public.sets for update to authenticated
  using (coach_id = (select auth.uid()) and public.is_coach()) with check (coach_id = (select auth.uid()));
drop policy if exists sets_delete_coach on public.sets;
create policy sets_delete_coach on public.sets for delete to authenticated
  using (coach_id = (select auth.uid()) and public.is_coach());

drop policy if exists set_items_select on public.set_items;
create policy set_items_select on public.set_items for select to authenticated
  using (public.owns_set(set_id) or public.set_assigned_to_me(set_id));
drop policy if exists set_items_write_coach on public.set_items;
create policy set_items_write_coach on public.set_items for all to authenticated
  using (public.owns_set(set_id)) with check (public.owns_set(set_id));

drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments for select to authenticated
  using (public.owns_set(set_id) or student_id = public.my_student_id());
drop policy if exists assignments_insert_coach on public.assignments;
create policy assignments_insert_coach on public.assignments for insert to authenticated
  with check (public.owns_set(set_id) and public.owns_student(student_id));
drop policy if exists assignments_delete_coach on public.assignments;
create policy assignments_delete_coach on public.assignments for delete to authenticated
  using (public.owns_set(set_id));

drop policy if exists progress_select on public.progress;
create policy progress_select on public.progress for select to authenticated
  using (student_id = public.my_student_id() or public.owns_student(student_id));
drop policy if exists progress_insert_student on public.progress;
create policy progress_insert_student on public.progress for insert to authenticated
  with check (student_id = public.my_student_id() and public.item_assigned_to_me(item_id));
drop policy if exists progress_update_student on public.progress;
create policy progress_update_student on public.progress for update to authenticated
  using (student_id = public.my_student_id())
  with check (student_id = public.my_student_id() and public.item_assigned_to_me(item_id));
drop policy if exists progress_delete_coach on public.progress;
create policy progress_delete_coach on public.progress for delete to authenticated
  using (public.owns_student(student_id));

-- ------------------------------------------------------------------ privileges
-- Supabase grants everything on new tables to anon/authenticated by default; narrow it down.
revoke all on public.coach_allowlist, public.student_invites, public.redeem_attempts from anon, authenticated;
revoke all on public.coaches, public.students, public.sets, public.set_items, public.assignments, public.progress
  from anon, authenticated;
grant select on public.coaches to authenticated;
grant update (display_name) on public.coaches to authenticated;
grant select, delete on public.students to authenticated;
grant update (nick) on public.students to authenticated;
grant select, insert, delete on public.sets to authenticated;
grant update (title, source) on public.sets to authenticated;
grant select, insert, update, delete on public.set_items to authenticated;
grant select, insert, delete on public.assignments to authenticated;
grant select, insert, update, delete on public.progress to authenticated;

revoke execute on function public._random_code(integer), public._code_hash(uuid, text), public._issue_invite(uuid)
  from public, anon, authenticated;
revoke execute on function public.become_coach(text), public.create_student(text), public.reissue_invite(uuid),
  public.redeem_invite_code(text), public.whoami(), public.push_progress(jsonb)
  from public, anon;
grant execute on function public.become_coach(text), public.create_student(text), public.reissue_invite(uuid),
  public.redeem_invite_code(text), public.whoami(), public.push_progress(jsonb)
  to authenticated;
-- helpers used inside policies must be callable by signed-in users
revoke execute on function public.is_anonymous(), public.is_coach(), public.my_student_id(), public.owns_student(uuid),
  public.owns_set(uuid), public.set_assigned_to_me(uuid), public.item_assigned_to_me(uuid)
  from public, anon;
grant execute on function public.is_anonymous(), public.is_coach(), public.my_student_id(), public.owns_student(uuid),
  public.owns_set(uuid), public.set_assigned_to_me(uuid), public.item_assigned_to_me(uuid)
  to authenticated;
grant execute on function public.ping() to anon, authenticated;
