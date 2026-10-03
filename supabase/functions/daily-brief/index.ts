// الملخص الصباحي: Claude يقرأ مشاريعك ومهامك وروابطك ونشاطك و GitHub، ويكتب لك
// ملخص قصير ويرسله إشعار على جوالك.
// - من الجدولة (pg_cron كل ساعة) مع x-cron-secret: يكتب لكل مستخدم وصلت ساعته المختارة ولم يُكتب له ملخص اليوم.
// - من التطبيق (زر "حدّث الملخص"): يكتب ملخص جديد للمستخدم الحالي فوراً.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { adminClient, corsHeaders, env, json, userClient } from "../_shared/http.ts";
import { sendPush } from "../_shared/push.ts";
import { runTool } from "../agent/tools.ts";

const MODEL = "claude-opus-5-5";

const SYSTEM = `You write the morning briefing for the user of "مشاريعي", a private app where they track their own projects, tasks, monitored websites/apps, and linked GitHub repos.

You get a JSON snapshot of their data. Write the briefing in Gulf Arabic, friendly and direct, as plain text (no markdown headings, no tables). Structure:
- Line 1: one short sentence that captures the most important thing today. It is used as the phone notification text, so it must stand alone.
- Then at most 8 short bullet lines starting with "•", covering only what matters: overdue or due-today tasks, high-priority work, monitors that are down or slow, GitHub activity worth noting (or a repo gone quiet), active projects with no recent activity, and yesterday's progress worth celebrating.
- End with one line starting with "👉" suggesting the single best next step.

Use only facts from the snapshot. Skip sections with nothing notable. If there is almost no data, say so briefly and suggest adding a first project or task.`;

type Settings = { user_id: string; time_zone: string; brief_hour: number; briefs_enabled: boolean };

function localParts(timeZone: string): { date: string; hour: number; label: string; tz: string } {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    tz = "Asia/Riyadh";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "long",
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), label: `${parts.weekday} ${parts.year}-${parts.month}-${parts.day}`, tz };
}

async function snapshot(admin: SupabaseClient, userId: string, today: string) {
  const ctx = { db: admin, userId };
  const safe = async (fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };
  const [projects, monitors, activity, github, focusTasks] = await Promise.all([
    safe(() => runTool("list_projects", {}, ctx)),
    safe(() => runTool("get_monitors_status", {}, ctx)),
    safe(() => runTool("get_activity", { days: 7 }, ctx)),
    safe(() => runTool("get_github_activity", { days: 1 }, ctx)),
    safe(async () => {
      const { data, error } = await admin
        .from("tasks")
        .select("title, status, priority, due_date, projects(name)")
        .eq("user_id", userId)
        .neq("status", "done")
        .or(`due_date.lte.${today},priority.eq.high,status.eq.doing`)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return data;
    }),
  ]);
  return { today, projects, focus_tasks: focusTasks, monitors, activity_last_7_days: activity, github_last_24h: github };
}

async function writeBrief(admin: SupabaseClient, client: Anthropic, s: Settings): Promise<string> {
  const local = localParts(s.time_zone);
  const data = await snapshot(admin, s.user_id, local.date);

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Today is ${local.label} (${local.tz}).\n\nSnapshot:\n${JSON.stringify(data)}` }],
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  console.log("usage", s.user_id, JSON.stringify(response.usage));
  if (response.stop_reason === "refusal") throw new Error("The model declined to write the brief");

  const content = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!content) throw new Error("Empty brief");

  const { error } = await admin
    .from("briefs")
    .upsert({ user_id: s.user_id, local_date: local.date, content, created_at: new Date().toISOString() }, { onConflict: "user_id,local_date" });
  if (error) throw new Error(error.message);
  return content;
}

async function settingsFor(admin: SupabaseClient, userIds?: string[]): Promise<Settings[]> {
  // Everyone who has a project or a settings row is a candidate; missing settings use defaults.
  let ids = userIds;
  if (!ids) {
    const [{ data: p }, { data: st }] = await Promise.all([
      admin.from("projects").select("user_id"),
      admin.from("user_settings").select("user_id"),
    ]);
    ids = [...new Set([...(p ?? []), ...(st ?? [])].map((r: { user_id: string }) => r.user_id))];
  }
  if (!ids.length) return [];
  const { data, error } = await admin.from("user_settings").select("user_id, time_zone, brief_hour, briefs_enabled").in("user_id", ids);
  if (error) throw new Error(error.message);
  const byId = new Map((data as Settings[]).map((r) => [r.user_id, r]));
  return ids.map((id) => byId.get(id) ?? { user_id: id, time_zone: "Asia/Riyadh", brief_hour: 8, briefs_enabled: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = adminClient();
    const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

    if (!isCron) {
      const caller = await userClient(req);
      if (!caller) return json({ error: "غير مصرح" }, 401);
      const [s] = await settingsFor(admin, [caller.userId]);
      const content = await writeBrief(admin, client, s);
      return json({ content });
    }

    // Scheduled run: due users whose local hour has reached their brief hour
    // and who don't have today's brief yet.
    const due: Settings[] = [];
    for (const s of await settingsFor(admin)) {
      if (!s.briefs_enabled) continue;
      const local = localParts(s.time_zone);
      if (local.hour < s.brief_hour) continue;
      const { count } = await admin.from("briefs").select("id", { count: "exact", head: true }).eq("user_id", s.user_id).eq("local_date", local.date);
      if (!count) due.push(s);
    }

    let written = 0;
    for (const s of due) {
      try {
        const content = await writeBrief(admin, client, s);
        await sendPush(admin, s.user_id, {
          title: "ملخصك الصباحي ☀️",
          body: content.split("\n")[0].slice(0, 180),
          data: { url: "/" },
        });
        written++;
      } catch (e) {
        console.error("brief failed", s.user_id, e);
      }
    }
    return json({ due: due.length, written });
  } catch (e) {
    console.error(e);
    if (e instanceof Anthropic.APIError) return json({ error: `خطأ من Claude: ${e.message}` }, 502);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
