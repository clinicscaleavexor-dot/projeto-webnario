import { supabase } from "./assets/js/supabase-client.js";
import { fmtClock, escapeHtml, avatarFor } from "./assets/js/util.js";

const $ = (id) => document.getElementById(id);
const _params = new URLSearchParams(location.search);
const slug = _params.get("w");
const scheduleId = _params.get("s") || null;
const modeParam = _params.get("mode") || null;
const startParam = _params.get("start") || null;

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
let adminTimeShift = 0; // segundos de avanço para testes (somente admin)

// --- YouTube ---
let isYouTube = false;
let ytPlayer = null;
let ytReady = false;
let ytPendingSeek = null; // posição a buscar quando o player estiver pronto

init();

async function init() {
  if (!slug) return showError();

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
  trackEvent(webinarId, "watch_view");

  if (modeParam === "now") {
    scheduledMs = new Date(pkgResult.server_now).getTime();
  } else if (startParam) {
    scheduledMs = parseInt(startParam, 10);
  } else {
    scheduledMs = webinar.scheduled_start_at
      ? new Date(webinar.scheduled_start_at).getTime()
      : 0;
  }
  clockOffsetMs = new Date(pkgResult.server_now).getTime() - Date.now();

  $("loading").classList.add("hidden");
  $("app").classList.remove("hidden");
  document.title = webinar.title + " · Ao vivo";
  $("title").textContent = webinar.title;
  if (webinar.settings?.waiting_text) $("waiting-text").textContent = webinar.settings.waiting_text;
  if (webinar.settings?.ended_text) $("ended-text").textContent = webinar.settings.ended_text;

  // Detecta tipo de vídeo e inicializa o player correto
  const ytId = extractYouTubeId(webinar.video_url);
  if (ytId) {
    isYouTube = true;
    $("video").classList.add("hidden");
    $("yt-player").classList.remove("hidden");
    // Carrega a API do YouTube em background; o player será criado quando necessário
    loadYouTubeApi().then(() => createYouTubePlayer(ytId));
  } else {
    const video = $("video");
    if (webinar.video_url) video.src = webinar.video_url;
    video.muted = true;
  }

  // Unmute: funciona para MP4 e YouTube
  $("unmute").addEventListener("click", () => {
    if (isYouTube && ytPlayer) {
      ytPlayer.unMute();
    } else {
      $("video").muted = false;
    }
    $("unmute").classList.add("hidden");
  });

  renderBanners(0);
  if (isAdmin) { setupAdminChat(); setupAdminScrubber(); }
  else setupViewerChat();
  subscribeToLiveComments();

  tick();
  setInterval(tick, 1000);
  setInterval(resync, 60000);
  setInterval(() => {
    const secs = Math.floor(elapsedSeconds());
    if (secs > 0 && mode === "live") trackEvent(webinarId, "watch_heartbeat", { value: secs });
  }, 60000);
}

// ---------- YouTube helpers ----------

function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function loadYouTubeApi() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(); return; }
    window.onYouTubeIframeAPIReady = resolve;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
}

function createYouTubePlayer(videoId) {
  ytPlayer = new YT.Player("yt-player", {
    videoId,
    playerVars: {
      autoplay: 1,
      mute: 1,
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      playsinline: 1,
      fs: 0,
    },
    events: {
      onReady(e) {
        ytReady = true;
        e.target.mute();
        if (ytPendingSeek !== null) {
          e.target.seekTo(ytPendingSeek, true);
          e.target.playVideo();
          ytPendingSeek = null;
          $("unmute").classList.remove("hidden");
        }
      },
    },
  });
}

// ---------- Player unificado ----------

function startVideo(elapsed) {
  videoSynced = true;
  const seekTo = Math.max(0, elapsed);

  if (isYouTube) {
    if (ytReady && ytPlayer) {
      ytPlayer.seekTo(seekTo, true);
      ytPlayer.playVideo();
      $("unmute").classList.remove("hidden");
    } else {
      ytPendingSeek = seekTo; // onReady irá buscar quando o player estiver pronto
    }
    return;
  }

  // MP4 nativo
  const video = $("video");
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
  const target = Math.max(0, elapsed);

  if (isYouTube) {
    if (!ytReady || !ytPlayer || !videoSynced) return;
    const state = ytPlayer.getPlayerState();
    if (state !== 1 /* PLAYING */) return;
    const current = ytPlayer.getCurrentTime();
    if (Math.abs(current - target) > 2) ytPlayer.seekTo(target, true);
    return;
  }

  const video = $("video");
  if (!videoSynced || video.readyState < 1 || video.paused) return;
  if (Math.abs(video.currentTime - target) > 2) video.currentTime = target;
}

function pausePlayer() {
  if (isYouTube) {
    if (ytReady && ytPlayer) ytPlayer.pauseVideo();
  } else {
    try { $("video").pause(); } catch {}
  }
}

// ---------- Carregamento e Loop ----------

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
      .from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role === "admin") return true;
    // Dono do webinário também tem acesso admin na própria live
    const { data: owned } = await supabase
      .from("webinars").select("id").eq("slug", slug).eq("owner_id", user.id).limit(1);
    return (owned?.length ?? 0) > 0;
  } catch { return false; }
}

function showError() {
  $("loading").classList.add("hidden");
  $("error").classList.remove("hidden");
}

function serverNow() { return Date.now() + clockOffsetMs; }
function elapsedSeconds() {
  if (!scheduledMs) return 0;
  return (serverNow() - scheduledMs) / 1000 + adminTimeShift;
}

