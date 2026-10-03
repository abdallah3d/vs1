-- مخطط قاعدة بيانات تطبيق "مشاريعي"
-- كل جدول محمي بـ RLS: كل مستخدم يشوف بياناته فقط.

create extension if not exists pgcrypto;

-- ───────────── المشاريع ─────────────
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (length(name) between 1 and 200),
  description text,
  status      text not null default 'active' check (status in ('idea', 'active', 'paused', 'done')),
  color       text not null default '#6366F1',
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ───────────── المهام ─────────────
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  project_id   uuid not null references public.projects on delete cascade,
  title        text not null check (length(title) between 1 and 500),
  notes        text,
  status       text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date     date,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index tasks_project_idx on public.tasks (project_id);

-- ───────────── المراقبة (روابط التطبيقات والمواقع) ─────────────
create table public.monitors (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  project_id uuid references public.projects on delete set null,
  name       text not null,
  url        text not null check (url ~* '^https?://'),
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.monitor_checks (
  id          bigint generated always as identity primary key,
  monitor_id  uuid not null references public.monitors on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  ok          boolean not null,
  status_code int,
  latency_ms  int,
  error       text,
  checked_at  timestamptz not null default now()
);
create index monitor_checks_monitor_idx on public.monitor_checks (monitor_id, checked_at desc);

-- آخر فحص لكل رابط
create view public.monitor_latest with (security_invoker = true) as
select distinct on (m.id)
  m.id as monitor_id, m.user_id, m.project_id, m.name, m.url, m.enabled,
  c.ok, c.status_code, c.latency_ms, c.error, c.checked_at
from public.monitors m
left join public.monitor_checks c on c.monitor_id = m.id
order by m.id, c.checked_at desc nulls last;

-- ───────────── سجل النشاط (مراقبة استخدامك للتطبيق) ─────────────
create table public.activity_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  event      text not null,
  project_id uuid references public.projects on delete set null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_user_idx on public.activity_log (user_id, created_at desc);

-- ───────────── محادثة الأجينت ─────────────
-- content يُخزَّن كما رجع من Claude (كتل كاملة) حتى نعيد إرساله بدون تعديل.
create table public.agent_messages (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    jsonb not null,
  created_at timestamptz not null default now()
);
create index agent_messages_user_idx on public.agent_messages (user_id, id);

-- ───────────── updated_at تلقائي ─────────────
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- completed_at يتعبى/ينمسح حسب حالة المهمة
create function public.tasks_completed_at() returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger tasks_completed before insert or update on public.tasks
  for each row execute function public.tasks_completed_at();

-- ───────────── الصلاحيات (RLS) ─────────────
alter table public.projects       enable row level security;
alter table public.tasks          enable row level security;
alter table public.monitors       enable row level security;
alter table public.monitor_checks enable row level security;
alter table public.activity_log   enable row level security;
alter table public.agent_messages enable row level security;

create policy "own projects" on public.projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own tasks" on public.tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own monitors" on public.monitors
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- نتائج الفحص تكتبها دالة monitor-check بمفتاح الخدمة؛ المستخدم يقرأ فقط
create policy "read own checks" on public.monitor_checks
  for select using (user_id = auth.uid());
create policy "own activity" on public.activity_log
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own agent messages" on public.agent_messages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
