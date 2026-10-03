// يفحص روابط المراقبة ويسجل النتائج.
// - من التطبيق (زر "افحص الآن"): يفحص روابط المستخدم فقط.
// - من الجدولة (pg_cron) مع ترويسة x-cron-secret: يفحص كل الروابط.
import { adminClient, corsHeaders, json, userClient } from "../_shared/http.ts";
import { runChecks } from "../_shared/monitors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

    let userId: string | undefined;
    if (!isCron) {
      const caller = await userClient(req);
      if (!caller) return json({ error: "غير مصرح" }, 401);
      userId = caller.userId;
    }

    const results = await runChecks(adminClient(), userId);
    return json({
      checked: results.length,
      down: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
