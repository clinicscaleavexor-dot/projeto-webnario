import { supabase } from "./assets/js/supabase-client.js";
import { escapeHtml } from "./assets/js/util.js";

const $ = (id) => document.getElementById(id);
const slug = new URLSearchParams(location.search).get("w");

init();

async function init() {
  if (!slug) return showError();

  const { data: pkg, error } = await supabase.rpc("get_public_webinar", { p_slug: slug });
  if (error || !pkg) return showError();

  $("loading").classList.add("hidden");
  $("app").classList.remove("hidden");

  document.title = pkg.webinar.title + " · Escolha seu horário";
  $("webinar-title").textContent = pkg.webinar.title;

  renderSlots(pkg.webinar, pkg.schedules, pkg.server_now);
}

function showError() {
  $("loading").classList.add("hidden");
  $("error").classList.remove("hidden");
}

function watchUrl(slug, scheduleId) {
  return new URL(`watch.html?w=${encodeURIComponent(slug)}&s=${encodeURIComponent(scheduleId)}`, location.href).href;
}

function renderSlots(webinar, schedules, serverNow) {
  const host = $("slots");
  const now = new Date(serverNow).getTime();

  // Filtra: horários futuros ou em andamento (até 30 min após o início)
  const visible = (schedules || []).filter((s) => {
    const startMs = new Date(s.start_at).getTime();
    const endMs = startMs + (webinar.video_duration_seconds || 3600) * 1000;
    return endMs > now;
  });

  if (!visible.length) {
    host.innerHTML = `<div class="empty">Não há sessões agendadas no momento.<br>Entre em contato para verificar os próximos horários.</div>`;
    return;
  }

  host.innerHTML = "";
  for (const s of visible) {
    const startMs = new Date(s.start_at).getTime();
    const isLive = startMs <= now && now < startMs + (webinar.video_duration_seconds || 3600) * 1000;
    const d = new Date(s.start_at);
    const dayName = d.toLocaleDateString("pt-BR", { weekday: "long" });
    const dateStr = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const timeStr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    const card = document.createElement("div");
    card.className = "slot-card";
    card.innerHTML = `
      ${isLive ? `<div class="slot-live"><span class="slot-live-dot"></span> AO VIVO AGORA</div>` : ""}
      <div class="slot-day">${escapeHtml(dayName)}</div>
      <div class="slot-date">${dateStr}</div>
      <div class="slot-time">${timeStr}</div>
      ${s.label ? `<div class="slot-label">${escapeHtml(s.label)}</div>` : ""}
    `;

    card.addEventListener("click", () => showConfirm(webinar, s, isLive, d));
    host.appendChild(card);
  }
}

function showConfirm(webinar, schedule, isLive, date) {
  const url = watchUrl(webinar.slug, schedule.id);
  const label = date.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  $("slots").classList.add("hidden");
  $("confirm-box").classList.remove("hidden");
  $("confirm-label").textContent = isLive
    ? `A transmissão já está ao vivo! Clique para entrar.`
    : `${label.charAt(0).toUpperCase() + label.slice(1)}`;
  $("confirm-watch").href = url;
  $("confirm-watch").textContent = isLive ? "Entrar na live agora" : "Acessar transmissão";

  $("copy-confirm").onclick = async () => {
    try { await navigator.clipboard.writeText(url); $("copy-confirm").textContent = "Copiado!"; }
    catch { alert(url); }
  };

  $("back-btn").onclick = () => {
    $("confirm-box").classList.add("hidden");
    $("slots").classList.remove("hidden");
  };
}
