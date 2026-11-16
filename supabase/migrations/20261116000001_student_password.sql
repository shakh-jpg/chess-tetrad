-- =====================================================================================
-- Students sign in with a login and a password (no e-mail: students may be minors).
-- Run once in the Supabase SQL Editor after 20261114000001_init.sql. Safe to run again.
--   * student_logins, login_attempts: no API access at all (RLS on, no policies, no grants);
--     used only inside the SECURITY DEFINER functions below.
--   * The password is stored only as a bcrypt hash (pgcrypto crypt + gen_salt('bf', 10)).
--   * students.has_password lets the coach see that a password is set (never the password).
--   * Deleting a student deletes the login and the hash (on delete cascade).
-- =====================================================================================

create extension if not exists pgcrypto with schema extensions;

alter table public.students add column if not exists has_password boolean not null default false;

create table if not exists public.student_logins (
  student_id uuid primary key references public.students(id) on delete cascade,
  login text not null unique,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.login_attempts (
  login text not null,
  user_id uuid,
  at timestamptz not null default now(),
  ok boolean not null
);
create index if not exists login_attempts_login_idx on public.login_attempts (login, at);
create index if not exists login_attempts_user_idx on public.login_attempts (user_id, at);

alter table public.student_logins enable row level security;
alter table public.login_attempts enable row level security;
revoke all on public.student_logins from public, anon, authenticated;
revoke all on public.login_attempts from public, anon, authenticated;

-- The current student sets (or changes) the login and the password.
create or replace function public.set_student_login(p_login text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_sid uuid := public.my_student_id();
  v_login text := lower(trim(coalesce(p_login, '')));
begin
  if v_sid is null then return jsonb_build_object('ok', false, 'error', 'not_student'); end if;
  if v_login !~ '^[a-z0-9]{3,30}$' then return jsonb_build_object('ok', false, 'error', 'bad_login'); end if;
  if length(coalesce(p_password, '')) < 8 or length(p_password) > 72 then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;
  if exists (select 1 from public.student_logins where login = v_login and student_id <> v_sid) then
    return jsonb_build_object('ok', false, 'error', 'login_taken');
  end if;
  insert into public.student_logins (student_id, login, password_hash, updated_at)
  values (v_sid, v_login, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now())
  on conflict (student_id) do update
    set login = excluded.login, password_hash = excluded.password_hash, updated_at = now();
  update public.students set has_password = true where id = v_sid;
  return jsonb_build_object('ok', true, 'login', v_login);
end $$;

-- The current student's login (to show it in the account), or null.
create or replace function public.my_student_login() returns text
language sql stable security definer set search_path = '' as $$
  select l.login from public.student_logins l where l.student_id = public.my_student_id()
$$;

-- Sign in from a new (anonymous) session: on success this session becomes the student's
-- device, exactly like redeem_invite_code; progress belongs to the student and stays.
-- "No such login" and "wrong password" give the same answer.
create or replace function public.student_login(p_login text, p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_login text := lower(trim(coalesce(p_login, '')));
  v_row public.student_logins%rowtype;
  v_nick text;
  v_coach text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  -- a coach session must never become a student's device (same rule as redeem_invite_code)
  if public.is_coach() then return jsonb_build_object('ok', false, 'error', 'coach_cannot_join'); end if;
  if (select count(*) from public.login_attempts
       where not ok and at > now() - interval '15 minutes'
         and (login = v_login or user_id = auth.uid())) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;
  select * into v_row from public.student_logins where login = v_login;
  if not found then
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10)); -- same work as a real check
    insert into public.login_attempts (login, user_id, ok) values (v_login, auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'invalid_login');
  end if;
  if v_row.password_hash <> extensions.crypt(coalesce(p_password, ''), v_row.password_hash) then
    insert into public.login_attempts (login, user_id, ok) values (v_login, auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'invalid_login');
  end if;
  update public.students set user_id = null where user_id = auth.uid() and id <> v_row.student_id;
  update public.students set user_id = auth.uid(), bound_at = now(), last_seen_at = now()
   where id = v_row.student_id returning nick into v_nick;
  insert into public.login_attempts (login, user_id, ok) values (v_login, auth.uid(), true);
  select c.display_name into v_coach from public.coaches c
    join public.students s on s.coach_id = c.user_id where s.id = v_row.student_id;
  return jsonb_build_object('ok', true, 'student_id', v_row.student_id, 'nick', v_nick, 'coach_name', v_coach);
end $$;

revoke all on function public.set_student_login(text, text) from public, anon;
revoke all on function public.my_student_login() from public, anon;
revoke all on function public.student_login(text, text) from public, anon;
grant execute on function public.set_student_login(text, text) to authenticated;
grant execute on function public.my_student_login() to authenticated;
grant execute on function public.student_login(text, text) to authenticated;
