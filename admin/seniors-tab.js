/* Olio admin console: "Seniors' hub" tab.
   Drop-in module. Usage inside the console, after its Supabase client exists and an admin is signed in:
     <div id="seniors-hub"></div>
     <script src="seniors-tab.js"></script>
     <script>OlioSeniorsTab.mount(document.getElementById("seniors-hub"), supabaseClient)</script>
   Every read goes through admin_* RPCs that check public.is_admin(), so a non-admin sees nothing.
   Full names, emails and proof stay inside this tab. Never copy them into public roads. */
(function () {
  const STATUSES = ["active", "paused", "submitted", "kept_private", "withdrawn", "not_a_fit", "drafted"];
  const DAY_NAMES = ["", "Where it began", "The turn", "The steps", "The hard part", "What helped", "Proof and today", "Your letter"];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ago = t => { if (!t) return "never"; const d = (Date.now() - new Date(t)) / 864e5; return d < 1 ? "today" : Math.floor(d) + "d ago"; };
  const css = `
  .osh{font-family:Inter,system-ui,sans-serif;color:#1f2a24}
  .osh h2,.osh h3{font-family:Poppins,Inter,sans-serif;margin:.2em 0 .5em}
  .osh .funnel{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 16px}
  .osh .f{background:#eef3ec;border-radius:14px;padding:10px 14px;min-width:96px}
  .osh .f b{display:block;font-size:22px}
  .osh table{width:100%;border-collapse:collapse;font-size:14px}
  .osh th,.osh td{text-align:left;padding:8px;border-bottom:1px solid #e4e9e2;vertical-align:top}
  .osh tr.row{cursor:pointer}.osh tr.row:hover{background:#f6f8f4}
  .osh .pill{display:inline-block;border-radius:99px;padding:2px 10px;font-size:12px;background:#e8efe6}
  .osh .pill.quiet{background:#fbefd0}.osh .pill.sub{background:#d8ecdf}
  .osh .card{background:#fff;border:1px solid #e4e9e2;border-radius:16px;padding:14px;margin:10px 0}
  .osh .priv{background:#fff7e8;border-color:#f1dfb5}
  .osh button{border:0;border-radius:99px;padding:8px 16px;background:#2f6b4f;color:#fff;cursor:pointer;margin:4px 6px 4px 0}
  .osh button.ghost{background:#e8efe6;color:#1f2a24}
  .osh pre{white-space:pre-wrap;font-family:inherit;margin:0}
  .osh .q{color:#5b6b61;font-size:13px;margin-top:8px}`;

  function mount(el, sb) {
    if (!document.getElementById("osh-css")) { const s = document.createElement("style"); s.id = "osh-css"; s.textContent = css; document.head.appendChild(s); }
    el.classList.add("osh");
    list();

    async function list() {
      el.innerHTML = "<p>Loading seniors…</p>";
      const { data, error } = await sb.rpc("admin_hub_list");
      if (error) { el.innerHTML = `<p>Could not load: ${esc(error.message)}</p>`; return; }
      const n = s => data.filter(s).length;
      el.innerHTML = `<h2>Seniors' hub</h2>
        <div class="funnel">
          <div class="f"><b>${data.length}</b>started</div>
          <div class="f"><b>${n(r => r.days_done >= 3)}</b>reached day 3</div>
          <div class="f"><b>${n(r => r.days_done >= 7 || ["submitted", "drafted"].includes(r.status))}</b>finished</div>
          <div class="f"><b>${n(r => r.shared)}</b>agreed to share</div>
          <div class="f"><b>${n(r => r.senior_road_id)}</b>road drafted</div>
          <div class="f"><b>${n(r => r.status === "paused")}</b>gone quiet</div>
        </div>
        <table><thead><tr><th>Senior</th><th>Field</th><th>Progress</th><th>Status</th><th>Last active</th><th>Letters</th><th>Brought by</th></tr></thead>
        <tbody>${data.map(r => `<tr class="row" data-id="${r.id}">
          <td><b>${esc(r.first_name)}</b><br><span class="q">${esc(r.headline || "")}</span></td>
          <td>${esc(r.field || "")}</td>
          <td>${r.days_done}/7 days</td>
          <td><span class="pill ${r.status === "paused" ? "quiet" : r.status === "submitted" ? "sub" : ""}">${esc(r.status)}</span>${r.shared ? " ✓ share" : ""}</td>
          <td>${ago(r.last_active_at)}</td>
          <td>${r.reminders_opened}/${r.reminders_sent} opened</td>
          <td>${esc(r.referrer_name || r.invited_by || "")}</td></tr>`).join("") || `<tr><td colspan="7">No seniors yet.</td></tr>`}</tbody></table>`;
      el.querySelectorAll("tr.row").forEach(tr => tr.onclick = () => detail(tr.dataset.id));
    }

    async function signed(path) {
      const { data } = await sb.storage.from("senior-media").createSignedUrl(path, 600);
      return data && data.signedUrl;
    }

    function mediaPaths(v, out = []) {
      if (typeof v === "string" && /^hub(-proof)?\//.test(v)) out.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(x => mediaPaths(x, out));
      return out;
    }

    async function detail(id) {
      el.innerHTML = "<p>Loading…</p>";
      const { data: d, error } = await sb.rpc("admin_hub_journey", { p_id: id });
      if (error || !d) { el.innerHTML = `<p>Could not load: ${esc(error ? error.message : "not allowed")}</p>`; return; }
      const j = d.journey, p = d.private || {};
      const consent = (d.consents || []).filter(c => !c.withdrawn_at).pop();
      const proofUrl = p.proof_path ? await signed(p.proof_path) : null;
      const answers = await Promise.all((d.answers || []).map(async a => {
        const media = await Promise.all(mediaPaths(a.answers).map(async m => ({ m, u: await signed(m) })));
        return { a, media };
      }));
      el.innerHTML = `<button class="ghost" id="osh-back">← All seniors</button>
        <h2>${esc(j.first_name)} <span class="pill">${esc(j.status)}</span></h2>
        <p>${esc(j.field || "")} · ${esc(j.headline || "")} · started ${ago(j.started_at)}, last active ${ago(j.last_active_at)}</p>
        <div class="card priv"><h3>Team only</h3>
          <p>Full name: ${esc(p.full_name || "")}<br>Email: ${esc(p.email || "")}<br>
          Proof: ${esc(p.proof_type || "none yet")} ${p.proof_link ? `· <a href="${esc(p.proof_link)}" target="_blank" rel="noopener">link</a>` : ""} ${proofUrl ? `· <a href="${esc(proofUrl)}" target="_blank" rel="noopener">file</a>` : ""}
          ${p.proof_checked_at ? `<br>Proof checked ${ago(p.proof_checked_at)}` : ""}</p>
          <pre>${esc(p.team_notes || "")}</pre></div>
        <div class="card"><h3>Consent</h3><p>${consent ? `Agreed to share (${ago(consent.given_at)}). ${esc(JSON.stringify(Object.fromEntries(Object.entries(consent).filter(([k]) => /^share_|name_/.test(k)))))}` : "No active consent. Do not publish anything."}</p></div>
        ${answers.map(({ a, media }) => `<div class="card"><h3>Day ${a.day}: ${DAY_NAMES[a.day] || ""} ${a.completed_at ? "✓" : "(in progress)"}</h3>
          <pre>${esc(JSON.stringify(a.answers, null, 2))}</pre>
          ${media.map(x => x.u ? `<p><audio controls src="${esc(x.u)}"></audio> <a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.m.split("/").pop())}</a></p>` : "").join("")}</div>`).join("")}
        <div class="card"><h3>What the Wizard reflected back</h3>${(d.wizard || []).map(w => `<p class="q">Day ${esc(w.day)}: ${esc(w.note || w.text || "")}</p>`).join("") || "<p>None yet.</p>"}</div>
        <div class="card"><h3>Actions</h3>
          <select id="osh-status">${STATUSES.map(s => `<option ${s === j.status ? "selected" : ""}>${s}</option>`).join("")}</select>
          <input id="osh-note" placeholder="Team note (optional)" style="width:280px;padding:7px;border-radius:10px;border:1px solid #ccd">
          <button id="osh-save">Save status</button>
          <button class="ghost" id="osh-proof" ${p.proof_type ? "" : "disabled"}>Mark proof checked</button>
          <button id="osh-draft" ${consent && !j.senior_road_id ? "" : "disabled"}>Draft a road from this</button>
          ${j.senior_road_id ? `<p>Road drafted: ${esc(j.senior_road_id)} (review it in Senior roads before publishing)</p>` : ""}</div>`;
      const act = async (fn, args, msg) => { const { error } = await sb.rpc(fn, args); if (error) alertBox(error.message); else { alertBox(msg); detail(id); } };
      el.querySelector("#osh-back").onclick = list;
      el.querySelector("#osh-save").onclick = () => act("admin_hub_set_status", { p_id: id, p_status: el.querySelector("#osh-status").value, p_note: el.querySelector("#osh-note").value || null }, "Saved.");
      el.querySelector("#osh-proof").onclick = () => act("admin_hub_mark_proof", { p_id: id }, "Proof marked as checked.");
      el.querySelector("#osh-draft").onclick = () => act("admin_hub_draft_road", { p_id: id }, "Draft road created. It uses first name only and stays unpublished until you review it.");
    }

    function alertBox(m) { const b = document.createElement("div"); b.className = "card"; b.textContent = m; el.prepend(b); setTimeout(() => b.remove(), 4000); }
  }
  window.OlioSeniorsTab = { mount };
})();
