import type Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { adminClient } from "../_shared/http.ts";
import { runChecks } from "../_shared/monitors.ts";

type Input = Record<string, unknown>;

const PROJECT_STATUSES = ["idea", "active", "paused", "done"];
const TASK_STATUSES = ["todo", "doing", "done"];
const PRIORITIES = ["low", "medium", "high"];

// The tool list is a constant so the request prefix stays byte-identical
// between turns (prompt cache + preserved thinking both depend on it).
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_projects",
    description:
      "List the user's projects with progress (done/total tasks), overdue task count, and when each was last touched. Call this first whenever the user asks about their projects in general.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: PROJECT_STATUSES, description: "Optional filter by project status." },
      },
    },
  },
  {
    name: "get_project",
    description: "Full detail for one project: its fields, all tasks, and linked monitors with their latest check.",
    input_schema: {
      type: "object",
      properties: { project_id: { type: "string" } },
      required: ["project_id"],
    },
  },
  {
    name: "create_project",
    description: "Create a new project. Only when the user asks for it.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: PROJECT_STATUSES },
        due_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_project",
    description: "Change a project's name, description, status, or due date. Omit fields you are not changing.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: PROJECT_STATUSES },
        due_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "create_task",
    description: "Add a task to a project.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        priority: { type: "string", enum: PRIORITIES },
        due_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["project_id", "title"],
    },
  },
  {
    name: "update_task",
    description: "Update a task: mark it done/doing/todo, rename it, or change priority or due date.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        status: { type: "string", enum: TASK_STATUSES },
        title: { type: "string" },
        priority: { type: "string", enum: PRIORITIES },
        due_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_monitors_status",
    description:
      "Status of every monitored URL: latest result, uptime % and average latency over the last 24 hours, and recent failures.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_monitors_now",
    description: "Ping all of the user's monitored URLs right now and return fresh results.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "add_monitor",
    description: "Start monitoring a URL (website, API health endpoint, app backend).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        url: { type: "string", description: "Must start with http:// or https://" },
        project_id: { type: "string" },
      },
      required: ["name", "url"],
    },
  },
  {
    name: "get_activity",
    description:
      "How the user has been using this app: events per day, counts per event type, tasks completed, and projects with no activity in the period.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 90, description: "Look-back window, default 7." } },
    },
  },
];

