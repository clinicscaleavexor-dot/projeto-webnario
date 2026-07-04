import { supabase } from "./assets/js/supabase-client.js";
import { escapeHtml } from "./assets/js/util.js";

const $ = (id) => document.getElementById(id);
const slug = new URLSearchParams(location.search).get("w");

const LEAD_FORM_DEFAULTS = {
  enabled: true,
  title: "Garanta sua vaga!",
  subtitle: "Preencha os dados abaixo para recebermos o link da aula no horário.",
  name_label: "Nome completo",
  phone_label: "Telefone (WhatsApp)",
  button_text: "Confirmar horário",
  extra_fields: [],
};

let webinarData = null;
let serverNowMs = 0;
let pendingSlot = null; // slot que aguarda preenchimento de lead

init();

async function init() {
  if (!slug) return showError();

  const { data: pkg, error } = await supabase.rpc("get_public_webinar", { p_slug: slug });
  if (error || !pkg) return showError();

  webinarData = pkg.webinar;
  const lfSaved = pkg.webinar.settings?.lead_form || {};
  webinarData.lead_form = {
    enabled: lfSaved.enabled !== false,
    title: lfSaved.title || LEAD_FORM_DEFAULTS.title,
    subtitle: lfSaved.subtitle || LEAD_FORM_DEFAULTS.subtitle,
    name_label: lfSaved.name_label || LEAD_FORM_DEFAULTS.name_label,
    phone_label: lfSaved.phone_label || LEAD_FORM_DEFAULTS.phone_label,
    button_text: lfSaved.button_text || LEAD_FORM_DEFAULTS.button_text,
    extra_fields: lfSaved.extra_fields || [],
  };
  serverNowMs = new Date(pkg.server_now).getTime();

  $("loading").classList.add("hidden");
  $("app").classList.remove("hidden");

  document.title = pkg.webinar.title + " · Escolha seu horário";
  $("webinar-title").textContent = pkg.webinar.title;

  renderSpecialSlots();
  renderDaySlots(pkg.webinar, pkg.schedules, pkg.server_now);
  setupLeadModal();
  setupConfirmBack();
  trackEvent(webinarData.id, "schedule_view");
}

function showError() {
  $("loading").classList.add("hidden");
  $("error").classList.remove("hidden");
}

function watchUrl(slug, params = {}) {
  const url = new URL("watch.html", location.href);
  url.searchParams.set("w", slug);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.href;
}

// ---------- Decide entre abrir o modal de lead ou ir direto pra aula ----------
function selectSlot(slot, subText) {
  pendingSlot = slot;
  if (webinarData.lead_form.enabled) {
    openLeadModal(subText);
  } else {
    proceedWithoutLead(slot);
  }
}

function proceedWithoutLead(slot) {
  const url = watchUrl(webinarData.slug, slot.watchParams);
  if (slot.redirect) {
    window.location.href = url;
    return;
  }
  showConfirm({
    heading: "Vaga confirmada! 🎉",
    label: `Você vai assistir ${slot.label}. Guarde este link.`,
    url,
  });
}

// ---------- Slots especiais: Assistir Agora e Em 30 Minutos ----------
function renderSpecialSlots() {
  const host = $("slots-special");

  // Card "Assistir Agora"
  const nowCard = document.createElement("div");
  nowCard.className = "slot-card slot-card--now";
  nowCard.innerHTML = `
    <div class="slot-now-icon">▶</div>
    <div class="slot-day">Disponível agora</div>
    <div class="slot-time slot-time--now">Assistir Agora</div>
    <div class="slot-label">Comece imediatamente</div>
  `;
  nowCard.addEventListener("click", () => {
    selectSlot({
      type: "now",
      scheduled_for_ms: serverNowMs,
      label: "agora",
      watchParams: { start: String(serverNowMs) },
      redirect: true,
    }, "Você vai assistir agora! Preencha seus dados para entrar na aula.");
  });
  host.appendChild(nowCard);

  // Card "Em 30 Minutos"
  const thirtyTs = serverNowMs + 30 * 60 * 1000;
  const thirtyDate = new Date(thirtyTs);
  const thirtyTime = thirtyDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const thirtyCard = document.createElement("div");
  thirtyCard.className = "slot-card slot-card--soon";
  thirtyCard.innerHTML = `
    <div class="slot-soon-badge">Em breve</div>
    <div class="slot-day">HOJE</div>
    <div class="slot-time">${thirtyTime}</div>
    <div class="slot-label">Em 30 minutos</div>
  `;
  thirtyCard.addEventListener("click", () => {
    selectSlot({
      type: "relative_30",
      scheduled_for_ms: thirtyTs,
      label: `às ${thirtyTime} (em 30 minutos)`,
      watchParams: { start: String(thirtyTs) },
    }, `Você quer assistir às ${thirtyTime} (em 30 minutos).`);
  });
  host.appendChild(thirtyCard);
}

