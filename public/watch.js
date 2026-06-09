import { supabase } from "./assets/js/supabase-client.js";
import { fmtClock, escapeHtml, avatarFor } from "./assets/js/util.js";

const $ = (id) => document.getElementById(id);
const slug = new URLSearchParams(location.search).get("w");

let data = null;          // pacote retornado pela RPC
let webinar = null;
let duration = 0;
let scheduledMs = 0;
let clockOffsetMs = 0;    // server_now - client_now (no momento da carga)
let mode = "loading";     // waiting | live | ended
const shownComments = new Set();
const shownCtaChat = new Set();
let videoSynced = false;

init();

async function init() {
  if (!slug) return showError();
  const { data: pkg, error } = await supabase.rpc("get_public_webinar", { p_slug: slug });
  if (error || !pkg) return showError();

  data = pkg;
  webinar = pkg.webinar;
  duration = webinar.video_duration_seconds || 0;
  scheduledMs = webinar.scheduled_start_at ? new Date(webinar.scheduled_start_at).getTime() : 0;
  clockOffsetMs = new Date(pkg.server_now).getTime() - Date.now();

  // Monta UI base
  $("loading").classList.add("hidden");
  $("app").classList.remove("hidden");
  document.title = webinar.title + " · Ao vivo";
  $("title").textContent = webinar.title;
  if (webinar.settings?.waiting_text) $("waiting-text").textContent = webinar.settings.waiting_text;
  if (webinar.settings?.ended_text) $("ended-text").textContent = webinar.settings.ended_text;

  const video = $("video");
  if (webinar.video_url) video.src = webinar.video_url;
  video.muted = true; // necessário para autoplay
  $("unmute").addEventListener("click", () => {
    video.muted = false;
    $("unmute").classList.add("hidden");
  });

  renderBanners(0);

  // Loop principal
  tick();
  setInterval(tick, 1000);

  // Re-sincroniza o relógio com o servidor a cada 60s
  setInterval(resync, 60000);
}

function showError() {
  $("loading").classList.add("hidden");
  $("error").classList.remove("hidden");
}

function serverNow() { return Date.now() + clockOffsetMs; }
function elapsedSeconds() {
  if (!scheduledMs) return 0;
  return (serverNow() - scheduledMs) / 1000;
}

async function resync() {
  const { data: sn } = await supabase.rpc("server_now");
  if (sn) clockOffsetMs = new Date(sn).getTime() - Date.now();
}

// ---------- Loop ----------
function tick() {
  const elapsed = elapsedSeconds();

  // Determina o modo
  if (!scheduledMs || elapsed < 0) setMode("waiting", elapsed);
  else if (duration && elapsed >= duration) setMode("ended");
  else setMode("live", elapsed);

  if (mode === "live") {
    syncVideo(elapsed);
    revealComments(elapsed);
    revealCtas(elapsed);
  }
  // Banners e contador atualizam em qualquer modo (clampeando o tempo).
  renderBanners(mode === "live" ? elapsed : (mode === "ended" ? (duration || elapsed) : 0));
  updateViewers(elapsed);
}

function setMode(next, elapsed) {
  if (mode !== next) {
    mode = next;
    $("overlay-waiting").classList.toggle("hidden", next !== "waiting");
    $("overlay-ended").classList.toggle("hidden", next !== "ended");
    if (next === "live" && !videoSynced) startVideo(elapsed);
    if (next === "ended") { try { $("video").pause(); } catch {} }
  }
  if (next === "waiting") updateCountdown(elapsed);
}

// ---------- Vídeo ----------
function startVideo(elapsed) {
  const video = $("video");
  videoSynced = true;
  const seekTo = Math.max(0, elapsed);
  const doPlay = () => {
    try { video.currentTime = seekTo; } catch {}
    video.play().then(() => {
      // Se estiver mudo (autoplay), oferece ativar som
      if (video.muted) $("unmute").classList.remove("hidden");
    }).catch(() => {
      // Autoplay bloqueado mesmo mudo: mostra botão
      $("unmute").classList.remove("hidden");
      $("unmute").textContent = "▶ Toque para iniciar";
    });
  };
  if (video.readyState >= 1) doPlay();
  else video.addEventListener("loadedmetadata", doPlay, { once: true });
}

// Corrige deriva entre o tempo do vídeo e o tempo "real" da live.
function syncVideo(elapsed) {
  const video = $("video");
  if (!videoSynced || video.readyState < 1 || video.paused) return;
  const target = Math.max(0, elapsed);
  if (Math.abs(video.currentTime - target) > 2) {
    video.currentTime = target;
  }
}

// ---------- Contagem regressiva ----------
function updateCountdown(elapsed) {
  const remaining = Math.max(0, -elapsed);
  $("countdown").textContent = fmtClock(remaining);
  if (scheduledMs) {
    $("waiting-when").textContent =
      "Início: " + new Date(scheduledMs).toLocaleString("pt-BR");
  }
}