async function resync() {
  const { data: sn } = await supabase.rpc("server_now");
  if (sn) clockOffsetMs = new Date(sn).getTime() - Date.now();
}

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
  if (isAdmin) updateAdminScrubber(elapsed);
}

function setMode(next, elapsed) {
  if (mode !== next) {
    mode = next;
    $("overlay-waiting").classList.toggle("hidden", next !== "waiting");
    $("overlay-ended").classList.toggle("hidden", next !== "ended");
    if (next === "live" && !videoSynced) startVideo(elapsed);
    if (next === "ended") pausePlayer();
  }
  if (next === "waiting") updateCountdown(elapsed);
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
    if (c.show_at_seconds != null && c.show_at_seconds <= elapsed && !shownComments.has(c.id)) {
      shownComments.add(c.id);
      host.appendChild(buildMessage({ name: c.author_name, body: c.body, admin: c.type === "admin_reply" }));
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

// ---------- Chat ao vivo dos espectadores ----------
function setupViewerChat() {
  const STORAGE_KEY = "webnario_viewer_name";
  let viewerName = localStorage.getItem(STORAGE_KEY) || "";

  const nameWrap = $("viewer-name-wrap");
  const nameInp  = $("viewer-name-inp");
  const msgInp   = $("viewer-msg-inp");
  const sendBtn  = $("viewer-send");

  if (!viewerName) nameWrap.classList.remove("hidden");

  const send = async () => {
    if (!viewerName) {
      viewerName = nameInp.value.trim();
      if (!viewerName) { nameInp.focus(); return; }
      localStorage.setItem(STORAGE_KEY, viewerName);
      nameWrap.classList.add("hidden");
    }
    const body = msgInp.value.trim();
    if (!body) return;
    sendBtn.disabled = true;
    await supabase.from("live_comments").insert({
      webinar_id: webinarId,
      schedule_id: webinar.schedule_id || null,
      author_name: viewerName,
      body,
    });
    sendBtn.disabled = false;
    msgInp.value = "";
    msgInp.focus();
  };

  sendBtn.addEventListener("click", send);
  msgInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
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
    if (!error) { input.value = ""; input.focus(); }
  };

  btn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

// ---------- Admin scrubber de tempo ----------
function setupAdminScrubber() {
  const panel = $("admin-scrubber");
  panel.classList.remove("hidden");

  const range = $("as-range");
  if (duration > 0) range.max = duration;

  document.querySelectorAll(".as-jump").forEach((btn) => {
    btn.addEventListener("click", () => {
      adminSeek(Math.min(elapsedSeconds() + parseInt(btn.dataset.secs, 10), duration || 7200));
    });
  });

  range.addEventListener("change", () => adminSeek(parseInt(range.value, 10)));

  $("as-reset").addEventListener("click", () => {
    adminTimeShift = 0;
    shownComments.clear();
    shownCtaChat.clear();
    $("cta-bar").classList.add("hidden");
    delete $("cta-bar").dataset.cta;
    videoSynced = false;
    tick();
  });
}

function adminSeek(targetSeconds) {
  const prevElapsed = elapsedSeconds();
  const realElapsed = (serverNow() - scheduledMs) / 1000;
  adminTimeShift = targetSeconds - realElapsed;

  // Ao voltar no tempo, limpa o que já foi exibido para re-disparar
  if (targetSeconds < prevElapsed) {
    shownComments.clear();
    shownCtaChat.clear();
    $("cta-bar").classList.add("hidden");
    delete $("cta-bar").dataset.cta;
  }

  startVideo(Math.max(0, targetSeconds));
  tick();
}

function updateAdminScrubber(elapsed) {
  const range = $("as-range");
  if (!range || document.activeElement === range) return;
  const e = Math.max(0, elapsed);
  range.value = Math.floor(e);
  $("as-time").textContent = fmtClock(e) + " / " + fmtClock(duration || 3600);
}

function subscribeToLiveComments() {
  if (!webinarId) return;
  supabase
    .channel("live-comments-" + webinarId)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "live_comments",
      filter: `webinar_id=eq.${webinarId}`,
    }, (payload) => {
      const isAdminMsg = payload.new.author_name === "ADM";
      $("chat-messages").appendChild(
        buildMessage({ name: payload.new.author_name, body: payload.new.body, admin: isAdminMsg })
      );
      scrollChat();
    })
    .subscribe();
}

// ---------- CTA ----------
function revealCtas(elapsed) {
  const active = data.ctas.filter((c) => c.show_at_seconds != null && c.show_at_seconds <= elapsed);
  if (active.length) renderCtaBar(active[active.length - 1]);
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
  bar.querySelector(".btn").addEventListener("click", () => {
    trackEvent(webinarId, "cta_click", { metadata: { cta_id: c.id, cta_label: c.label } });
  });
}

// ---------- Banners ----------
function renderBanners(elapsed) {
  const slots = { top: $("banner-top"), side: $("banner-side"), below: $("banner-below") };
  const isMobile = window.matchMedia("(max-width: 900px)").matches;
  const buckets = { top: [], side: [], below: [] };

  for (const b of data.banners) {
    const visible = b.show_at_seconds != null && b.show_at_seconds <= elapsed && (b.hide_at_seconds == null || elapsed < b.hide_at_seconds);
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
    count = Math.round(v.base * Math.min(1, Math.max(0.15, warm / 60)));
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

// ---------- Rastreamento ----------
function trackEvent(webinarId, eventType, extra = {}) {
  supabase.from("webinar_events").insert({
    webinar_id: webinarId,
    event_type: eventType,
    value: extra.value ?? null,
    metadata: extra.metadata ?? null,
  }).then();
}
