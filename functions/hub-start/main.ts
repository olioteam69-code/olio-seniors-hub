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
