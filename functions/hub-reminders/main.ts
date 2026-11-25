// Runs every 15 minutes from pg_cron. Sends one letter a day, at each senior's chosen time (Dhaka time),
// for the next evening they haven't finished. Pauses after 3 quiet days, then one gentle letter a week, for up to 28 days.
// Needs header x-hub-cron = HUB_CRON_SECRET env, or the vault secret hub_cron_secret (checked via hub_cron_ok). Without RESEND_API_KEY it runs in test mode: it logs, sends nothing.
const SLOT: Record<string, number> = { "Morning": 8, "After lunch": 14, "Evening": 20, "Late night": 23 };
const Q: Record<number, [string, string]> = {
  1: ["Who you were before", "Go back to the time before it all began. Where were you, and what did you want?"],
  2: ["The moment it began", "Was there a moment you decided to try? Tell it like a scene."],
  3: ["Walk it again, slowly", "What were the steps, in the order you lived them?"],
  4: ["The night you almost stopped", "What was the lowest point? The night you almost stopped."],
  5: ["The day it became real", "How did you find out? Where were you, and who did you tell first?"],
  6: ["A letter to who you were", "If you could sit next to your younger self for ten minutes, what would you tell them?"],
  7: ["Your road, in your words", "Read your story back, and decide what you'd like to share."],
};
const DAY = 864e5;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = admin();
  const given = req.headers.get("x-hub-cron") || "";
  const envSecret = Deno.env.get("HUB_CRON_SECRET");
  const ok = (envSecret && given === envSecret) || (given && (await sb.rpc("hub_cron_ok", { p: given })).data === true);
  if (!ok) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const force = !!body?.force; // for a manual test run: ignore the time slot
  const only: string | undefined = typeof body?.journey === "string" ? body.journey : undefined; // test run for one journey
  const now = new Date(), dhaka = new Date(now.getTime() + 6 * 3600e3), hour = dhaka.getUTCHours(), today = dhaka.toISOString().slice(0, 10);
  const { data: js } = await sb.from("journeys").select("id, user_id, first_name, reminder_slot, status, started_at, last_active_at")
    .in("status", ["active", "paused"]).is("reminders_stopped_at", null).match(only ? { id: only } : {});
  const out: unknown[] = [];
  for (const j of js || []) {
    if (!force && SLOT[j.reminder_slot] !== hour) continue;
    if (now.getTime() - new Date(j.started_at).getTime() > 28 * DAY) continue;
    const { data: done } = await sb.from("journey_answers").select("day").eq("journey_id", j.id).not("completed_at", "is", null);
    const doneSet = new Set((done || []).map((d: any) => d.day));
    const next = [1, 2, 3, 4, 5, 6, 7].find(d => !doneSet.has(d));
    if (!next) continue;
    const { data: last } = await sb.from("hub_reminders").select("sent_at").eq("journey_id", j.id).not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle();
    const lastSent = last?.sent_at ? new Date(last.sent_at) : null;
    if (lastSent && new Date(lastSent.getTime() + 6 * 3600e3).toISOString().slice(0, 10) === today) continue;
    const quiet = (now.getTime() - new Date(j.last_active_at).getTime()) / DAY;
    if (j.status === "active" && quiet >= 3) { await sb.from("journeys").update({ status: "paused" }).eq("id", j.id); j.status = "paused"; }
    if (j.status === "paused" && lastSent && now.getTime() - lastSent.getTime() < 7 * DAY) continue;
    const { data: u } = await sb.auth.admin.getUserById(j.user_id);
    const email = u?.user?.email; if (!email) continue;
    const { data: w } = await sb.from("wizard_notes").select("ask").eq("journey_id", j.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const token = randomToken();
    await sb.from("hub_resume_tokens").insert({ token_hash: await sha256(token), journey_id: j.id });
    const base = HUB_URL();
    const [title, question] = Q[next];
    const paras = j.status === "paused"
      ? [`It's been a little while. No pressure at all. Your road book is exactly where you left it.`, `Whenever you have ten quiet minutes, we're on day ${next}: <b>${esc(title.toLowerCase())}</b>.`]
      : [w?.ask ? `Last time, the Wizard left you this to think about: <i>${esc(w.ask)}</i>` : `Thank you for starting this with us.`,
         `Tonight is day ${next}: <b>${esc(title.toLowerCase())}</b>. Your dragon is waiting with one question:`, `<i>${esc(question)}</i>`];
    const subject = j.status === "paused" ? `${j.first_name}, your road book is waiting` : `${j.first_name}, ${question.charAt(0).toLowerCase() + question.slice(1)}`;
    const res = await sendMail(email, subject.slice(0, 140), letter(j.first_name, paras, { href: `${base}/#resume=${token}`, label: "Sit with it now" },
      `Busy tonight? That's fine, we'll ask again tomorrow. <a href="${base}/#stop=${token}" style="color:#62675F">Stop these letters</a>.`));
    await sb.from("hub_reminders").upsert({ journey_id: j.id, day: next, channel: "email", due_at: now.toISOString(),
      sent_at: res.id ? now.toISOString() : null, provider_id: res.id || null, error: res.error || res.skipped || null }, { onConflict: "journey_id,day,channel" });
    out.push({ journey: j.id, day: next, result: res.id ? "sent" : (res.error || res.skipped) });
  }
  return json({ ran_at: now.toISOString(), dhaka_hour: hour, letters: out });
});
