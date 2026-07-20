import { supabase, signOut } from "../assets/js/supabase-client.js";
import { requireAuth } from "../assets/js/auth-guard.js";
import { makeSlug, escapeHtml, toast } from "../assets/js/util.js";
import { initSidebar } from "../assets/js/admin-sidebar.js";

const listEl = document.getElementById("list");
let profile = null;

(async function init() {
  profile = await requireAuth();
  if (!profile) return;

  initSidebar(profile, "webinarios");
  document.getElementById("new-webinar").addEventListener("click", createWebinar);
  setupDashTabs();

  // Preenche campo de domínio da conta
  const domainInput = document.getElementById("account-domain");
  const domainCurrent = document.getElementById("domain-current");
  if (profile.custom_domain) {
    domainInput.value = profile.custom_domain;
    domainCurrent.textContent = profile.custom_domain;
  }
  document.getElementById("save-domain").addEventListener("click", async () => {
    const val = domainInput.value.trim().replace(/^https?:\/\//i, "") || null;
    const { error } = await supabase
      .from("profiles")
      .update({ custom_domain: val })
      .eq("id", profile.id);
    if (error) return toast("Erro ao salvar domínio: " + error.message, "error");
    profile.custom_domain = val;
    domainCurrent.textContent = val || "";
    toast("Domínio salvo!", "success");
    await loadList();
  });

  await loadList();
})();

async function loadList() {
  listEl.innerHTML = `<p class="muted">Carregando...</p>`;
  const { data, error } = await supabase
    .from("webinars")
    .select("id, title, slug, status, scheduled_start_at, updated_at, settings")
    .order("updated_at", { ascending: false });

  if (error) {
    listEl.innerHTML = `<div class="empty">Erro ao carregar: ${escapeHtml(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    listEl.innerHTML = `<div class="empty">Nenhum webinário ainda.<br>Clique em <b>+ Novo webinário</b> para começar.</div>`;
    return;
  }

  listEl.innerHTML = "";
  for (const w of data) {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="grow">
        <div class="row wrap" style="gap:.6rem; margin-bottom:.3rem;">
          <strong>${escapeHtml(w.title)}</strong>
          <span class="badge badge--${w.status}">${w.status === "published" ? "Publicado" : "Rascunho"}</span>
        </div>
      </div>
      <div class="row wrap">
        <button class="btn btn--sm" data-act="copy">Copiar link live</button>
        <button class="btn btn--sm" data-act="copy-sched">Link de agendamento</button>
        <a class="btn btn--sm" href="${publicUrl(w.slug, watchPage(w))}" target="_blank">Abrir live</a>
        <a class="btn btn--sm btn--primary" href="editor.html?id=${w.id}">Configurar</a>
        <a class="btn btn--sm" href="editor.html?id=${w.id}&tab=leads">Ver Leads</a>
        <button class="btn btn--sm" data-act="dup">Duplicar</button>
        <button class="btn btn--sm btn--danger" data-act="del">Excluir</button>
      </div>`;

    item.querySelector('[data-act="copy"]').addEventListener("click", () => copyLink(w.slug, watchPage(w)));
    item.querySelector('[data-act="copy-sched"]').addEventListener("click", () => copyScheduleLink(w.slug));
    item.querySelector('[data-act="dup"]').addEventListener("click", () => duplicate(w.id));
    item.querySelector('[data-act="del"]').addEventListener("click", () => remove(w.id, w.title));
    listEl.appendChild(item);
  }
}

function publicUrl(slug, page = "watch.html") {
  const domain = profile?.custom_domain;
  if (domain) return `https://${domain}/${page}?w=${encodeURIComponent(slug)}`;
  return new URL(`${page}?w=${encodeURIComponent(slug)}`, new URL("../", location.href)).href;
}

function watchPage(webinar) {
  return webinar?.settings?.layout === "vertical" ? "watch-vertical.html" : "watch.html";
}

async function copyLink(slug, page = "watch.html") {
  const url = publicUrl(slug, page);
  try { await navigator.clipboard.writeText(url); toast("Link copiado!", "success"); }
  catch { toast(url); }
}

function scheduleUrl(slug) {
  return publicUrl(slug, "schedule.html");
}

async function copyScheduleLink(slug) {
  const url = scheduleUrl(slug);
  try { await navigator.clipboard.writeText(url); toast("Link de agendamento copiado!", "success"); }
  catch { toast(url); }
}

async function createWebinar() {
  const title = "Novo webinário";
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("webinars")
    .insert({
      owner_id: u.user.id,
      title,
      slug: makeSlug(title),
      settings: { viewers: { base: 120, peak: 850, jitter: 12 }, waiting_text: "A transmissão vai começar em breve.", ended_text: "Esta transmissão foi encerrada." },
    })
    .select("id")
    .single();

  if (error) return toast("Erro: " + error.message, "error");
  window.location.href = `editor.html?id=${data.id}`;
}

async function duplicate(id) {
  const { data: u } = await supabase.auth.getUser();
  // Copia o webinário
  const { data: orig, error } = await supabase.from("webinars").select("*").eq("id", id).single();
  if (error) return toast("Erro: " + error.message, "error");

  const copy = {
    owner_id: u.user.id,
    title: orig.title + " (cópia)",
    slug: makeSlug(orig.title),
    status: "draft",
    video_url: orig.video_url,
    video_duration_seconds: orig.video_duration_seconds,
    scheduled_start_at: orig.scheduled_start_at,
    timezone: orig.timezone,
    settings: orig.settings,
  };
  const { data: nw, error: e2 } = await supabase.from("webinars").insert(copy).select("id").single();
  if (e2) return toast("Erro: " + e2.message, "error");

  // Copia filhos (comentários, ctas, banners)
  for (const tbl of ["comments", "ctas", "banners"]) {
    const { data: rows } = await supabase.from(tbl).select("*").eq("webinar_id", id);
    if (rows && rows.length) {
      const mapped = rows.map(({ id: _id, created_at, webinar_id, reply_to_id, ...rest }) => ({
        ...rest,
        webinar_id: nw.id,
        // reply_to_id apontaria para IDs do original; zeramos na cópia.
        ...(tbl === "comments" ? { reply_to_id: null } : {}),
      }));
      await supabase.from(tbl).insert(mapped);
    }
  }
  toast("Webinário duplicado!", "success");
  await loadList();
}

async function remove(id, title) {
  if (!confirm(`Excluir "${title}"? Esta ação não pode ser desfeita.`)) return;
  const { error } = await supabase.from("webinars").delete().eq("id", id);
  if (error) return toast("Erro: " + error.message, "error");
  toast("Webinário excluído.", "success");
  await loadList();
}

// =====================================================================
//  ABAS DO DASHBOARD
// =====================================================================
function setupDashTabs() {
  document.querySelectorAll("#dash-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#dash-tabs .tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active");
      if (tab.dataset.tab === "metrics") loadMetrics();
    });
  });
}