// ---------- Comentários / chat ----------
function revealComments(elapsed) {
  const host = $("chat-messages");
  for (const c of data.comments) {
    if (c.show_at_seconds <= elapsed && !shownComments.has(c.id)) {
      shownComments.add(c.id);
      host.appendChild(buildMessage({
        name: c.author_name,
        body: c.body,
        admin: c.type === "admin_reply",
      }));
      scrollChat();
    }
  }
}

function buildMessage({ name, body, admin, cta }) {
  const el = document.createElement("div");
  el.className = "chat-msg" + (admin ? " chat-msg--admin" : "") + (cta ? " chat-msg--cta" : "");
  const nameClass = admin ? "msg-name msg-name--admin" : "msg-name";
  const adminTag = admin ? `<span class="admin-tag">ADM</span>` : "";
  el.innerHTML = `
    <div class="msg-row">
      <img class="avatar" src="${avatarFor(name)}" alt="" />
      <div class="msg-body"><span class="${nameClass}">${escapeHtml(name)}</span>${adminTag}${linkify(body)}</div>
    </div>`;
  return el;
}

function linkify(text) {
  const esc = escapeHtml(text);
  return esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function scrollChat() {
  const host = $("chat-messages");
  host.scrollTop = host.scrollHeight;
}

// ---------- CTA ----------
function revealCtas(elapsed) {
  const active = data.ctas.filter((c) => c.show_at_seconds <= elapsed);
  if (active.length) {
    const c = active[active.length - 1]; // mostra o mais recente ativo
    renderCtaBar(c);
  }
  // Posta no chat (uma vez por CTA)
  for (const c of active) {
    if (c.post_in_chat && !shownCtaChat.has(c.id)) {
      shownCtaChat.add(c.id);
      const msg = c.chat_message || `${c.label}: ${c.url}`;
      $("chat-messages").appendChild(buildMessage({ name: "Equipe", body: msg, admin: true, cta: true }));
      scrollChat();
    }
  }
}

function renderCtaBar(c) {
  const bar = $("cta-bar");
  if (bar.dataset.cta === c.id) return; // já renderizado
  bar.dataset.cta = c.id;
  bar.classList.remove("hidden");
  bar.innerHTML = `
    <div class="cta-box">
      <span class="cta-text">Oferta liberada! Não perca.</span>
      <a class="btn btn--primary" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.label)}</a>
    </div>`;
}

// ---------- Banners ----------
function renderBanners(elapsed) {
  const slots = { top: $("banner-top"), side: $("banner-side"), below: $("banner-below") };
  const isMobile = window.matchMedia("(max-width: 900px)").matches;
  const buckets = { top: [], side: [], below: [] };

  for (const b of data.banners) {
    const visible = b.show_at_seconds <= elapsed && (b.hide_at_seconds == null || elapsed < b.hide_at_seconds);
    if (!visible || !b.image_url) continue;
    // No mobile, banner lateral cai para "abaixo".
    const pos = (isMobile && b.position === "side") ? "below" : b.position;
    buckets[pos].push(b);
  }

  for (const pos of ["top", "side", "below"]) {
    const html = buckets[pos].map((b) => {
      const img = `<img src="${escapeHtml(b.image_url)}" alt="" />`;
      return b.link_url ? `<a href="${escapeHtml(b.link_url)}" target="_blank" rel="noopener">${img}</a>` : img;
    }).join("");
    if (slots[pos].innerHTML !== html) slots[pos].innerHTML = html;
  }
}

// ---------- Espectadores ----------
function updateViewers(elapsed) {
  const v = webinar.settings?.viewers || { base: 100, peak: 600, jitter: 10 };
  let count;
  if (mode === "waiting") {
    // Antes de começar, vai enchendo lentamente até a base.
    const warm = Math.max(0, 60 + elapsed); // elapsed negativo
    count = Math.round(v.base * Math.min(1, Math.max(0.15, (warm) / 60)));
  } else if (mode === "ended") {
    count = Math.round(v.base * 0.4);
  } else {
    const progress = duration ? Math.min(1, elapsed / duration) : 0.5;
    // curva suave (ease-out) subindo da base ao pico
    const eased = 1 - Math.pow(1 - progress, 2);
    const baseCount = v.base + (v.peak - v.base) * eased;
    const jitter = Math.sin(elapsed / 7) * v.jitter + Math.sin(elapsed / 2.3) * (v.jitter / 2);
    count = Math.max(v.base, Math.round(baseCount + jitter));
  }
  const txt = count.toLocaleString("pt-BR");
  $("viewer-count").textContent = txt;
  const v2 = $("viewer-count-2");
  if (v2) v2.textContent = txt;
}
