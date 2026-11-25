import { createClient } from "npm:@supabase/supabase-js@2.48.1";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-cron", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const HUB_URL = () => (Deno.env.get("HUB_URL") || "https://olio-seniors.netlify.app").replace(/\/$/, "");
async function sha256(s: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function randomToken() { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
async function sendMail(to: string, subject: string, html: string): Promise<{ id?: string; skipped?: string; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { skipped: "test mode: no RESEND_API_KEY set" };
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("HUB_FROM") || "Olio <onboarding@resend.dev>", to, subject, html }) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { id: j.id } : { error: String(j.message || r.status) };
}
function letter(first: string, paras: string[], cta: { href: string; label: string }, foot: string) {
  return `<div style="background:#EFECE6;padding:24px 12px;font-family:Inter,Arial,sans-serif;color:#2A2E28">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:22px;padding:28px 24px">
  <p style="font:800 24px Poppins,Arial,sans-serif;color:#2F5240;margin:0 0 18px">olio</p>
  <p style="font-size:16px;line-height:1.6;margin:0 0 14px">Hi ${esc(first)},</p>
  ${paras.map(p => `<p style="font-size:16px;line-height:1.6;margin:0 0 14px">${p}</p>`).join("")}
  <p style="margin:22px 0"><a href="${cta.href}" style="display:inline-block;background:#B4623F;color:#fff;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:999px">${esc(cta.label)}</a></p>
  <p style="font-size:13px;line-height:1.5;color:#62675F;margin:18px 0 0">${foot}</p></div></div>`;
}

// POST { email } -> { token_hash } for a new senior, or { exists: true } after emailing a sign-in link to an existing one.
// The browser exchanges token_hash with supabase.auth.verifyOtp({ type: "magiclink", token_hash }). Supabase itself sends no email.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const email = String(b?.email || "").trim().toLowerCase();
  const first = String(b?.first || "").trim().slice(0, 60);
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(email)) return json({ error: "Please check your email address." }, 400);
  const sb = admin();
  const { error: ce } = await sb.auth.admin.createUser({ email, email_confirm: true, user_metadata: { source: "seniors-hub" } });
  if (ce && !/already|registered|exists/i.test(ce.message)) return json({ error: "We couldn't start right now. Please try again." }, 500);
  const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) return json({ error: "We couldn't start right now. Please try again." }, 500);
  if (!ce) return json({ token_hash: data.properties.hashed_token });
  // Someone already uses this email: never sign the browser in. Send the link to the inbox instead.
  const href = `${HUB_URL()}/#login=${encodeURIComponent(data.properties.hashed_token)}`;
  const sent = await sendMail(email, "Your way back into the Olio Senior's Hub", letter(first || "there",
    ["Someone, hopefully you, asked to start the Senior's Hub with this email. You already have a place with us, so here is your way back in.", "This link works for one hour."],
    { href, label: "Continue my road" }, "If this wasn't you, you can ignore this email."));
  return json({ exists: true, emailed: !!sent.id });
});
