import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";

export type Push = { title: string; body: string; data?: Record<string, unknown> };

/**
 * Sends a notification to every device the user registered, through Expo's
 * push service. Tokens Expo reports as unregistered are deleted. `admin`
 * must be a service-role client. Never throws: a failed push must not fail
 * the job that triggered it.
 */
export async function sendPush(admin: SupabaseClient, userId: string, push: Push): Promise<number> {
  try {
    const { data, error } = await admin.from("push_tokens").select("token").eq("user_id", userId);
    if (error) throw error;
    const tokens = (data as { token: string }[]).map((r) => r.token);
    if (!tokens.length) return 0;

    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(
        tokens.map((to) => ({ to, title: push.title, body: push.body, data: push.data ?? {}, sound: "default", channelId: "default" })),
      ),
    });
    const payload = await res.json() as { data?: Array<{ status: string; details?: { error?: string } }> };

    const dead = (payload.data ?? [])
      .map((ticket, i) => (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered" ? tokens[i] : null))
      .filter((t): t is string => t !== null);
    if (dead.length) await admin.from("push_tokens").delete().in("token", dead);
    return tokens.length - dead.length;
  } catch (e) {
    console.error("push failed", e);
    return 0;
  }
}
