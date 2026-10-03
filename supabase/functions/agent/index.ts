// الأجينت الذكي: يستقبل رسالة من التطبيق، يتكلم مع Claude، وينفذ الأدوات على بياناتك.
// مفتاح ANTHROPIC_API_KEY يبقى هنا في السيرفر (Supabase secrets) وما يوصل للجوال أبداً.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { corsHeaders, env, json, userClient } from "../_shared/http.ts";
import { runTool, TOOLS } from "./tools.ts";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type Row = { role: "user" | "assistant"; content: ContentBlockParam[] };

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 10;
const HISTORY_ROWS = 200;

// Kept constant: any change to system/tools between turns busts the prompt
// cache and invalidates earlier thinking blocks. Per-turn facts (the current
// date) go into the user message instead.
const SYSTEM = `You are the personal project assistant inside "مشاريعي", a private mobile app the user built to track their own projects and ideas.

What you do:
- Track projects and tasks: progress, what is overdue, what has gone stale, what to do next.
- Monitor the user's apps and websites through the monitor tools (uptime, latency, failures).
- Watch how the user uses this app (activity log) and point out patterns: neglected projects, streaks, days with no progress.
- Chat, brainstorm, and suggest concrete next steps.

How you work:
- Always look at the real data with the tools before answering questions about projects, tasks, monitors, or activity. Never invent projects, numbers, or statuses.
- When the user asks you to add or change something, do it with the tools, then say briefly what you changed. Don't create or change things the user didn't ask for; suggest them instead.
- Reply in the same language and dialect the user writes in (usually Gulf Arabic). Be short and practical: bullets for lists, no long preambles.
- Each user message starts with a [now: ...] line giving the current local date and time. Use it for anything date-related (overdue, "this week", due dates).
- When a monitor is down or a project has had no activity for a long time, mention it even if not asked.`;

function nowLine(timeZone: string): string {
  let tz = "Asia/Riyadh";
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    tz = timeZone;
  } catch { /* invalid zone from client: keep default */ }
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
  return `[now: ${stamp} (${tz})]`;
}

/** Merge consecutive same-role rows so a half-finished earlier turn never breaks alternation. */
function toMessages(rows: Row[]): MessageParam[] {
  const out: MessageParam[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (last && last.role === row.role) {
      last.content = [...(last.content as ContentBlockParam[]), ...row.content];
    } else {
      out.push({ role: row.role, content: [...row.content] });
    }
  }
  return out;
}

function isToolResultOnly(row: Row): boolean {
  return row.content.some((b) => b.type === "tool_result");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const caller = await userClient(req);
  if (!caller) return json({ error: "غير مصرح" }, 401);
  const { db } = caller;

  let body: { message?: unknown; timeZone?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const text = typeof body.message === "string" ? body.message.trim() : "";
  if (!text) return json({ error: "الرسالة فاضية" }, 400);
  if (text.length > 8000) return json({ error: "الرسالة طويلة مرة" }, 400);

  const save = async (row: Row) => {
    const { error } = await db.from("agent_messages").insert(row);
    if (error) throw new Error(error.message);
  };

  try {
    // Load recent history, oldest first. Trimming only ever removes rows from
    // the front, and the window must start on a real user turn.
    const { data, error } = await db
      .from("agent_messages")
      .select("role, content")
      .order("id", { ascending: false })
      .limit(HISTORY_ROWS);
    if (error) throw new Error(error.message);
    const rows = (data as Row[]).reverse();
    while (rows.length && (rows[0].role !== "user" || isToolResultOnly(rows[0]))) rows.shift();

    // A previous request that died mid-tool-call leaves tool_use blocks with
    // no results; answer them so the conversation stays valid.
    const pending: ContentBlockParam[] = [];
    const lastRow = rows.at(-1);
    if (lastRow?.role === "assistant") {
      for (const b of lastRow.content) {
        if (b.type === "tool_use") {
          pending.push({ type: "tool_result", tool_use_id: b.id, content: "Interrupted before this tool ran.", is_error: true });
        }
      }
    }

    const tz = typeof body.timeZone === "string" ? body.timeZone : "Asia/Riyadh";
    const userRow: Row = {
      role: "user",
      content: [...pending, { type: "text", text: `${nowLine(tz)}\n${text}` }],
    };
    await save(userRow);
    rows.push(userRow);

    const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
    const toolsUsed: string[] = [];
    let reply = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        tools: TOOLS,
        messages: toMessages(rows),
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        // If a safety classifier declines, the API retries on a suitable model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      console.log("usage", JSON.stringify(response.usage));

      // Store the assistant turn exactly as returned (thinking blocks included).
      const assistantRow: Row = { role: "assistant", content: response.content as ContentBlockParam[] };
      await save(assistantRow);
      rows.push(assistantRow);

      reply = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (response.stop_reason === "refusal") {
        reply ||= "ما أقدر أساعد في هذا الطلب.";
        break;
      }
      if (response.stop_reason === "max_tokens") {
        reply ||= "الرد طلع أطول من المسموح، جرب تسأل بشكل أدق.";
        break;
      }
      if (response.stop_reason !== "tool_use") break;

      const results: ContentBlockParam[] = await Promise.all(
        response.content
          .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
          .map(async (b): Promise<ContentBlockParam> => {
            toolsUsed.push(b.name);
            try {
              const out = await runTool(b.name, (b.input ?? {}) as Record<string, unknown>, caller);
              return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) };
            } catch (e) {
              return { type: "tool_result", tool_use_id: b.id, content: String(e instanceof Error ? e.message : e), is_error: true };
            }
          }),
      );
      const toolRow: Row = { role: "user", content: results };
      await save(toolRow);
      rows.push(toolRow);
    }

    await db.from("activity_log").insert({ event: "agent_message", meta: { tools: toolsUsed } });
    return json({ reply: reply || "تم.", tools_used: toolsUsed });
  } catch (e) {
    console.error(e);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "الضغط عالي على الخدمة، جرب بعد شوي." }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "مفتاح Claude غير صحيح. راجع ANTHROPIC_API_KEY في Supabase." }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `خطأ من Claude: ${e.message}` }, 502);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
