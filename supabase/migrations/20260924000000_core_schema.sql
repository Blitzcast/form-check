-- Core schema for FormCheck (exercise form checker).
--
-- Pose landmarks are computed in the browser. Video is never uploaded: only the numbers below.
--
--   profiles     one per Supabase Auth user (anonymous sign-in works).
--   exercises    catalog (like a food list). Server-managed; everyone can read it.
--   workouts     one training session.
--   sets         one set of one exercise. counted_reps is the app's count, actual_reps the user's.
--   reps         one rep: measured angles and the app's three calls (depth, torso, heels).
--   rep_labels   the user's own call on each check. Ground truth for the metrics.
--
--   check_metrics  per check: precision and recall of the app's "bad form" flags.
--   set_accuracy   rep-count accuracy (within ±1), camera visibility, fps, kill condition.
--   daily_stats    per user per day: workouts, sets, reps, share of good reps.
--
-- Rules are guesses, versioned by rules_version (e.g. 'v0-guess'). Not tuned or validated.

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Profiles ------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Exercises (catalog) -------------------------------------------------------

create table public.exercises (
  slug text primary key check (slug ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  camera_view text not null check (camera_view in ('side', 'front')),
  created_at timestamptz not null default now()
);

insert into public.exercises (slug, name, camera_view) values ('squat', 'Bodyweight squat', 'side');

-- Workouts ------------------------------------------------------------------

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  app_version text not null,
  rules_version text not null,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id), -- target for sets' composite FK
  check (ended_at is null or ended_at >= started_at)
);

create index workouts_user_started_idx on public.workouts (user_id, started_at);

-- Sets ----------------------------------------------------------------------

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  exercise_slug text not null references public.exercises (slug),
  set_number integer not null check (set_number > 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  counted_reps integer not null default 0 check (counted_reps >= 0), -- the app's count
  actual_reps integer check (actual_reps >= 0), -- entered by hand; null = not checked
  avg_fps numeric check (avg_fps >= 0),
  visible_frame_ratio numeric check (visible_frame_ratio between 0 and 1), -- frames with all needed landmarks
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workout_id, set_number),
  unique (id, user_id), -- target for reps' composite FK
  check (ended_at is null or ended_at >= started_at),
  -- A set can only belong to a workout owned by the same user.
  foreign key (workout_id, user_id) references public.workouts (id, user_id) on delete cascade
);

create index sets_user_idx on public.sets (user_id);
create index sets_exercise_idx on public.sets (exercise_slug);

-- Reps ----------------------------------------------------------------------

create table public.reps (
  id bigint generated always as identity primary key,
  set_id uuid not null,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  rep_number integer not null check (rep_number > 0),
  started_at timestamptz not null default now(),
  duration_ms integer not null check (duration_ms > 0),

  -- Measurements from the pose landmarks.
  min_knee_angle numeric check (min_knee_angle between 0 and 180), -- degrees at the bottom
  max_torso_lean numeric check (max_torso_lean between 0 and 90), -- degrees from vertical
  max_heel_lift numeric check (max_heel_lift >= 0), -- fraction of leg length

  -- The app's calls under rules_version.
  depth_ok boolean not null,
  torso_ok boolean not null,
  heels_ok boolean not null,

  created_at timestamptz not null default now(),
  unique (set_id, rep_number),
  unique (id, user_id), -- target for rep_labels' composite FK
  foreign key (set_id, user_id) references public.sets (id, user_id) on delete cascade
);

create index reps_user_idx on public.reps (user_id);

-- Rep labels (ground truth) -------------------------------------------------

create table public.rep_labels (
  rep_id bigint primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- null = not judged
  depth_ok boolean,
  torso_ok boolean,
  heels_ok boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (rep_id, user_id) references public.reps (id, user_id) on delete cascade
);

create index rep_labels_user_idx on public.rep_labels (user_id);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger workouts_updated_at before update on public.workouts
  for each row execute function public.set_updated_at();
create trigger sets_updated_at before update on public.sets
  for each row execute function public.set_updated_at();
create trigger rep_labels_updated_at before update on public.rep_labels
  for each row execute function public.set_updated_at();

