import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";

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
 * Pings enabled monitors and records the results. `admin` must be a
 * service-role client because users cannot write monitor_checks.
 */
export async function runChecks(admin: SupabaseClient, userId?: string): Promise<CheckResult[]> {
  let query = admin.from("monitors").select("id, user_id, name, url").eq("enabled", true);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw error;

  const results = await Promise.all((data as Monitor[]).map(checkOne));
  if (results.length) {
    const { error: insertError } = await admin.from("monitor_checks").insert(results);
    if (insertError) throw insertError;
  }
  return results;
}
