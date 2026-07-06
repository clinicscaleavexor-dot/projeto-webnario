import { supabase, signOut } from "../assets/js/supabase-client.js";
import { requireAuth } from "../assets/js/auth-guard.js";
import { escapeHtml, toast } from "../assets/js/util.js";
import { initSidebar } from "../assets/js/admin-sidebar.js";

const $ = (id) => document.getElementById(id);

const MEGA_URL  = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-M6hpeUt7tF1/text";
const MEGA_TOKEN = "M6hpeUt7tF1";

let profile = null;
let allWebinars = [];
let monitorInterval = null;
let editingId = null; // ID da config sendo editada

// =====================================================================
//  INIT
// =====================================================================
(async function init() {
  profile = await requireAuth({ adminOnly: true });
  if (!profile) return;

  initSidebar(profile, "disparos");

  $("btn-new-dispatch").addEventListener("click", openNewForm);
  $("f-cancel").addEventListener("click", closeForm);
  $("f-save").addEventListener("click", saveDispatch);
  $("f-webinar").addEventListener("change", onWebinarChange);
  $("monitor-toggle").addEventListener("click", toggleMonitor);
  $("fire-now-btn").addEventListener("click", () => checkAndFire(true));
  $("reminders-now-btn").addEventListener("click", fireRemindersNow);
  $("log-close").addEventListener("click", closeLogModal);
  $("log-backdrop").addEventListener("click", closeLogModal);

  // Instâncias WhatsApp
  $("inst-add-btn").addEventListener("click", addInstance);

  // Pool de mensagens
  $("pool-add-btn").addEventListener("click", addPoolMessage);
  $("pool-save-btn").addEventListener("click", saveMessagePool);

  // Janela de tempo
  $("window-save-btn").addEventListener("click", saveWindow);
  $("dw-start").addEventListener("input", updateWindowExample);
  $("dw-end").addEventListener("input", updateWindowExample);

  await loadInstances();
  await loadDispatchGlobalSettings();
  await loadWebinars();
  await loadDispatches();
  startMonitor();
})();

// =====================================================================
//  WEBINÁRIOS
// =====================================================================
async function loadWebinars() {
  const { data } = await supabase
    .from("webinars")
    .select("id, title, slug")
    .order("updated_at", { ascending: false });
  allWebinars = data || [];

  const sel = $("f-webinar");
  sel.innerHTML = `<option value="">Selecione o webinário...</option>`;
  for (const w of allWebinars) {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = w.title;
    sel.appendChild(opt);
  }
}

async function onWebinarChange() {
  const wid = $("f-webinar").value;
  if (!wid) { $("schedule-fields").innerHTML = ""; return; }

  const { data: schedules } = await supabase
    .from("webinar_schedules")
    .select("id, start_at, label, recurrence_type, recurrence_group_id")
    .eq("webinar_id", wid)
    .eq("active", true)
    .order("start_at", { ascending: true });

  renderScheduleFields(schedules || [], null);
}

