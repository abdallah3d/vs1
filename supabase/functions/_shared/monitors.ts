import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { sendPush } from "./push.ts";

type Monitor = { id: string; user_id: string; name: string; url: string };

export type CheckResult = {
  monitor_id: string;
  user_id: string;
  ok: boolean;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
};

const TIMEOUT_MS = 10_000;

async function checkOne(m: Monitor): Promise<CheckResult> {
  const started = performance.now();
  try {
    const res = await fetch(m.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "Mashari3i-Monitor/1.0" },
    });
    await res.body?.cancel();
    return {
      monitor_id: m.id,
      user_id: m.user_id,
      ok: res.ok,
      status_code: res.status,
      latency_ms: Math.round(performance.now() - started),
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    return {
      monitor_id: m.id,
      user_id: m.user_id,
      ok: false,
      status_code: null,
      latency_ms: timedOut ? TIMEOUT_MS : null,
      error: timedOut ? "انتهت المهلة (10 ثواني)" : String(e instanceof Error ? e.message : e),
    };
  }
}

/**
 * Pings enabled monitors, records the results, and sends a push notification
 * when a monitor goes down or comes back up. `admin` must be a service-role
 * client because users cannot write monitor_checks.
 */
export async function runChecks(admin: SupabaseClient, userId?: string): Promise<CheckResult[]> {
  let query = admin.from("monitors").select("id, user_id, name, url").eq("enabled", true);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  const monitors = data as Monitor[];
  if (!monitors.length) return [];

  const { data: before, error: beforeError } = await admin
    .from("monitor_latest")
    .select("monitor_id, ok")
    .in("monitor_id", monitors.map((m) => m.id));
  if (beforeError) throw beforeError;
  const previous = new Map((before as { monitor_id: string; ok: boolean | null }[]).map((r) => [r.monitor_id, r.ok]));

  const results = await Promise.all(monitors.map(checkOne));
  const { error: insertError } = await admin.from("monitor_checks").insert(results);
  if (insertError) throw insertError;

  await notifyChanges(admin, monitors, results, previous);
  return results;
}

async function notifyChanges(
  admin: SupabaseClient,
  monitors: Monitor[],
  results: CheckResult[],
  previous: Map<string, boolean | null>,
) {
  // A first-ever check that fails counts as "went down"; a first success is not news.
  const changed = results.filter((r) => {
    const was = previous.get(r.monitor_id);
    return r.ok ? was === false : was !== false;
  });
  if (!changed.length) return;

  const userIds = [...new Set(changed.map((r) => r.user_id))];
  const { data } = await admin.from("user_settings").select("user_id, notify_monitors").in("user_id", userIds);
  const muted = new Set((data as { user_id: string; notify_monitors: boolean }[] ?? []).filter((s) => !s.notify_monitors).map((s) => s.user_id));
  const names = new Map(monitors.map((m) => [m.id, m.name]));

  for (const uid of userIds) {
    if (muted.has(uid)) continue;
    const mine = changed.filter((r) => r.user_id === uid);
    const down = mine.filter((r) => !r.ok);
    const up = mine.filter((r) => r.ok);
    const lines = [
      ...down.map((r) => `🔴 ${names.get(r.monitor_id)} واقف (${r.error ?? "بدون رد"})`),
      ...up.map((r) => `🟢 ${names.get(r.monitor_id)} رجع يشتغل`),
    ];
    await sendPush(admin, uid, {
      title: down.length ? "تنبيه مراقبة ⚠️" : "رجعت الروابط ✅",
      body: lines.join("\n"),
      data: { url: "/monitors" },
    });
  }
}