// ---------- Slots regulares agrupados por dia ----------
function renderDaySlots(webinar, schedules, serverNow) {
  const host = $("slots-days");
  const now = new Date(serverNow).getTime();
  const todayStr = toDateStr(new Date(now));

  // Apenas horários que ainda não começaram
  const allFuture = (schedules || []).filter((s) => new Date(s.start_at).getTime() > now);

  // Se ainda há horários hoje → mostra só hoje; senão → só o próximo dia disponível
  const todaySlots = allFuture.filter((s) => toDateStr(new Date(s.start_at)) === todayStr);
  let visible;
  if (todaySlots.length > 0) {
    visible = todaySlots;
  } else {
    const nextDayStr = allFuture.length > 0 ? toDateStr(new Date(allFuture[0].start_at)) : null;
    visible = nextDayStr ? allFuture.filter((s) => toDateStr(new Date(s.start_at)) === nextDayStr) : [];
  }

  if (!visible.length) return;

  const firstDateStr = toDateStr(new Date(visible[0].start_at));
  const isToday = firstDateStr === todayStr;
  const d = new Date(visible[0].start_at);
  const dayLabel = isToday
    ? "Hoje — " + d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : "Amanhã — " + d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  const section = document.createElement("div");
  section.className = "slots-day-section";
  section.innerHTML = `<div class="slots-day-header">${dayLabel}</div>`;

  const grid = document.createElement("div");
  grid.className = "slots-grid";

  for (const s of visible) {
    const startMs = new Date(s.start_at).getTime();
    const timeStr = new Date(s.start_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const dayName = new Date(s.start_at).toLocaleDateString("pt-BR", { weekday: "long" });

    const card = document.createElement("div");
    card.className = "slot-card";
    card.innerHTML = `
      <div class="slot-day">${escapeHtml(dayName)}</div>
      <div class="slot-time">${timeStr}</div>
      ${s.label ? `<div class="slot-label">${escapeHtml(s.label)}</div>` : ""}
    `;

    card.addEventListener("click", () => {
      selectSlot({
        type: "scheduled",
        schedule_id: s.id,
        scheduled_for_ms: startMs,
        label: `às ${timeStr} de ${isToday ? "hoje" : "amanhã"}`,
        watchParams: { s: s.id },
      }, `Você quer assistir às ${timeStr} de ${isToday ? "hoje" : "amanhã"}.`);
    });

    grid.appendChild(card);
  }

  section.appendChild(grid);
  host.appendChild(section);
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

// ---------- Modal de lead ----------
function openLeadModal(subText) {
  trackEvent(webinarData.id, "modal_open");
  const lf = webinarData.lead_form;
  $("lead-title").textContent = lf.title;
  $("lead-sub").textContent = lf.subtitle;
  if (subText) $("lead-sub").textContent = subText + " Preencha seus dados para receber o link.";
  $("lead-name-label").textContent = lf.name_label;
  $("lead-phone-label").textContent = lf.phone_label;
  $("lead-submit").textContent = lf.button_text;
  $("lead-name").value = "";
  $("lead-phone").value = "";
  renderExtraFields(lf.extra_fields || []);
  $("lead-error").classList.add("hidden");
  $("lead-modal").classList.remove("hidden");
  setTimeout(() => $("lead-name").focus(), 80);
}

function renderExtraFields(fields) {
  const host = $("lead-extra-fields");
  const active = fields.filter(f => f.enabled && f.label);
  if (!active.length) { host.innerHTML = ""; return; }
  host.innerHTML = active.map((f, i) => `
    <div class="field">
      <label>${f.label}${f.required ? "" : " <span style='color:var(--text-dim);font-size:.8rem;font-weight:400;'>(opcional)</span>"}</label>
      <input id="lead-extra-${i}" type="text" placeholder="${f.placeholder || ""}" />
    </div>`).join("");
}

function collectExtraData() {
  const fields = (webinarData.lead_form.extra_fields || []).filter(f => f.enabled && f.label);
  const result = {};
  fields.forEach((f, i) => {
    const el = $(`lead-extra-${i}`);
    if (el) result[f.label] = el.value.trim();
  });
  return result;
}

function validateExtraFields() {
  const fields = (webinarData.lead_form.extra_fields || []).filter(f => f.enabled && f.label);
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].required) {
      const el = $(`lead-extra-${i}`);
      if (el && !el.value.trim()) return `Preencha o campo "${fields[i].label}".`;
    }
  }
  return null;
}