// =====================================================================
//  FORM
// =====================================================================
function openNewForm() {
  editingId = null;
  $("form-title").textContent = "Nova configuração";
  $("edit-id").value = "";
  $("f-name").value = "";
  $("f-webinar").value = "";
  $("schedule-fields").innerHTML = "";
  $("dispatch-form-wrap").classList.remove("hidden");
  $("dispatch-form-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeForm() {
  $("dispatch-form-wrap").classList.add("hidden");
  editingId = null;
}

function renderScheduleFields(schedules, existingConfig) {
  const host = $("schedule-fields");
  if (!schedules.length) {
    host.innerHTML = `<p class="muted">Este webinário não tem horários cadastrados. Adicione horários na aba Agenda do editor.</p>`;
    return;
  }

  // Para recorrência, agrupa por group_id e mostra apenas 1 representante por grupo
  const seen = new Set();
  const displayed = [];
  for (const s of schedules) {
    const key = s.recurrence_group_id || s.id;
    if (seen.has(key)) continue;
    seen.add(key);
    displayed.push(s);
  }

  host.innerHTML = "";
  for (const s of displayed) {
    const isRecurring = !!s.recurrence_group_id;
    const dateLabel = isRecurring
      ? `Recorrência — próxima: ${new Date(s.start_at).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
      : new Date(s.start_at).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

    const existing = existingConfig?.find((e) => e.schedule_id === s.id) || null;
    const groupId  = existing?.group_id || "";
    const msgs     = existing?.messages || [{ text: "", time: "" }];
    const msgCount = msgs.length; // 1, 2 ou 3

    const block = document.createElement("div");
    block.className = "schedule-block";
    block.dataset.scheduleId    = s.id;
    block.dataset.scheduleLabel = s.label || dateLabel;
    block.dataset.isRecurring   = isRecurring ? "1" : "0";
    block.dataset.recurrenceGroupId = s.recurrence_group_id || "";

    block.innerHTML = `
      <div class="sb-title">
        ${isRecurring ? `<span class="tag tag--recurrence">↺ Recorrência</span>` : ""}
        ${escapeHtml(dateLabel)}
      </div>
      <div class="field">
        <label>ID do Grupo WhatsApp</label>
        <input class="f-group-id" value="${escapeHtml(groupId)}"
          placeholder="ex: 5511999999999-1234567890@g.us" />
        <small class="muted">O ID termina em @g.us. Cole o ID do grupo (sem https://).</small>
      </div>
      <div>
        <label style="display:block;font-size:.82rem;color:var(--text-dim);margin-bottom:.4rem;">Número de disparos por dia</label>
        <div class="msg-count-picker">
          ${[1, 2, 3].map((n) => `
            <div>
              <input type="radio" name="msg-count-${s.id}" id="mc-${s.id}-${n}" value="${n}" ${msgCount === n ? "checked" : ""} />
              <label for="mc-${s.id}-${n}">${n}</label>
            </div>`).join("")}
        </div>
      </div>
      <div class="f-messages"></div>`;

    // Renderiza campos de mensagem conforme contagem
    const updateMsgFields = (count) => {
      const wrap = block.querySelector(".f-messages");
      wrap.innerHTML = "";
      for (let i = 0; i < count; i++) {
        const m = msgs[i] || { text: "", time: "" };
        const row = document.createElement("div");
        row.className = "msg-row";
        row.innerHTML = `
          <div class="field mb0">
            <label>Mensagem ${i + 1}</label>
            <textarea class="f-msg-text" rows="2" placeholder="Texto da mensagem...">${escapeHtml(m.text)}</textarea>
          </div>
          <div class="field mb0">
            <label>Horário</label>
            <input type="time" class="f-msg-time" value="${escapeHtml(m.time)}" />
          </div>`;
        wrap.appendChild(row);
      }
    };

    updateMsgFields(msgCount);

    // Listener no seletor 1/2/3
    block.querySelectorAll(`input[name="msg-count-${s.id}"]`).forEach((radio) => {
      radio.addEventListener("change", () => updateMsgFields(parseInt(radio.value, 10)));
    });

    host.appendChild(block);
  }
}

function collectFormConfig() {
  const config = [];
  document.querySelectorAll(".schedule-block").forEach((block) => {
    const scheduleId    = block.dataset.scheduleId;
    const scheduleLabel = block.dataset.scheduleLabel;
    const groupId       = block.querySelector(".f-group-id").value.trim();
    if (!groupId) return; // skip schedules sem grupo configurado

    const messages = [];
    block.querySelectorAll(".msg-row").forEach((row) => {
      const text = row.querySelector(".f-msg-text").value.trim();
      const time = row.querySelector(".f-msg-time").value.trim();
      if (text && time) messages.push({ text, time });
    });

    if (messages.length) {
      config.push({ schedule_id: scheduleId, schedule_label: scheduleLabel, group_id: groupId, messages });
    }
  });
  return config;
}

async function saveDispatch() {
  const name = $("f-name").value.trim() || "Configuração de disparo";
  const webinarId = $("f-webinar").value;
  if (!webinarId) return toast("Selecione um webinário.", "error");

  const config = collectFormConfig();
  if (!config.length) return toast("Configure ao menos um grupo com mensagens.", "error");

  const btn = $("f-save");
  btn.disabled = true; btn.textContent = "Salvando...";

  const { data: u } = await supabase.auth.getUser();
  let error;
  if (editingId) {
    ({ error } = await supabase.from("group_dispatches")
      .update({ name, webinar_id: webinarId, config })
      .eq("id", editingId));
  } else {
    ({ error } = await supabase.from("group_dispatches")
      .insert({ owner_id: u.user.id, webinar_id: webinarId, name, config }));
  }

  btn.disabled = false; btn.textContent = "Salvar configuração";
  if (error) return toast("Erro ao salvar: " + error.message, "error");

  toast(editingId ? "Configuração atualizada!" : "Configuração criada!", "success");
  closeForm();
  await loadDispatches();
}

// =====================================================================
//  LISTA DE CONFIGURAÇÕES
// =====================================================================
async function loadDispatches() {
  const host = $("dispatch-list");
  host.innerHTML = `<p class="muted">Carregando...</p>`;

  const { data, error } = await supabase
    .from("group_dispatches")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) { host.innerHTML = `<div class="empty">Erro: ${escapeHtml(error.message)}</div>`; return; }
  if (!data.length) {
    host.innerHTML = `<div class="empty">Nenhuma configuração ainda. Clique em <b>+ Nova configuração</b>.</div>`;
    return;
  }

  host.innerHTML = "";
  for (const d of data) {
    const webinar = allWebinars.find((w) => w.id === d.webinar_id);
    const schedCount = d.config.length;
    const maxMsgs = d.config.reduce((max, e) => Math.max(max, e.messages?.length || 0), 0);

    const card = document.createElement("div");
    card.className = `dispatch-card ${d.active ? "" : "inactive"}`;
    card.innerHTML = `
      <div class="dc-head">
        <div>
          <div class="dc-title">📢 ${escapeHtml(d.name)}</div>
          <div class="dc-sub">${webinar ? escapeHtml(webinar.title) : "Webinário removido"} · ${schedCount} horário${schedCount !== 1 ? "s" : ""} · até ${maxMsgs} disparo${maxMsgs !== 1 ? "s" : ""}/dia</div>
        </div>
        <div class="row wrap" style="gap:.4rem;margin-left:auto;">
          <button class="btn btn--sm ${d.active ? "btn--ghost" : ""}" data-act="toggle">
            ${d.active ? "● Ativo" : "○ Pausado"}
          </button>
          <button class="btn btn--sm" data-act="edit">Editar</button>
          <button class="btn btn--sm" data-act="log">Histórico</button>
          <button class="btn btn--sm btn--danger" data-act="del">Excluir</button>
        </div>
      </div>
      <div style="font-size:.82rem;color:var(--text-dim);margin-top:.25rem;">
        ${d.config.map((e) => `<span style="margin-right:.8rem;">⏰ ${escapeHtml(e.schedule_label || e.schedule_id.slice(0,8))} → grupo <code>${escapeHtml((e.group_id || "").slice(0,20))}…</code></span>`).join("")}
      </div>`;

    card.querySelector('[data-act="toggle"]').addEventListener("click", () => toggleActive(d.id, d.active));
    card.querySelector('[data-act="edit"]').addEventListener("click", () => editDispatch(d));
    card.querySelector('[data-act="log"]').addEventListener("click", () => openLogModal(d.id, d.name));
    card.querySelector('[data-act="del"]').addEventListener("click", () => deleteDispatch(d.id, d.name));
    host.appendChild(card);
  }
}

async function toggleActive(id, current) {
  const { error } = await supabase.from("group_dispatches").update({ active: !current }).eq("id", id);
  if (error) return toast("Erro: " + error.message, "error");
  toast(current ? "Configuração pausada." : "Configuração ativada!", "success");
  await loadDispatches();
}

async function editDispatch(d) {
  editingId = d.id;
  $("form-title").textContent = "Editar configuração";
  $("edit-id").value = d.id;
  $("f-name").value = d.name;
  $("f-webinar").value = d.webinar_id;
  $("dispatch-form-wrap").classList.remove("hidden");
  $("dispatch-form-wrap").scrollIntoView({ behavior: "smooth", block: "start" });

  // Carrega schedules e pré-preenche
  const { data: schedules } = await supabase
    .from("webinar_schedules")
    .select("id, start_at, label, recurrence_type, recurrence_group_id")
    .eq("webinar_id", d.webinar_id)
    .eq("active", true)
    .order("start_at", { ascending: true });

  renderScheduleFields(schedules || [], d.config);
}

async function deleteDispatch(id, name) {
  if (!confirm(`Excluir a configuração "${name}"?`)) return;
  const { error } = await supabase.from("group_dispatches").delete().eq("id", id);
  if (error) return toast("Erro: " + error.message, "error");
  toast("Configuração excluída.", "success");
  await loadDispatches();
}

// =====================================================================
//  HISTÓRICO DE LOGS
// =====================================================================
async function openLogModal(dispatchId, name) {
  $("log-modal").classList.remove("hidden");
  $("log-modal").style.display = "flex";
  $("log-content").innerHTML = `<p class="muted">Carregando...</p>`;

  const { data, error } = await supabase
    .from("group_dispatch_logs")
    .select("*")
    .eq("dispatch_id", dispatchId)
    .order("sent_at", { ascending: false })
    .limit(100);

  if (error || !data?.length) {
    $("log-content").innerHTML = `<div class="empty">Nenhum disparo registrado ainda.</div>`;
    return;
  }

  $("log-content").innerHTML = `
    <table class="log-table">
      <thead><tr>
        <th>Horário</th>
        <th>Grupo</th>
        <th>Msg #</th>
        <th>Status</th>
        <th>Erro</th>
      </tr></thead>
      <tbody>
        ${data.map((r) => `
          <tr>
            <td>${new Date(r.sent_at).toLocaleString("pt-BR")}</td>
            <td><code style="font-size:.8rem;">${escapeHtml((r.group_id || "").slice(0, 30))}</code></td>
            <td>${(r.message_index ?? 0) + 1}</td>
            <td class="status-${r.status}">${r.status === "sent" ? "✓ Enviado" : "✗ Erro"}</td>
            <td class="muted" style="font-size:.78rem;">${r.error_message ? escapeHtml(r.error_message.slice(0, 80)) : "—"}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function closeLogModal() {
  $("log-modal").classList.add("hidden");
  $("log-modal").style.display = "none";
}

// =====================================================================
//  INSTÂNCIAS WHATSAPP
// =====================================================================
let allProfiles = [];

async function loadInstances() {
  // Carrega perfis de usuários para o dropdown de dono
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, name")
    .order("name");
  allProfiles = profs || [];

  const sel = $("inst-owner");
  sel.innerHTML = '<option value="">Selecione o usuário...</option>';
  for (const p of allProfiles) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name || p.id.slice(0, 8);
    sel.appendChild(opt);
  }

  // Carrega instâncias existentes
  const { data, error } = await supabase
    .from("dispatch_numbers")
    .select("*")
    .order("sort_order", { ascending: true });

  const host = $("instances-list");
  if (error) { host.innerHTML = `<p class="muted">Erro: ${escapeHtml(error.message)}</p>`; return; }
  if (!data?.length) {
    host.innerHTML = `<p class="muted">Nenhuma instância cadastrada.</p>`;
    return;
  }

  host.innerHTML = "";
  for (const inst of data) {
    const owner = allProfiles.find(p => p.id === inst.owner_id);
    const card = document.createElement("div");
    card.className = "sub-item";
    card.style.cssText = "display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;";
    card.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div class="row" style="gap:.5rem;flex-wrap:wrap;margin-bottom:.25rem;">
          <strong style="font-size:.9rem;">${escapeHtml(inst.name)}</strong>
          <span class="tag" style="background:${inst.active ? "rgba(43,182,115,.15)" : "rgba(100,100,100,.15)"};color:${inst.active ? "#4ade80" : "var(--text-dim)"};">
            ${inst.active ? "● Ativa" : "○ Pausada"}
          </span>
        </div>
        <div style="font-size:.78rem;color:var(--text-dim);">
          👤 ${owner ? escapeHtml(owner.name || "—") : "Sem dono"} &nbsp;·&nbsp;
          <code style="font-size:.75rem;">${escapeHtml(inst.api_url)}</code>
        </div>
      </div>
      <div class="row" style="gap:.35rem;">
        <button class="btn btn--sm btn--ghost" data-act="toggle" data-id="${inst.id}" data-active="${inst.active}">
          ${inst.active ? "Pausar" : "Ativar"}
        </button>
        <button class="btn btn--sm btn--danger" data-act="del" data-id="${inst.id}" data-name="${escapeHtml(inst.name)}">×</button>
      </div>`;

    card.querySelector('[data-act="toggle"]').addEventListener("click", e => {
      const b = e.currentTarget;
      toggleInstance(b.dataset.id, b.dataset.active === "true");
    });
    card.querySelector('[data-act="del"]').addEventListener("click", e => {
      const b = e.currentTarget;
      deleteInstance(b.dataset.id, b.dataset.name);
    });
    host.appendChild(card);
  }
}

async function addInstance() {
  const name    = $("inst-name").value.trim();
  const ownerId = $("inst-owner").value;
  const url     = $("inst-url").value.trim().replace(/\/(text|mediaUrl)$/, "");
  const token   = $("inst-token").value.trim();

  if (!name)    return toast("Informe o nome da instância.", "error");
  if (!ownerId) return toast("Selecione o usuário dono.", "error");
  if (!url)     return toast("Informe a URL base da instância.", "error");
  if (!token)   return toast("Informe o token.", "error");

  const btn = $("inst-add-btn");
  btn.disabled = true; btn.textContent = "Salvando...";

  const { data: existing } = await supabase
    .from("dispatch_numbers")
    .select("sort_order")
    .eq("owner_id", ownerId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("dispatch_numbers").insert({
    name, api_url: url, api_token: token, active: true,
    sort_order: (existing?.sort_order ?? -1) + 1,
    owner_id: ownerId,
  });

  btn.disabled = false; btn.textContent = "Adicionar instância";
  if (error) return toast("Erro: " + error.message, "error");

  $("inst-name").value = ""; $("inst-url").value = ""; $("inst-token").value = "";
  $("inst-owner").value = "";
  toast("Instância adicionada!", "success");
  await loadInstances();
}

async function toggleInstance(id, current) {
  await supabase.from("dispatch_numbers").update({ active: !current }).eq("id", id);
  await loadInstances();
}

async function deleteInstance(id, name) {
  if (!confirm(`Remover a instância "${name}"?`)) return;
  await supabase.from("dispatch_numbers").delete().eq("id", id);
  toast("Instância removida.", "success");
  await loadInstances();
}

// =====================================================================
//  POOL DE MENSAGENS + JANELA DE TEMPO (configurações globais)
// =====================================================================
let globalSettings = {};

async function loadDispatchGlobalSettings() {
  const { data } = await supabase.from("dispatch_settings").select("key, value");
  for (const r of (data || [])) globalSettings[r.key] = r.value;

  // Renderizar pool
  let pool = [];
  try { pool = JSON.parse(globalSettings.message_pool || "[]"); } catch {}
  renderPoolList(pool);

  // Renderizar janela
  $("dw-start").value = globalSettings.lead_window_start_minutes || 30;
  $("dw-end").value   = globalSettings.lead_window_end_minutes   || 10;
  updateWindowExample();

}

async function upsertSetting(key, value) {
  await supabase.from("dispatch_settings").upsert({ key, value, updated_at: new Date().toISOString() });
}

// -- Pool --
function renderPoolList(pool) {
  const host = $("pool-list");
  if (!pool.length) {
    host.innerHTML = `<p class="muted" style="font-size:.85rem;">Nenhuma mensagem no pool. Clique em "+ Adicionar mensagem".</p>`;
    return;
  }
  host.innerHTML = "";
  pool.forEach((msg, i) => {
    const row = document.createElement("div");
    row.className = "sub-item";
    row.style.cssText = "position:relative;";
    row.innerHTML = `
      <div class="row spread" style="margin-bottom:.3rem;">
        <span style="font-size:.8rem;font-weight:600;color:var(--text-dim);">Mensagem ${i + 1}</span>
        <button class="btn btn--sm btn--danger pool-remove-btn" data-i="${i}">× Remover</button>
      </div>
      <textarea class="pool-msg-text" rows="3" style="width:100%;resize:vertical;">${escapeHtml(msg)}</textarea>`;
    host.appendChild(row);
  });
  host.querySelectorAll(".pool-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const currentPool = collectPool();
      currentPool.splice(parseInt(btn.dataset.i, 10), 1);
      renderPoolList(currentPool);
    });
  });
}

function collectPool() {
  return Array.from(document.querySelectorAll(".pool-msg-text")).map(t => t.value.trim()).filter(Boolean);
}

function addPoolMessage() {
  const current = collectPool();
  current.push("");
  renderPoolList(current);
  const textareas = document.querySelectorAll(".pool-msg-text");
  if (textareas.length) textareas[textareas.length - 1].focus();
}

async function saveMessagePool() {
  const pool = collectPool();
  await upsertSetting("message_pool", JSON.stringify(pool));
  globalSettings.message_pool = JSON.stringify(pool);
  toast(`Pool salvo com ${pool.length} mensagem${pool.length !== 1 ? "s" : ""}!`, "success");
}

// -- Janela de tempo --
function updateWindowExample() {
  const start = parseInt($("dw-start").value, 10) || 30;
  const end   = parseInt($("dw-end").value,   10) || 10;
  const dur   = Math.max(0, start - end);
  const exEl  = $("window-example");
  if (dur <= 0) {
    exEl.textContent = "⚠️ O início deve ser maior que o fim.";
    return;
  }
  exEl.textContent = `Exemplo: aula às 20:00 com 60 leads → envia de ${fmtOffset(start)} a ${fmtOffset(end)}, ≈${Math.round(60 / dur)} leads/minuto.`;
}

function fmtOffset(minutesBefore) {
  const d = new Date(new Date().setHours(20, 0, 0, 0) - minutesBefore * 60000);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

async function saveWindow() {
  const start = parseInt($("dw-start").value, 10) || 30;
  const end   = parseInt($("dw-end").value,   10) || 10;
  if (start <= end) return toast("O início deve ser maior que o fim.", "error");
  await Promise.all([
    upsertSetting("lead_window_start_minutes", String(start)),
    upsertSetting("lead_window_end_minutes",   String(end)),
  ]);
  globalSettings.lead_window_start_minutes = String(start);
  globalSettings.lead_window_end_minutes   = String(end);
  toast("Janela de envio salva!", "success");
  updateWindowExample();
}

// =====================================================================
//  LEMBRETES WHATSAPP (lead-reminders)
// =====================================================================
async function fireRemindersNow() {
  const btn    = $("reminders-now-btn");
  const status = $("reminders-status");
  const secret = (window.APP_CONFIG || {}).DISPATCH_SECRET || "";

  btn.disabled = true;
  btn.textContent = "Verificando…";
  status.textContent = "";

  try {
    const res = await fetch("/api/lead-reminders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dispatch-secret": secret,
      },
    });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = `Erro ${res.status}: ${data.error || "falha"}`;
      toast("Erro ao disparar lembretes: " + (data.error || res.status), "error");
      return;
    }
    const total = (data.pre_sent || 0) + (data.pos_sent || 0) + (data.scheduled_sent || 0);
    status.textContent = total > 0
      ? `✓ ${total} lembrete(s) enviado(s) — pré: ${data.pre_sent}, pós: ${data.pos_sent}`
      : `Sem lembretes pendentes agora (encontrou ${data.found || 0} leads)`;
    toast(total > 0 ? `${total} lembrete(s) enviado(s)!` : "Nenhum lembrete pendente agora.", "success");

    if (data.errors > 0) {
      toast(`${data.errors} erro(s) no envio. Veja o console.`, "error");
      console.warn("lead-reminders log:", data.log);
    }
  } catch (e) {
    status.textContent = "Erro de conexão.";
    toast("Erro de conexão com o servidor.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "💬 Lembretes agora";
  }
}

async function fireRemindersSilent() {
  const secret = (window.APP_CONFIG || {}).DISPATCH_SECRET || "";
  try {
    const res = await fetch("/api/lead-reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-dispatch-secret": secret },
    });
    const data = await res.json();
    if (!res.ok) { console.error("[monitor] lead-reminders:", data.error || res.status); return; }
    const total = (data.pre_sent || 0) + (data.pos_sent || 0) + (data.scheduled_sent || 0);
    if (total > 0) {
      $("reminders-status").textContent = `✓ ${total} lembrete(s) auto — pré: ${data.pre_sent || 0}, pós: ${data.pos_sent || 0}`;
      toast(`${total} lembrete(s) disparado(s) automaticamente!`, "success");
    }
    if (data.errors > 0) console.warn("[monitor] lead-reminders errors:", data.log);
  } catch (e) {
    console.warn("[monitor] lead-reminders:", e.message);
  }
}