// =====================================================================
//  MÉTRICAS
// =====================================================================
let liveRefreshTimer = null;

async function loadMetrics() {
  const el = document.getElementById("metrics-content");
  el.innerHTML = `<p class="muted">Carregando...</p>`;

  if (liveRefreshTimer) { clearInterval(liveRefreshTimer); liveRefreshTimer = null; }

  const [metricsResult, liveCounts, reminderCounts] = await Promise.all([
    supabase.rpc("get_my_metrics"),
    loadLiveViewers(),
    loadReminderCounts(),
  ]);

  const { data, error } = metricsResult;
  if (error || !data) {
    el.innerHTML = `<div class="empty">Erro ao carregar métricas. Verifique se o SQL foi executado no Supabase.</div>`;
    return;
  }
  if (!data.length) {
    el.innerHTML = `<div class="empty">Nenhum webinário ainda.</div>`;
    return;
  }

  const totals = data.reduce((a, r) => ({
    leads: a.leads + (+r.leads || 0),
    schedule_views: a.schedule_views + (+r.schedule_views || 0),
    modal_opens: a.modal_opens + (+r.modal_opens || 0),
    avg_watch_seconds: a.avg_watch_seconds + (+r.avg_watch_seconds || 0),
  }), { leads: 0, schedule_views: 0, modal_opens: 0, avg_watch_seconds: 0 });

  const totalLive = Object.values(liveCounts).reduce((s, n) => s + n, 0);
  const avgWatchAll = data.length ? Math.round(totals.avg_watch_seconds / data.length) : 0;

  const fmtTime = (s) => {
    s = +s || 0;
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.8rem;margin-bottom:1.2rem;">
      ${statCard("🔴 Assistindo agora", totalLive, "live", "metrics-live-total")}
      ${statCard("Leads cadastrados", totals.leads)}
      ${statCard("Acessos agendamento", totals.schedule_views)}
      ${statCard("Modal de captura", totals.modal_opens)}
      ${statCard("Tempo médio", fmtTime(avgWatchAll), "text")}
      ${statCard("💬 Lembretes pré-aula", reminderCounts.pre)}
      ${statCard("✅ Follow-ups pós-aula", reminderCounts.pos)}
    </div>
    <div class="card" style="overflow-x:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem .8rem .2rem;">
        <strong style="font-size:.9rem;">Por webinário</strong>
        <small class="muted" id="metrics-updated"></small>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:.86rem;">
        <thead>
          <tr style="border-bottom:1px solid var(--border);color:var(--text-dim);">
            <th style="text-align:left;padding:.6rem .8rem;font-weight:600;">Webinário</th>
            <th style="text-align:right;padding:.6rem .8rem;">Agora 🔴</th>
            <th style="text-align:right;padding:.6rem .8rem;">Leads</th>
            <th style="text-align:right;padding:.6rem .8rem;">Agend.</th>
            <th style="text-align:right;padding:.6rem .8rem;">Modal</th>
            <th style="text-align:right;padding:.6rem .8rem;">Tempo médio</th>
          </tr>
        </thead>
        <tbody id="metrics-tbody">
          ${data.map((r) => `
            <tr style="border-bottom:1px solid var(--bg);" data-wid="${r.webinar_id || ""}">
              <td style="padding:.6rem .8rem;">
                <strong>${escapeHtml(r.title)}</strong>
                <span class="badge badge--${r.status}" style="margin-left:.4rem;">${r.status === "published" ? "Publicado" : "Rascunho"}</span>
              </td>
              <td style="text-align:right;padding:.6rem .8rem;" class="live-count">${liveCounts[r.webinar_id] || 0}</td>
              <td style="text-align:right;padding:.6rem .8rem;">${r.leads}</td>
              <td style="text-align:right;padding:.6rem .8rem;">${r.schedule_views}</td>
              <td style="text-align:right;padding:.6rem .8rem;">${r.modal_opens}</td>
              <td style="text-align:right;padding:.6rem .8rem;">${fmtTime(r.avg_watch_seconds)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  markUpdated();
  liveRefreshTimer = setInterval(async () => {
    const counts = await loadLiveViewers();
    refreshLiveCells(counts);
  }, 30000);
}

async function loadLiveViewers() {
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("live_presence")
    .select("webinar_id")
    .gte("last_seen", twoMinAgo);
  const counts = {};
  for (const row of (data || [])) {
    counts[row.webinar_id] = (counts[row.webinar_id] || 0) + 1;
  }
  return counts;
}

async function loadReminderCounts() {
  const [{ count: pre }, { count: pos }] = await Promise.all([
    supabase.from("lead_reminder_log").select("*", { count: "exact", head: true }).eq("type", "pre"),
    supabase.from("lead_reminder_log").select("*", { count: "exact", head: true }).eq("type", "pos"),
  ]);
  return { pre: pre || 0, pos: pos || 0 };
}

function refreshLiveCells(counts) {
  const rows = document.querySelectorAll("#metrics-tbody tr[data-wid]");
  let total = 0;
  rows.forEach((tr) => {
    const n = counts[tr.dataset.wid] || 0;
    total += n;
    const cell = tr.querySelector(".live-count");
    if (cell) cell.textContent = n;
  });
  const liveTotal = document.getElementById("metrics-live-total");
  if (liveTotal) liveTotal.textContent = total.toLocaleString("pt-BR");
  markUpdated();
}

function markUpdated() {
  const el = document.getElementById("metrics-updated");
  if (el) el.textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statCard(label, value, type = "number", id = "") {
  const display = type === "number"
    ? Number(value).toLocaleString("pt-BR")
    : String(value);
  const accent = type === "live" ? "color:#f87171;" : "color:var(--accent);";
  const idAttr = id ? `id="${id}"` : "";
  return `
    <div class="card" style="padding:1rem;text-align:center;">
      <div ${idAttr} style="font-size:1.8rem;font-weight:800;${accent}">${display}</div>
      <div style="font-size:.78rem;color:var(--text-dim);margin-top:.3rem;">${escapeHtml(label)}</div>
    </div>`;
}
