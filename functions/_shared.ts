// Shared helpers for the Senior's Hub edge functions (inlined into each function on deploy).
import { createClient } from "npm:@supabase/supabase-js@2.48.1";
export const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-cron", "Access-Control-Allow-Methods": "POST, OPTIONS" };
export const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
export const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
export const HUB_URL = () => (Deno.env.get("HUB_URL") || "https://olio-seniors.netlify.app").replace(/\/$/, "");
export async function sha256(s: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
export function randomToken() { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export async function sendMail(to: string, subject: string, html: string): Promise<{ id?: string; skipped?: string; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { skipped: "test mode: no RESEND_API_KEY set" };
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("HUB_FROM") || "Olio <onboarding@resend.dev>", to, subject, html }) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { id: j.id } : { error: String(j.message || r.status) };
}
export function letter(first: string, paras: string[], cta: { href: string; label: string }, foot: string) {
  return `<div style="background:#EFECE6;padding:24px 12px;font-family:Inter,Arial,sans-serif;color:#2A2E28">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:22px;padding:28px 24px">
  <p style="font:800 24px Poppins,Arial,sans-serif;color:#2F5240;margin:0 0 18px">olio</p>
  <p style="font-size:16px;line-height:1.6;margin:0 0 14px">Hi ${esc(first)},</p>
  ${paras.map(p => `<p style="font-size:16px;line-height:1.6;margin:0 0 14px">${p}</p>`).join("")}
  <p style="margin:22px 0"><a href="${cta.href}" style="display:inline-block;background:#B4623F;color:#fff;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:999px">${esc(cta.label)}</a></p>
  <p style="font-size:13px;line-height:1.5;color:#62675F;margin:18px 0 0">${foot}</p></div></div>`;
}
