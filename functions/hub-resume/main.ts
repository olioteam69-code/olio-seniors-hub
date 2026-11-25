// POST { token, action?: "stop" } -> { token_hash } (sign back in from a reminder email) or { stopped: true }.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const token = String(b?.token || "");
  if (token.length < 30 || token.length > 100) return json({ error: "This link isn't valid." }, 400);
  const sb = admin();
  const h = await sha256(token);
  const { data: t } = await sb.from("hub_resume_tokens").select("journey_id, expires_at").eq("token_hash", h).maybeSingle();
  if (!t || new Date(t.expires_at) < new Date()) return json({ error: "This link has expired. Open the newest email from us, or start again." }, 410);
  const { data: j } = await sb.from("journeys").select("id, user_id").eq("id", t.journey_id).single();
  if (!j) return json({ error: "This link isn't valid." }, 404);
  await sb.from("hub_resume_tokens").update({ used_at: new Date().toISOString() }).eq("token_hash", h);
  const { data: last } = await sb.from("hub_reminders").select("id").eq("journey_id", j.id).is("opened_at", null).not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (last) await sb.from("hub_reminders").update({ opened_at: new Date().toISOString() }).eq("id", last.id);
  if (b?.action === "stop") {
    await sb.from("journeys").update({ reminders_stopped_at: new Date().toISOString() }).eq("id", j.id);
    return json({ stopped: true });
  }
  const { data: u } = await sb.auth.admin.getUserById(j.user_id);
  if (!u?.user?.email) return json({ error: "This link isn't valid." }, 404);
  const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (error) return json({ error: "Please try again in a minute." }, 500);
  return json({ token_hash: data.properties.hashed_token });
});
