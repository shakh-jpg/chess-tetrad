-- =====================================================================================
-- Stage 5: online lesson (Supabase Realtime) + "allow showing the solution" for assigned sets.
-- Run once in the Supabase SQL Editor after the previous migrations. Safe to run again.
--
-- Online lesson
--   * public.lessons: who runs the lesson (coach_id), who is invited (students[] = students.id),
--     status live/ended, times. No other data: the moves travel only through Realtime and are
--     saved on the devices (book «Уроки»), not in the database.
--   * Coaches read their own lessons. Students do not read the table at all; they call
--     my_live_lesson(), which returns only the id, the coach's display name and the start time.
--   * Nobody writes the table directly: start_lesson() / end_lesson() (SECURITY DEFINER) do it.
--   * Realtime: PRIVATE channels with policies on realtime.messages.
--       lesson:<id>:c  the coach's channel. Coach writes (broadcast); invited students only read.
--       lesson:<id>:s  the students' channel. Members send move proposals (broadcast; only the
--                      coach reads them) and presence (everyone in the lesson reads it).
--     A stranger (not the coach and not an invited student) can neither read nor write.
--     Access ends with the lesson (ended, or older than 12 hours).
--     For this to be enforced, Realtime Settings → "Allow public access" must be OFF
--     (see docs/supabase-setup.md, «Обновление: онлайн-урок»).
--
-- Assigned sets
--   * sets.allow_solution (default false): the coach allows the student to see the solution
--     before solving. Students read it only for their own sets (the existing sets RLS).
-- =====================================================================================

-- ------------------------------------------------------------------ sets.allow_solution
alter table public.sets add column if not exists allow_solution boolean not null default false;
grant update (title, source, allow_solution) on public.sets to authenticated;

-- ------------------------------------------------------------------ lessons
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches (user_id) on delete cascade,
  students uuid[] not null default '{}' check (cardinality(students) between 1 and 30),
  status text not null default 'live' check (status in ('live', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists lessons_coach_idx on public.lessons (coach_id, status);
create index if not exists lessons_students_idx on public.lessons using gin (students);

alter table public.lessons enable row level security;
revoke all on public.lessons from public, anon, authenticated;
grant select on public.lessons to authenticated;

drop policy if exists lessons_select_coach on public.lessons;
create policy lessons_select_coach on public.lessons for select to authenticated
  using (coach_id = (select auth.uid()) and public.is_coach());

-- A lesson counts as live for 12 hours at most (a forgotten lesson closes by itself).
create or replace function public._lesson_live(p_status text, p_started timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select p_status = 'live' and p_started > now() - interval '12 hours'
$$;

-- Coach starts a lesson for some of their students. Other live lessons of this coach are ended.
create or replace function public.start_lesson(p_students uuid[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  if not public.is_coach() then return jsonb_build_object('ok', false, 'error', 'not_a_coach'); end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_students, '{}')) as x;
  if cardinality(v_ids) < 1 then return jsonb_build_object('ok', false, 'error', 'no_students'); end if;
  if cardinality(v_ids) > 30 then return jsonb_build_object('ok', false, 'error', 'too_many_students'); end if;
  -- every invited student must be this coach's student
  if exists (select 1 from unnest(v_ids) as x
             where not exists (select 1 from public.students s where s.id = x and s.coach_id = auth.uid())) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  update public.lessons set status = 'ended', ended_at = now()
   where coach_id = auth.uid() and status = 'live';
  insert into public.lessons (coach_id, students) values (auth.uid(), v_ids) returning id into v_id;
  return jsonb_build_object('ok', true, 'lesson_id', v_id);
end $$;

-- Only the coach of the lesson can end it.
create or replace function public.end_lesson(p_lesson uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_coach() then return jsonb_build_object('ok', false, 'error', 'not_a_coach'); end if;
  update public.lessons set status = 'ended', ended_at = coalesce(ended_at, now())
   where id = p_lesson and coach_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Student: the live lesson they are invited to (or null). Only id, coach name, start time.
create or replace function public.my_live_lesson() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('lesson_id', l.id, 'coach_name', c.display_name, 'started_at', l.started_at)
    from public.lessons l join public.coaches c on c.user_id = l.coach_id
   where public.my_student_id() is not null
     and public.my_student_id() = any (l.students)
     and public._lesson_live(l.status, l.started_at)
   order by l.started_at desc
   limit 1
$$;

-- Realtime access check for a channel topic. p_write: insert (send/track) vs select (receive).
create or replace function public.lesson_topic_ok(p_topic text, p_extension text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_m text[];
  v_l public.lessons%rowtype;
  v_coach boolean;
  v_member boolean;
  v_sid uuid;
begin
  if auth.uid() is null or p_topic is null then return false; end if;
  v_m := regexp_match(p_topic, '^lesson:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(c|s)$');
  if v_m is null then return false; end if;
  select * into v_l from public.lessons where id = v_m[1]::uuid;
  if not found or not public._lesson_live(v_l.status, v_l.started_at) then return false; end if;
  v_coach := v_l.coach_id = auth.uid() and public.is_coach();
  v_sid := public.my_student_id();
  v_member := v_sid is not null and v_sid = any (v_l.students);
  if not (v_coach or v_member) then return false; end if;
  if v_m[2] = 'c' then
    -- coach's channel: broadcast only; the coach writes, everyone in the lesson reads
    return p_extension = 'broadcast' and (not p_write or v_coach);
  end if;
  -- students' channel
  if p_extension = 'presence' then return true; end if;            -- who is in the lesson
  if p_extension = 'broadcast' then return p_write or v_coach; end if; -- proposals: only the coach reads
  return false;
end $$;

-- ------------------------------------------------------------------ Realtime policies
-- realtime.messages already has RLS enabled in Supabase; these policies only add access
-- to the lesson topics above. Other topics stay closed for private channels.
drop policy if exists lesson_members_receive on realtime.messages;
create policy lesson_members_receive on realtime.messages for select to authenticated
  using (public.lesson_topic_ok((select realtime.topic()), realtime.messages.extension, false));
drop policy if exists lesson_members_send on realtime.messages;
create policy lesson_members_send on realtime.messages for insert to authenticated
  with check (public.lesson_topic_ok((select realtime.topic()), realtime.messages.extension, true));

-- ------------------------------------------------------------------ privileges
revoke execute on function public._lesson_live(text, timestamptz) from public, anon;
grant execute on function public._lesson_live(text, timestamptz) to authenticated;
revoke execute on function public.start_lesson(uuid[]), public.end_lesson(uuid), public.my_live_lesson(),
  public.lesson_topic_ok(text, text, boolean)
  from public, anon;
grant execute on function public.start_lesson(uuid[]), public.end_lesson(uuid), public.my_live_lesson(),
  public.lesson_topic_ok(text, text, boolean)
  to authenticated;