// =====================================================================
//  MONITOR DE DISPAROS
// =====================================================================
function startMonitor() {
  if (monitorInterval) return;
  monitorInterval = setInterval(() => {
    checkAndFire(false);
    fireRemindersSilent();
  }, 60000);
  updateMonitorUI(true);
  checkAndFire(false);
  fireRemindersSilent(); // verifica imediatamente ao iniciar
}

function stopMonitor() {
  clearInterval(monitorInterval);
  monitorInterval = null;
  updateMonitorUI(false);
}

function toggleMonitor() {
  if (monitorInterval) stopMonitor();
  else startMonitor();
}

function updateMonitorUI(running) {
  const bar = $("monitor-bar");
  const lbl = $("monitor-label");
  const btn = $("monitor-toggle");
  if (running) {
    bar.classList.add("active");
    bar.classList.remove("error");
    lbl.textContent = "Monitorando — grupos + lembretes/webhooks a cada minuto";
    btn.textContent = "Pausar monitoramento";
  } else {
    bar.classList.remove("active", "error");
    lbl.textContent = "Monitor inativo — clique em Iniciar para ativar os disparos automáticos";
    btn.textContent = "Iniciar monitoramento";
  }
}

// =====================================================================
//  LÓGICA DE DISPARO
// =====================================================================
async function checkAndFire(verbose = false) {
  const now      = new Date();
  // Offset local para queries de data (compara com start_at usando timezone do browser)
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const nowTime    = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  if (verbose) toast(`Verificando disparos para ${nowTime}...`, "success");

  const { data: dispatches } = await supabase
    .from("group_dispatches")
    .select("*")
    .eq("active", true);

  if (!dispatches?.length) return;

  let fired = 0;
  for (const dispatch of dispatches) {
    for (const entry of (dispatch.config || [])) {
      if (!entry.group_id || !entry.messages?.length) continue;

      // Verifica se há um schedule do grupo com start_at hoje (qualquer hora)
      const { data: sched } = await supabase
        .from("webinar_schedules")
        .select("id")
        .eq("id", entry.schedule_id)
        .gte("start_at", todayLocal + "T00:00:00")
        .lte("start_at", todayLocal + "T23:59:59")
        .maybeSingle();

      if (!sched) {
        // Pode ser recorrência — checa a tabela inteira pelo recurrence_group
        // (já foi pré-gerado, então basta encontrar qualquer row do grupo com data hoje)
        // O `entry.schedule_id` já aponta para o "representante" do grupo.
        // Se não encontrou, não tem aula hoje neste horário.
        continue;
      }

      for (let i = 0; i < entry.messages.length; i++) {
        const msg = entry.messages[i];
        if (!msg.text || !msg.time) continue;
        if (msg.time !== nowTime) continue;

        // Já foi enviado hoje?
        const { data: existing } = await supabase
          .from("group_dispatch_logs")
          .select("id")
          .eq("dispatch_id", dispatch.id)
          .eq("schedule_id", entry.schedule_id)
          .eq("message_index", i)
          .gte("sent_at", todayLocal + "T00:00:00")
          .lte("sent_at", todayLocal + "T23:59:59")
          .maybeSingle();

        if (existing) continue; // já enviou hoje

        const groupId = entry.group_id.includes("@") ? entry.group_id : entry.group_id + "@g.us";
        let status = "sent"; let errorMsg = null;

        try {
          await sendGroupMessage(groupId, msg.text);
          fired++;
          updateMonitorUI(true);
        } catch (err) {
          status = "error"; errorMsg = err.message;
          const bar = $("monitor-bar");
          bar.classList.add("error");
          toast(`Erro no disparo para ${groupId}: ${err.message}`, "error");
        }

        await supabase.from("group_dispatch_logs").insert({
          dispatch_id: dispatch.id,
          schedule_id: entry.schedule_id,
          message_index: i,
          group_id: groupId,
          status,
          error_message: errorMsg,
        });
      }
    }
  }

  if (verbose) toast(fired ? `${fired} mensagem${fired !== 1 ? "s" : ""} disparada${fired !== 1 ? "s" : ""}!` : "Nenhum disparo pendente para agora.", fired ? "success" : "success");
}

async function sendGroupMessage(groupId, text) {
  const res = await fetch(MEGA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MEGA_TOKEN}`,
    },
    body: JSON.stringify({ messageData: { to: groupId, text } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
  }
}
