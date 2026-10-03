-- المرحلة الثانية: إشعارات الجوال، الملخص الصباحي، وربط GitHub

-- ───────────── إعدادات المستخدم ─────────────
create table public.user_settings (
  user_id          uuid primary key default auth.uid() references auth.users on delete cascade,
  time_zone        text not null default 'Asia/Riyadh',
  brief_hour       int  not null default 8 check (brief_hour between 0 and 23),
  briefs_enabled   boolean not null default true,
  notify_monitors  boolean not null default true,
  updated_at       timestamptz not null default now()
);
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- ───────────── رموز إشعارات الجوال (Expo push tokens) ─────────────
create table public.push_tokens (
  token        text primary key,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  platform     text,
  last_seen_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

-- ───────────── الملخص الصباحي ─────────────
create table public.briefs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  local_date date not null,
  content    text not null,
  created_at timestamptz not null default now(),
  unique (user_id, local_date)
);

-- ───────────── مستودعات GitHub المربوطة بالمشاريع ─────────────
create table public.github_repos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  full_name  text not null check (full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  created_at timestamptz not null default now(),
  unique (user_id, full_name)
);
create index github_repos_project_idx on public.github_repos (project_id);

-- ───────────── الصلاحيات ─────────────
alter table public.user_settings enable row level security;
alter table public.push_tokens   enable row level security;
alter table public.briefs        enable row level security;
alter table public.github_repos  enable row level security;

create policy "own settings" on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own push tokens" on public.push_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- الملخص تكتبه دالة daily-brief بمفتاح الخدمة؛ المستخدم يقرأ فقط
create policy "read own briefs" on public.briefs
  for select using (user_id = auth.uid());
create policy "own github repos" on public.github_repos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────── تشديد: المهام والروابط لازم ترتبط بمشروع يملكه نفس المستخدم ─────────────
create function public.owns_project(p uuid) returns boolean
  language sql stable security invoker as $$
  select p is null or exists (select 1 from public.projects where id = p and user_id = auth.uid())
$$;

drop policy "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.owns_project(project_id));

drop policy "own monitors" on public.monitors;
create policy "own monitors" on public.monitors
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.owns_project(project_id));

drop policy "own github repos" on public.github_repos;
create policy "own github repos" on public.github_repos
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.owns_project(project_id));