function closeLeadModal() {
  $("lead-modal").classList.add("hidden");
  pendingSlot = null;
}

function setupLeadModal() {
  $("lead-backdrop").addEventListener("click", closeLeadModal);
  $("lead-cancel").addEventListener("click", closeLeadModal);
  $("lead-submit").addEventListener("click", submitLead);
  $("lead-name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("lead-phone").focus(); });
  $("lead-phone").addEventListener("keydown", (e) => { if (e.key === "Enter") submitLead(); });
}

async function submitLead() {
  const name = $("lead-name").value.trim();
  const phone = $("lead-phone").value.trim();

  if (!name || !phone) {
    showLeadError("Preencha nome e telefone para continuar.");
    return;
  }

  const extraError = validateExtraFields();
  if (extraError) { showLeadError(extraError); return; }

  const btn = $("lead-submit");
  btn.disabled = true;
  btn.textContent = "Salvando...";

  const extraData = collectExtraData();
  const payload = {
    webinar_id: webinarData.id,
    name,
    phone,
    scheduled_for: new Date(pendingSlot.scheduled_for_ms).toISOString(),
    schedule_type: pendingSlot.type,
    schedule_id: pendingSlot.schedule_id || null,
    extra_data: Object.keys(extraData).length ? extraData : null,
  };

  const { error } = await supabase.from("schedule_leads").insert(payload);

  btn.disabled = false;
  btn.textContent = webinarData.lead_form.button_text;

  if (error) {
    showLeadError("Erro ao salvar. Tente novamente.");
    return;
  }

  const scheduledTime = new Date(pendingSlot.scheduled_for_ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const url = watchUrl(webinarData.slug, pendingSlot.watchParams);
  const shouldRedirect = pendingSlot.redirect;

  closeLeadModal();

  if (shouldRedirect) {
    window.location.href = url;
  } else {
    showConfirm({
      heading: "Vaga confirmada! 🎉",
      label: `Obrigado, ${name}! 5 minutos antes da sua aula às ${scheduledTime} iremos te mandar o link nesse mesmo número que você preencheu: ${phone}.`,
      url,
    });
  }
}

function showLeadError(msg) {
  const el = $("lead-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ---------- Confirmação final ----------
function showConfirm({ heading, label, url }) {
  $("slots").classList.add("hidden");
  $("confirm-box").classList.remove("hidden");
  $("confirm-heading").textContent = heading || "Horário confirmado!";
  $("confirm-label").textContent = label;

  $("copy-confirm").onclick = async () => {
    try { await navigator.clipboard.writeText(url); $("copy-confirm").textContent = "Copiado!"; }
    catch { alert(url); }
  };
}

function setupConfirmBack() {
  $("back-btn").addEventListener("click", () => {
    $("confirm-box").classList.add("hidden");
    $("slots").classList.remove("hidden");
  });
}

// ---------- Rastreamento ----------
function trackEvent(webinarId, eventType, extra = {}) {
  supabase.from("webinar_events").insert({
    webinar_id: webinarId,
    event_type: eventType,
    value: extra.value ?? null,
    metadata: extra.metadata ?? null,
  }).then();
}
