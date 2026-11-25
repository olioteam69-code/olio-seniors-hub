# Olio Senior's Hub

A seven-evening journey where seniors tell the road they walked. The dragon guides each evening; the Wizard listens and reflects back only the senior's own words.

- `site/` — the hub (static, deployed to olio-seniors.netlify.app). Supabase publishable key only.
- `functions/` — Supabase Edge Functions: `hub-start` (passwordless start), `hub-resume` (links in reminder letters, stop letters), `hub-reminders` (daily letters via Resend; needs `RESEND_API_KEY`, `HUB_CRON_SECRET`).
- `sql/` — tables, row-level security, storage policies and admin functions.
- `admin/seniors-tab.js` — the Seniors' hub tab for the admin console.

Reminder emails stay off until a Resend key is added as an Edge Function secret and the cron job is scheduled.
Never commit keys or OAuth client files to this repo.
