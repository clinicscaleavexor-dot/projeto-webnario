import { supabase } from "./assets/js/supabase-client.js";
import { fmtClock, escapeHtml, avatarFor } from "./assets/js/util.js";

const $ = (id) => document.getElementById(id);
const _params = new URLSearchParams(location.search);
const slug = _params.get("w");
const scheduleId = _params.get("s") || null;
const modeParam = _params.get("mode") || null;      // "now"
const startParam = _params.get("start") || null;    // unix timestamp em ms

let data = null;
let webinar = null;
let duration = 0;
let scheduledMs = 0;
let clockOffsetMs = 0;
let mode = "loading";
const shownComments = new Set();
const shownCtaChat = new Set();
let videoSynced = false;
let isAdmin = false;
let webinarId = null;

init();

async function init() {
  if (!slug) return showError();

  // Detecta se o usuário é admin (em paralelo com o carregamento do webinário)
  const [pkgResult, adminResult] = await Promise.all([
    loadWebinar(),
    checkAdmin(),
  ]);

  if (!pkgResult) return showError();

  data = pkgResult;
  webinar = pkgResult.webinar;
  webinarId = webinar.id;
  duration = webinar.video_duration_seconds || 0;
  isAdmin = adminResult;

  // Determina o horário de início conforme o modo
  if (modeParam === "now") {
    // "Assistir Agora": início = agora (offset = 0, vídeo começa do começo)
    scheduledMs = new Date(pkgResult.server_now).getTime();
  } else if (startParam) {
    // Horário passado como timestamp Unix em ms (caso "30 minutos")
    scheduledMs = parseInt(startParam, 10);
  } else {
    scheduledMs = webinar.scheduled_start_at
      ? new Date(webinar.scheduled_start_at).getTime()
      : 0;
  }
  clockOffsetMs = new Date(pkgResult.server_now).getTime() - Date.now();

  // Monta UI base
  $("loading").classList.add("hidden");
  $("app").classList.remove("hidden");
  document.title = webinar.title + " · Ao vivo";
  $("title").textContent = webinar.title;
  if (webinar.settings?.waiting_text) $("waiting-text").textContent = webinar.settings.waiting_text;
  if (webinar.settings?.ended_text) $("ended-text").textContent = webinar.settings.ended_text;

  const video = $("video");
  if (webinar.video_url) video.src = webinar.video_url;
  video.muted = true;
  $("unmute").addEventListener("click", () => {
    video.muted = false;
    $("unmute").classList.add("hidden");
  });

  renderBanners(0);

  // Ativa chat real para admin
  if (isAdmin) setupAdminChat();

  // Inscreve em live_comments via Realtime (todos os espectadores)
  subscribeToLiveComments();

  tick();
  setInterval(tick, 1000);
  setInterval(resync, 60000);
}

async function loadWebinar() {
  const rpcArgs = { p_slug: slug };
  if (scheduleId) rpcArgs.p_schedule_id = scheduleId;
  const { data: pkg, error } = await supabase.rpc("get_public_webinar", rpcArgs);
  if (error || !pkg) return null;
  return pkg;
}

async function checkAdmin() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    return profile?.role === "admin";
  } catch {
    return false;
  }
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

  if (!scheduledMs || elapsed < 0) setMode("waiting", elapsed);
  else if (duration && elapsed >= duration) setMode("ended");
  else setMode("live", elapsed);

  if (mode === "live") {
    syncVideo(elapsed);
    revealComments(elapsed);
    revealCtas(elapsed);
  }
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
      if (video.muted) $("unmute").classList.remove("hidden");
    }).catch(() => {
      $("unmute").classList.remove("hidden");
      $("unmute").textContent = "▶ Toque para iniciar";
    });
  };
  if (video.readyState >= 1) doPlay();
  else video.addEventListener("loadedmetadata", doPlay, { once: true });
}

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

// ---------- Chat ao vivo do admin ----------
function setupAdminChat() {
  $("chat-input-fake").classList.add("hidden");
  $("chat-input-real").classList.remove("hidden");

  const input = $("chat-text");
  const btn = $("chat-send");

  const send = async () => {
    const body = input.value.trim();
    if (!body) return;
    btn.disabled = true;
    const { error } = await supabase.from("live_comments").insert({
      webinar_id: webinarId,
      schedule_id: webinar.schedule_id || null,
      author_name: "ADM",
      body,
    });
    btn.disabled = false;
    if (!error) {
      input.value = "";
      input.focus();
    }
  };

  btn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

// Realtime: todos os espectadores recebem comentários ao vivo do admin
function subscribeToLiveComments() {
  if (!webinarId) return;
  supabase
    .channel("live-comments-" + webinarId)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "live_comments",
        filter: `webinar_id=eq.${webinarId}`,
      },
      (payload) => {
        const host = $("chat-messages");
        host.appendChild(
          buildMessage({
            name: payload.new.author_name,
            body: payload.new.body,
            admin: true,
          })
        );
        scrollChat();
      }
    )
    .subscribe();
}

// ---------- CTA ----------
function revealCtas(elapsed) {
  const active = data.ctas.filter((c) => c.show_at_seconds <= elapsed);
  if (active.length) {
    const c = active[active.length - 1];
    renderCtaBar(c);
  }
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
  if (bar.dataset.cta === c.id) return;
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
    const warm = Math.max(0, 60 + elapsed);
    count = Math.round(v.base * Math.min(1, Math.max(0.15, (warm) / 60)));
  } else if (mode === "ended") {
    count = Math.round(v.base * 0.4);
  } else {
    const progress = duration ? Math.min(1, elapsed / duration) : 0.5;
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
