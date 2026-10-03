// نشاط GitHub لمستودعات مشروع معيّن (تستخدمه شاشة المشروع في التطبيق).
import { corsHeaders, json, userClient } from "../_shared/http.ts";
import { runTool } from "../agent/tools.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const caller = await userClient(req);
  if (!caller) return json({ error: "غير مصرح" }, 401);

  try {
    const body = await req.json().catch(() => ({})) as { project_id?: unknown };
    if (typeof body.project_id !== "string") return json({ error: "project_id مطلوب" }, 400);
    const repos = await runTool("get_github_activity", { project_id: body.project_id, days: 7 }, caller);
    return json({ repos: Array.isArray(repos) ? repos : [] });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