function str(input: Input, key: string, required = false): string | undefined {
  const v = input[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`"${key}" is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new Error(`"${key}" must be a string`);
  return v.trim();
}

function oneOf(input: Input, key: string, allowed: string[]): string | undefined {
  const v = str(input, key);
  if (v !== undefined && !allowed.includes(v)) throw new Error(`"${key}" must be one of ${allowed.join(", ")}`);
  return v;
}

function date(input: Input, key: string): string | undefined {
  const v = str(input, key);
  if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`"${key}" must be YYYY-MM-DD`);
  return v;
}

function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

async function log(db: SupabaseClient, event: string, projectId: string | null, meta: Record<string, unknown> = {}) {
  await db.from("activity_log").insert({ event, project_id: projectId, meta: { ...meta, source: "agent" } });
}

type Ctx = { db: SupabaseClient; userId: string };

export async function runTool(name: string, input: Input, { db, userId }: Ctx): Promise<unknown> {
  switch (name) {
    case "list_projects": {
      let q = db.from("projects").select("id, name, description, status, due_date, updated_at, tasks(status, due_date, updated_at)");
      const status = oneOf(input, "status", PROJECT_STATUSES);
      if (status) q = q.eq("status", status);
      const rows = must(await q.order("updated_at", { ascending: false })) as Array<{
        id: string; name: string; description: string | null; status: string; due_date: string | null; updated_at: string;
        tasks: Array<{ status: string; due_date: string | null; updated_at: string }>;
      }>;
      const today = new Date().toISOString().slice(0, 10);
      return rows.map(({ tasks, ...p }) => {
        const lastTouched = [p.updated_at, ...tasks.map((t) => t.updated_at)].sort().at(-1);
        return {
          ...p,
          tasks_total: tasks.length,
          tasks_done: tasks.filter((t) => t.status === "done").length,
          tasks_doing: tasks.filter((t) => t.status === "doing").length,
          tasks_overdue: tasks.filter((t) => t.status !== "done" && t.due_date && t.due_date < today).length,
          last_touched: lastTouched,
        };
      });
    }

    case "get_project": {
      const id = str(input, "project_id", true)!;
      const project = must(await db.from("projects").select("*").eq("id", id).maybeSingle());
      if (!project) throw new Error("Project not found");
      const tasks = must(await db.from("tasks").select("id, title, notes, status, priority, due_date, completed_at").eq("project_id", id).order("created_at"));
      const monitors = must(await db.from("monitor_latest").select("*").eq("project_id", id));
      return { project, tasks, monitors };
    }

    case "create_project": {
      const row = must(
        await db.from("projects").insert(defined({
          name: str(input, "name", true),
          description: str(input, "description"),
          status: oneOf(input, "status", PROJECT_STATUSES),
          due_date: date(input, "due_date"),
        })).select().single(),
      ) as { id: string; name: string };
      await log(db, "project_created", row.id, { name: row.name });
      return row;
    }

    case "update_project": {
      const id = str(input, "project_id", true)!;
      const patch = defined({
        name: str(input, "name"),
        description: str(input, "description"),
        status: oneOf(input, "status", PROJECT_STATUSES),
        due_date: date(input, "due_date"),
      });
      if (!Object.keys(patch).length) throw new Error("Nothing to update");
      const row = must(await db.from("projects").update(patch).eq("id", id).select().maybeSingle());
      if (!row) throw new Error("Project not found");
      await log(db, "project_updated", id, { fields: Object.keys(patch) });
      return row;
    }

    case "create_task": {
      const projectId = str(input, "project_id", true)!;
      const row = must(
        await db.from("tasks").insert(defined({
          project_id: projectId,
          title: str(input, "title", true),
          notes: str(input, "notes"),
          priority: oneOf(input, "priority", PRIORITIES),
          due_date: date(input, "due_date"),
        })).select().single(),
      ) as { id: string; title: string };
      await log(db, "task_created", projectId, { title: row.title });
      return row;
    }

    case "update_task": {
      const id = str(input, "task_id", true)!;
      const patch = defined({
        status: oneOf(input, "status", TASK_STATUSES),
        title: str(input, "title"),
        priority: oneOf(input, "priority", PRIORITIES),
        due_date: date(input, "due_date"),
      });
      if (!Object.keys(patch).length) throw new Error("Nothing to update");
      const row = must(await db.from("tasks").update(patch).eq("id", id).select().maybeSingle()) as
        | { project_id: string; title: string } | null;
      if (!row) throw new Error("Task not found");
      const event = patch.status === "done" ? "task_completed" : patch.status ? "task_reopened" : "task_updated";
      await log(db, event, row.project_id, { title: row.title });
      return row;
    }

    case "get_monitors_status": {
      const latest = must(await db.from("monitor_latest").select("*")) as Array<{ monitor_id: string }>;
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const checks = must(
        await db.from("monitor_checks").select("monitor_id, ok, latency_ms, error, checked_at").gte("checked_at", since).order("checked_at", { ascending: false }),
      ) as Array<{ monitor_id: string; ok: boolean; latency_ms: number | null; error: string | null; checked_at: string }>;
      return latest.map((m) => {
        const mine = checks.filter((c) => c.monitor_id === m.monitor_id);
        const latencies = mine.filter((c) => c.ok && c.latency_ms !== null).map((c) => c.latency_ms!);
        return {
          ...m,
          checks_24h: mine.length,
          uptime_24h_pct: mine.length ? Math.round((mine.filter((c) => c.ok).length / mine.length) * 1000) / 10 : null,
          avg_latency_ms_24h: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
          recent_failures: mine.filter((c) => !c.ok).slice(0, 5).map(({ error, checked_at }) => ({ error, checked_at })),
        };
      });
    }

    case "check_monitors_now":
      return await runChecks(adminClient(), userId);

    case "add_monitor": {
      const url = str(input, "url", true)!;
      if (!/^https?:\/\//i.test(url)) throw new Error("url must start with http:// or https://");
      const projectId = str(input, "project_id") ?? null;
      const row = must(await db.from("monitors").insert({ name: str(input, "name", true), url, project_id: projectId }).select().single());
      await log(db, "monitor_added", projectId, { url });
      return row;
    }

    case "get_activity": {
      const raw = input.days;
      const days = typeof raw === "number" && raw >= 1 && raw <= 90 ? Math.floor(raw) : 7;
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      const events = must(
        await db.from("activity_log").select("event, project_id, meta, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
      ) as Array<{ event: string; project_id: string | null; meta: Record<string, unknown>; created_at: string }>;
      const projects = must(await db.from("projects").select("id, name, status")) as Array<{ id: string; name: string; status: string }>;

      const perDay: Record<string, number> = {};
      const perEvent: Record<string, number> = {};
      const touched = new Set<string>();
      for (const e of events) {
        const day = e.created_at.slice(0, 10);
        perDay[day] = (perDay[day] ?? 0) + 1;
        perEvent[e.event] = (perEvent[e.event] ?? 0) + 1;
        if (e.project_id) touched.add(e.project_id);
      }
      return {
        days,
        total_events: events.length,
        events_per_day: perDay,
        events_by_type: perEvent,
        active_days: Object.keys(perDay).length,
        untouched_active_projects: projects.filter((p) => p.status === "active" && !touched.has(p.id)).map((p) => p.name),
        latest_events: events.slice(0, 25),
      };
    }

    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