-- Row level security --------------------------------------------------------
-- Users read and write only their own rows. exercises is readable by everyone and has no
-- write policies, so only the secret key can change the catalog.

alter table public.profiles enable row level security;
alter table public.exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.sets enable row level security;
alter table public.reps enable row level security;
alter table public.rep_labels enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "anyone reads exercises" on public.exercises
  for select to anon, authenticated using (true);

create policy "read own workouts" on public.workouts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own workouts" on public.workouts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own workouts" on public.workouts
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own workouts" on public.workouts
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "read own sets" on public.sets
  for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own sets" on public.sets
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own sets" on public.sets
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own sets" on public.sets
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "read own reps" on public.reps
  for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own reps" on public.reps
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own reps" on public.reps
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own reps" on public.reps
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "read own rep labels" on public.rep_labels
  for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own rep labels" on public.rep_labels
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own rep labels" on public.rep_labels
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own rep labels" on public.rep_labels
  for delete to authenticated using (user_id = (select auth.uid()));

-- Views (security_invoker, so each user only sees their own numbers) -------

-- One row per user, rules_version and check. A "flag" is the app calling a rep bad.
create view public.check_metrics
with (security_invoker = true) as
with rep_checks as (
  select r.user_id, w.rules_version, c.check_name, c.app_ok, c.label_ok
  from public.reps r
  join public.sets s on s.id = r.set_id
  join public.workouts w on w.id = s.workout_id
  left join public.rep_labels l on l.rep_id = r.id
  cross join lateral (values
    ('depth', r.depth_ok, l.depth_ok),
    ('torso', r.torso_ok, l.torso_ok),
    ('heels', r.heels_ok, l.heels_ok)
  ) as c (check_name, app_ok, label_ok)
),
counts as (
  select
    user_id,
    rules_version,
    check_name,
    count(*) as reps,
    count(*) filter (where not app_ok) as flagged,
    count(label_ok) as labeled,
    count(*) filter (where not app_ok and label_ok is not null) as flagged_labeled,
    count(*) filter (where not app_ok and label_ok = false) as true_flags,
    count(*) filter (where label_ok = false) as bad_reps_labeled
  from rep_checks
  group by user_id, rules_version, check_name
),
rates as (
  select
    *,
    round(true_flags::numeric / nullif(flagged_labeled, 0), 3) as precision_rate,
    round(true_flags::numeric / nullif(bad_reps_labeled, 0), 3) as recall_rate
  from counts
)
select *, precision_rate >= 0.8 as meets_precision
from rates;

create view public.set_accuracy
with (security_invoker = true) as
with counts as (
  select
    s.user_id,
    w.rules_version,
    count(*) as sets,
    count(s.actual_reps) as sets_checked,
    count(*) filter (where abs(s.counted_reps - s.actual_reps) <= 1) as sets_within_1,
    round(avg(s.visible_frame_ratio), 3) as avg_visible_frame_ratio,
    round(avg(s.avg_fps), 1) as avg_fps
  from public.sets s
  join public.workouts w on w.id = s.workout_id
  group by s.user_id, w.rules_version
),
rates as (
  select *, round(sets_within_1::numeric / nullif(sets_checked, 0), 3) as share_within_1
  from counts
)
select
  *,
  share_within_1 >= 0.95 as meets_count_target,
  sets_checked >= 10 and share_within_1 < 0.8 as kill
from rates;

create view public.daily_stats
with (security_invoker = true) as
select
  w.user_id,
  (w.started_at at time zone 'utc')::date as day,
  count(distinct w.id) as workouts,
  count(distinct s.id) as sets,
  count(r.id) as reps,
  count(*) filter (where r.depth_ok and r.torso_ok and r.heels_ok) as good_reps,
  round(count(*) filter (where r.depth_ok and r.torso_ok and r.heels_ok)::numeric
        / nullif(count(r.id), 0), 3) as share_good
from public.workouts w
left join public.sets s on s.workout_id = w.id
left join public.reps r on r.set_id = s.id
group by w.user_id, (w.started_at at time zone 'utc')::date;
