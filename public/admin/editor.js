import { supabase, CONFIG } from "../assets/js/supabase-client.js";
import { requireAuth } from "../assets/js/auth-guard.js";
import { initSidebar } from "../assets/js/admin-sidebar.js";
import {
  fmtClock, parseClock, escapeHtml, toast,
  localInputToISO, isoToLocalInput,
} from "../assets/js/util.js";
import { PACKS, buildComments } from "../assets/js/comment-packs.js";

const params = new URLSearchParams(location.search);
const WID = params.get("id");
let webinar = null;
let profile = null;

const $ = (id) => document.getElementById(id);

(async function init() {
  profile = await requireAuth();
  if (!profile) return;
  initSidebar(profile, "webinarios");
  if (!WID) { toast("Webinário não informado.", "error"); return; }

  setupTabs();
  await loadWebinar();

  $("save-btn").addEventListener("click", saveCore);
  $("publish-btn").addEventListener("click", togglePublish);
  $("copy-link").addEventListener("click", copyLink);
  document.querySelectorAll("[name='lf-mode']").forEach(r =>
    r.addEventListener("change", toggleLfMode)
  );
  $("video-file").addEventListener("change", onVideoFile);
  $("video-url").addEventListener("change", onVideoUrlChange);
  setupPackInserter();
  $("add-comment").addEventListener("click", () => addChild("comments"));
  $("add-cta").addEventListener("click", () => addChild("ctas"));
  $("add-banner").addEventListener("click", () => addChild("banners"));
  $("add-schedule").addEventListener("click", addSchedule);
  $("add-recurrence").addEventListener("click", openRecurrenceForm);
  $("rec-cancel").addEventListener("click", () => $("recurrence-form").classList.add("hidden"));
  $("rec-save").addEventListener("click", saveRecurrence);
  $("rec-type").addEventListener("change", () => {
    $("rec-interval-wrap").hidden = $("rec-type").value !== "every_n_days";
  });
  $("leads-refresh").addEventListener("click", () => loadLeads());
  $("leads-filter").addEventListener("change", () => loadLeads());
  $("leads-reminder-filter").addEventListener("change", () => loadLeads());
  $("leads-unify").addEventListener("change", () => loadLeads());
  $("leads-export").addEventListener("click", exportLeadsCsv);
  $("new-sched-msg-btn").addEventListener("click", openSchedForm);
  $("sched-cancel-btn").addEventListener("click", closeSchedForm);
  $("sched-save-btn").addEventListener("click", saveScheduledMessage);
  $("toggle-templates").addEventListener("click", toggleTemplatesPanel);
  $("use-tmpl-link").addEventListener("click", () => {
    $("sched-message").value = $("tmpl-link-text").value;
    $("sched-message").focus();
  });
  $("use-tmpl-followup").addEventListener("click", () => {
    $("sched-message").value = $("tmpl-followup-text").value;
    $("sched-message").focus();
  });
  $("sched-phone").addEventListener("input", filterPhoneDropdown);
  $("sched-phone").addEventListener("blur", () =>
    setTimeout(() => $("sched-phone-dropdown").classList.add("hidden"), 180)
  );
  $("leads-list").addEventListener("click", (e) => {
    const phoneEl = e.target.closest(".lead-phone-copy");
    if (phoneEl) {
      navigator.clipboard.writeText(phoneEl.dataset.phone).then(() => {
        const orig = phoneEl.textContent;
        phoneEl.textContent = "Copiado!";
        setTimeout(() => phoneEl.textContent = orig, 1500);
      });
      return;
    }
    const remindBtn = e.target.closest(".lead-remind-btn");
    if (remindBtn) {
      const lead = leadsCache.find((l) => l.id === remindBtn.dataset.id);
      if (lead) sendLeadReminder(lead, remindBtn);
      return;
    }
    const followBtn = e.target.closest(".lead-followup-btn");
    if (followBtn) {
      const lead = leadsCache.find((l) => l.id === followBtn.dataset.id);
      if (lead) sendLeadFollowup(lead, followBtn);
      return;
    }
    const audioBtn = e.target.closest(".lead-audio-btn");
    if (audioBtn) {
      const lead = leadsCache.find((l) => l.id === audioBtn.dataset.id);
      if (lead) sendLeadAudio(lead, audioBtn);
      return;
    }
    const delBtn = e.target.closest(".lead-delete-btn");
    if (delBtn) {
      const lead = leadsCache.find((l) => l.id === delBtn.dataset.id);
      if (lead) deleteLead(lead.id, delBtn);
    }
  });
})();

// ---------- Tabs ----------
function activateTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  const tab = document.querySelector(`[data-tab="${name}"]`);
  const panel = document.querySelector(`[data-panel="${name}"]`);
  if (tab) tab.classList.add("active");
  if (panel) panel.classList.add("active");
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activateTab(tab.dataset.tab);
      if (tab.dataset.tab === "leads")    openLeadsTab();
      if (tab.dataset.tab === "disparos") openDisparosTab();
    });
  });
  const tabParam = new URLSearchParams(location.search).get("tab");
  if (tabParam) {
    activateTab(tabParam);
    if (tabParam === "leads")    openLeadsTab();
    if (tabParam === "disparos") openDisparosTab();
  }
}

function openLeadsTab() {
  const isAdmin = profile?.role === "admin";
  $("dispatch-settings-card").classList.toggle("hidden", !isAdmin);
  $("sched-msg-card").classList.toggle("hidden", !isAdmin);

  if (!isAdmin) {
    loadLeads();
    return;
  }

  if (!settingsPanelReady) {
    settingsPanelReady = true;
    renderDispatchSettings();
    loadDispatchSettings();
  }
  loadLeads();
  loadScheduledMessages();
}

async function loadDispatchSettings() {
  try {
    const { data } = await supabase.from("dispatch_settings").select("key, value");
    for (const r of (data || [])) dispatchSettings[r.key] = r.value;
    updateSettingsPanel();
  } catch {}
}

async function saveDispatchSetting(key, value) {
  dispatchSettings[key] = value;
  try {
    await supabase.from("dispatch_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  } catch (e) {
    toast("Erro ao salvar configuração: " + e.message, "error");
  }
}

function audioBlock(settKey, fileId, clearId, statusId, label) {
  const url = dispatchSettings[settKey] || "";
  return `
    <div>
      <div class="section-label" style="margin-bottom:.4rem;">${label}</div>
      <div class="row" style="gap:.4rem;flex-wrap:wrap;align-items:center;">
        <label class="btn btn--sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:.3rem;">
          📂 Upload
          <input type="file" id="${fileId}" accept="audio/*,.ogg,.mp3,.wav,.m4a,.aac" style="display:none;">
        </label>
        <span id="${statusId}" style="font-size:.8rem;color:var(--text-dim);">${url ? "✓ Configurado" : "Sem arquivo"}</span>
      </div>
      ${url ? `
        <audio controls src="${escapeHtml(url)}" style="height:32px;width:100%;max-width:300px;margin-top:.35rem;display:block;"></audio>
        <button id="${clearId}" class="btn btn--sm" style="margin-top:.3rem;font-size:.75rem;">✕ Remover</button>
      ` : ""}
    </div>`;
}

function renderDispatchSettings() {
  const panel = $("leads-settings-panel");
  if (!panel) return;
  const mode   = dispatchSettings.dispatch_mode || "text_all";
  const paused = dispatchSettings.auto_pre_enabled === "false" && dispatchSettings.auto_pos_enabled === "false";

  panel.innerHTML = `
    <div class="disp-settings-panel" style="gap:.9rem 2rem;">
      <div>
        <div class="section-label">⚙️ Modo de envio automático</div>
        <div class="row" style="gap:.4rem;margin-bottom:.5rem;flex-wrap:wrap;">
          <button id="mode-text-all" class="btn btn--sm ${mode === "text_all" ? "btn--primary" : "btn--ghost"}" style="font-size:.82rem;">
            📝 Tudo em texto
          </button>
          <button id="mode-audio-pos" class="btn btn--sm ${mode === "text_pre_audio_pos" ? "btn--primary" : "btn--ghost"}" style="font-size:.82rem;">
            📝🎙️ Lembrete texto + follow-up áudio
          </button>
        </div>
        <button id="sett-pause-all" class="btn btn--sm ${paused ? "" : "btn--danger"}" style="font-size:.78rem;">
          ${paused ? "▶ Retomar Tudo" : "⏸ Pausar Tudo"}
        </button>
      </div>
      ${audioBlock("followup_audio_url", "sett-fup-file", "sett-clear-fup", "sett-fup-status", "🎙️ Áudio do follow-up pós-aula")}
    </div>`;

  $("mode-text-all").addEventListener("click", async () => {
    await saveDispatchSetting("dispatch_mode", "text_all");
    renderDispatchSettings();
    toast("Modo: tudo em texto.", "success");
  });
  $("mode-audio-pos").addEventListener("click", async () => {
    await saveDispatchSetting("dispatch_mode", "text_pre_audio_pos");
    renderDispatchSettings();
    toast("Modo: lembrete texto + follow-up áudio.", "success");
  });
  $("sett-pause-all").addEventListener("click", async () => {
    const nowPaused = dispatchSettings.auto_pre_enabled === "false" && dispatchSettings.auto_pos_enabled === "false";
    const val = nowPaused ? "true" : "false";
    await Promise.all([saveDispatchSetting("auto_pre_enabled", val), saveDispatchSetting("auto_pos_enabled", val)]);
    renderDispatchSettings();
    toast(nowPaused ? "Disparos retomados." : "Disparos pausados.", nowPaused ? "success" : "error");
  });

  bindAudioUpload("sett-fup-file", "sett-fup-status", "sett-clear-fup", "followup_audio_url");
}

function bindAudioUpload(fileId, statusId, clearId, settKey) {
  const fileEl  = $(fileId);
  const clearEl = $(clearId);
  if (fileEl) {
    fileEl.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = $(statusId);
      if (statusEl) statusEl.textContent = "Enviando...";
      try {
        const url = await uploadAudio(file, settKey);
        await saveDispatchSetting(settKey, url);
        toast("Áudio salvo!", "success");
        renderDispatchSettings();
      } catch (err) {
        toast("Erro no upload: " + err.message, "error");
        if ($(statusId)) $(statusId).textContent = "Erro";
      }
    });
  }
  if (clearEl) {
    clearEl.addEventListener("click", async () => {
      await saveDispatchSetting(settKey, "");
      renderDispatchSettings();
      toast("Áudio removido.", "success");
    });
  }
}

async function uploadAudio(file, settKey = "followup_audio_url") {
  const ext  = (file.name.split(".").pop() || "mp3").toLowerCase();
  const name = settKey === "reminder_audio_url" ? "reminder-audio" : "followup-audio";
  const path = `${name}.${ext}`;
  const { error } = await supabase.storage
    .from("webinar-audio")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("webinar-audio").getPublicUrl(path);
  return data.publicUrl;
}

function updateSettingsPanel() {
  // Após carregar settings do Supabase, re-renderiza o painel completo
  // para refletir o modo e URLs corretas (ocorre apenas na inicialização)
  renderDispatchSettings();
}

function updatePauseBtn() {
  const btn = $("sett-pause-all");
  if (!btn) return;
  const paused = dispatchSettings.auto_pre_enabled === "false" && dispatchSettings.auto_pos_enabled === "false";
  btn.textContent = paused ? "▶ Retomar Tudo" : "⏸ Pausar Tudo";
  btn.className   = `btn btn--sm ${paused ? "" : "btn--danger"}`;
}

// ---------- Carregar ----------
async function loadWebinar() {
  const { data, error } = await supabase.from("webinars").select("*").eq("id", WID).single();
  if (error) { toast("Erro ao carregar: " + error.message, "error"); return; }
  webinar = data;

  $("title").value = data.title || "";
  $("video-url").value = data.video_url || "";
  $("video-duration").value = data.video_duration_seconds ? fmtClock(data.video_duration_seconds) : "";
  $("timezone").value = data.timezone || "America/Sao_Paulo";

  const s = data.settings || {};
  const v = s.viewers || {};
  $("v-base").value = v.base || 120;
  $("v-peak").value = v.peak || 850;
  $("v-jitter").value = v.jitter || 12;
  $("waiting-text").value = s.waiting_text || "";
  $("ended-text").value = s.ended_text || "";

  const lf = s.lead_form || {};
  $("lf-enabled").checked = lf.enabled !== false;
  $("lf-title").value = lf.title || "";
  $("lf-subtitle").value = lf.subtitle || "";
  $("lf-name-label").value = lf.name_label || "";
  $("lf-phone-label").value = lf.phone_label || "";
  $("lf-button-text").value = lf.button_text || "";
  const lfMode = lf.mode || "standard";
  const lfModeEl = document.querySelector(`[name="lf-mode"][value="${lfMode}"]`);
  if (lfModeEl) lfModeEl.checked = true;
  $("lf-wa-number").value = lf.whatsapp_number || "";
  $("lf-wa-message").value = lf.whatsapp_message || "";
  $("lf-now-wa-message").value = lf.now_whatsapp_message || "";
  $("lf-reminder-note").value = lf.reminder_note || "";
  toggleLfMode();

  const eq = lf.extra_fields || [{}, {}];
  const eq1 = eq[0] || {}, eq2 = eq[1] || {};
  $("lf-eq1-enabled").checked   = !!eq1.enabled;
  $("lf-eq1-label").value       = eq1.label || "";
  $("lf-eq1-placeholder").value = eq1.placeholder || "";
  $("lf-eq1-required").checked  = !!eq1.required;
  $("lf-eq2-enabled").checked   = !!eq2.enabled;
  $("lf-eq2-label").value       = eq2.label || "";
  $("lf-eq2-placeholder").value = eq2.placeholder || "";
  $("lf-eq2-required").checked  = !!eq2.required;
  $("video-start-offset").value = s.video_start_offset ? fmtClock(s.video_start_offset) : "";
  if (data.video_url) {
    showVideoPreview(data.video_url);
    // Auto-detecta duração do YouTube se ainda não estiver salva
    if (!data.video_duration_seconds && extractYouTubeId(data.video_url)) {
      $("yt-dur-hint").classList.remove("hidden");
      detectYouTubeDuration(extractYouTubeId(data.video_url)).then((dur) => {
        if (dur && !$("video-duration").value) $("video-duration").value = fmtClock(dur);
      });
    }
  }
  updatePublishBtn();
  updateLinks();

  await Promise.all([renderSchedules(), renderComments(), renderCtas(), renderBanners()]);
  await populateLeadsFilter();
}

function publicUrl(slug, page = "watch.html") {
  const domain = profile?.custom_domain;
  if (domain) return `https://${domain}/${page}?w=${encodeURIComponent(slug)}`;
  return new URL(`${page}?w=${encodeURIComponent(slug)}`, new URL("../", location.href)).href;
}
function updateLinks() {
  $("preview-link").href = publicUrl(webinar.slug) + "&mode=now";
}
async function copyLink() {
  const url = publicUrl(webinar.slug) + "&mode=now";
  try { await navigator.clipboard.writeText(url); toast("Link copiado!", "success"); }
  catch { toast(url); }
}

// ---------- Salvar core ----------
async function saveCore() {
  const btn = $("save-btn");
  btn.disabled = true; btn.textContent = "Salvando...";

  const settings = {
    ...(webinar.settings || {}),
    viewers: {
      base: parseInt($("v-base").value, 10) || 120,
      peak: parseInt($("v-peak").value, 10) || 850,
      jitter: parseInt($("v-jitter").value, 10) || 12,
    },
    waiting_text: $("waiting-text").value.trim(),
    ended_text: $("ended-text").value.trim(),
    video_start_offset: parseClock($("video-start-offset").value) || 0,
    lead_form: {
      enabled: $("lf-enabled").checked,
      title: $("lf-title").value.trim(),
      subtitle: $("lf-subtitle").value.trim(),
      name_label: $("lf-name-label").value.trim(),
      phone_label: $("lf-phone-label").value.trim(),
      button_text: $("lf-button-text").value.trim(),
      mode: document.querySelector("[name='lf-mode']:checked")?.value || "standard",
      whatsapp_number: $("lf-wa-number").value.trim(),
      whatsapp_message: $("lf-wa-message").value.trim(),
      now_whatsapp_message: $("lf-now-wa-message").value.trim(),
      reminder_note: $("lf-reminder-note").value.trim(),
      extra_fields: [
        {
          enabled: $("lf-eq1-enabled").checked,
          label: $("lf-eq1-label").value.trim(),
          placeholder: $("lf-eq1-placeholder").value.trim(),
          required: $("lf-eq1-required").checked,
        },
        {
          enabled: $("lf-eq2-enabled").checked,
          label: $("lf-eq2-label").value.trim(),
          placeholder: $("lf-eq2-placeholder").value.trim(),
          required: $("lf-eq2-required").checked,
        },
      ],
    },
  };

  const patch = {
    title: $("title").value.trim() || "Webinário sem título",
    video_url: $("video-url").value.trim() || null,
    video_duration_seconds: parseClock($("video-duration").value) || null,
    timezone: $("timezone").value.trim() || "America/Sao_Paulo",
    settings,
  };

  const { data, error } = await supabase.from("webinars").update(patch).eq("id", WID).select("*").single();
  btn.disabled = false; btn.textContent = "Salvar";
  if (error) return toast("Erro ao salvar: " + error.message, "error");
  webinar = data;
  toast("Alterações salvas!", "success");
}

function toggleLfMode() {
  const mode = document.querySelector("[name='lf-mode']:checked")?.value || "standard";
  const wrap = $("lf-wa-wrap");
  if (wrap) wrap.classList.toggle("hidden", mode !== "whatsapp_reminder");
}

async function togglePublish() {
  const next = webinar.status === "published" ? "draft" : "published";
  if (next === "published") {
    if (!webinar.video_url) return toast("Defina o vídeo antes de publicar.", "error");
    const { count } = await supabase.from("webinar_schedules").select("*", { count: "exact", head: true }).eq("webinar_id", WID).eq("active", true);
    if (!count) return toast("Adicione ao menos um horário antes de publicar.", "error");
  }
  const { data, error } = await supabase.from("webinars").update({ status: next }).eq("id", WID).select("*").single();
  if (error) return toast("Erro: " + error.message, "error");
  webinar = data;
  updatePublishBtn();
  toast(next === "published" ? "Webinário publicado!" : "Despublicado.", "success");
}
function updatePublishBtn() {
  $("publish-btn").textContent = webinar.status === "published" ? "Despublicar" : "Publicar";
}

// ---------- Vídeo: upload e URL ----------

function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function showVideoPreview(url) {
  $("video-preview-wrap").classList.remove("hidden");
  const ytId = extractYouTubeId(url);
  if (ytId) {
    $("video-preview").classList.add("hidden");
    $("video-preview").src = "";
    const iframe = $("yt-preview");
    iframe.classList.remove("hidden");
    iframe.src = `https://www.youtube.com/embed/${ytId}?rel=0&modestbranding=1`;
  } else {
    $("yt-preview").classList.add("hidden");
    $("yt-preview").src = "";
    $("video-preview").classList.remove("hidden");
    $("video-preview").src = url;
  }
}

function detectDuration(srcFileOrUrl) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { resolve(isFinite(v.duration) ? Math.round(v.duration) : null); };
    v.onerror = () => resolve(null);
    v.src = typeof srcFileOrUrl === "string" ? srcFileOrUrl : URL.createObjectURL(srcFileOrUrl);
  });
}

function loadYouTubeApiEditor() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === "function") prev(); resolve(); };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
}

function detectYouTubeDuration(videoId) {
  return new Promise((resolve) => {
    const hint = $("yt-dur-hint");
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      if (!val) {
        hint.textContent = "Não foi possível detectar a duração. Insira manualmente no campo acima.";
        hint.style.color = "var(--error, #f87171)";
        hint.classList.remove("hidden");
      } else {
        hint.classList.add("hidden");
        hint.style.color = "";
        hint.textContent = "Duração detectando automaticamente via YouTube...";
      }
      resolve(val);
    };

    // Timeout de 15 segundos
    const timer = setTimeout(() => finish(null), 15000);

    loadYouTubeApiEditor().then(() => {
      const probe = document.createElement("div");
      probe.id = "yt-probe-" + Date.now();
      probe.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden;";
      document.body.appendChild(probe);
      new YT.Player(probe.id, {
        videoId,
        playerVars: { autoplay: 0 },
        events: {
          onReady(e) {
            clearTimeout(timer);
            const dur = e.target.getDuration();
            try { e.target.destroy(); probe.remove(); } catch {}
            finish(dur > 0 ? Math.round(dur) : null);
          },
          onError() {
            clearTimeout(timer);
            try { probe.remove(); } catch {}
            finish(null);
          },
        },
      });
    }).catch(() => { clearTimeout(timer); finish(null); });
  });
}

async function onVideoUrlChange() {
  const url = $("video-url").value.trim();
  if (!url) return;
  showVideoPreview(url);

  const ytId = extractYouTubeId(url);
  if (ytId) {
    if ($("video-duration").value) return; // já preenchido pelo usuário
    $("yt-dur-hint").classList.remove("hidden");
    const dur = await detectYouTubeDuration(ytId);
    if (dur) $("video-duration").value = fmtClock(dur);
  } else {
    const dur = await detectDuration(url);
    if (dur && !$("video-duration").value) $("video-duration").value = fmtClock(dur);
  }
}

async function onVideoFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Duração antes do upload (rápido, local)
  const dur = await detectDuration(file);
  if (dur) $("video-duration").value = fmtClock(dur);

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${WID}/${Date.now()}-${safe}`;

  const bar = $("upload-bar");
  $("upload-progress").classList.remove("hidden");
  $("upload-status").textContent = "Enviando vídeo...";
  bar.style.width = "0%";

  try {
    await uploadWithProgress(CONFIG.VIDEO_BUCKET, path, file, (p) => {
      bar.style.width = Math.round(p * 100) + "%";
    });
    const { data } = supabase.storage.from(CONFIG.VIDEO_BUCKET).getPublicUrl(path);
    $("video-url").value = data.publicUrl;
    showVideoPreview(data.publicUrl);
    $("upload-status").textContent = "Upload concluído. Lembre de clicar em Salvar.";
    toast("Vídeo enviado! Clique em Salvar.", "success");
  } catch (err) {
    $("upload-status").textContent = "Falha no upload: " + err.message;
    toast("Falha no upload do vídeo.", "error");
  }
}

// Upload via XHR para ter barra de progresso.
async function uploadWithProgress(bucket, path, file, onProgress) {
  const { data: { session } } = await supabase.auth.getSession();
  const url = `${CONFIG.SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURI(path)}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", CONFIG.SUPABASE_ANON_KEY);
    xhr.setRequestHeader("x-upsert", "true");
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(ev.loaded / ev.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(xhr.responseText || ("HTTP " + xhr.status)));
    xhr.onerror = () => reject(new Error("Erro de rede"));
    xhr.send(file);
  });
}

// =====================================================================
//  FILHOS: comentários, ctas, banners (persistência por linha)
// =====================================================================
async function addChild(table) {
  const defaults = {
    comments: { webinar_id: WID, type: "comment", author_name: "Convidado", body: "Que aula incrível!", show_at_seconds: 0 },
    ctas: { webinar_id: WID, label: "Quero participar", url: "https://", show_at_seconds: 0, post_in_chat: true, chat_message: "Garanta sua vaga: https://" },
    banners: { webinar_id: WID, image_url: "", link_url: "", position: "below", show_at_seconds: 0 },
  }[table];

  const { error } = await supabase.from(table).insert(defaults);
  if (error) return toast("Erro: " + error.message, "error");
  if (table === "comments") await renderComments();
  if (table === "ctas") await renderCtas();
  if (table === "banners") await renderBanners();
}

async function deleteChild(table, id, rerender) {
  if (!confirm("Excluir este item?")) return;
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return toast("Erro: " + error.message, "error");
  await rerender();
}

async function updateChild(table, id, patch) {
  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (error) return toast("Erro ao salvar: " + error.message, "error");
  toast("Salvo!", "success");
}

// ---------- Comentários ----------
async function renderComments() {
  const host = $("comments-list");
  const { data } = await supabase.from("comments").select("*").eq("webinar_id", WID)
    .order("show_at_seconds", { ascending: true });
  if (!data || !data.length) { host.innerHTML = `<div class="empty">Nenhum comentário programado.</div>`; return; }

  host.innerHTML = "";

  // Agrupa por batch_id (packs) vs comentários avulsos
  const batches = {};
  const manual = [];
  for (const c of data) {
    if (c.batch_id) {
      (batches[c.batch_id] = batches[c.batch_id] || []).push(c);
    } else {
      manual.push(c);
    }
  }

  // Renderiza cards de pack (um card por lote)
  for (const [batchId, items] of Object.entries(batches)) {
    const first = items[0];
    const last  = items[items.length - 1];
    const el = document.createElement("div");
    el.className = "sub-item batch-item";
    el.innerHTML = `
      <div class="row-head">
        <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;">
          <span class="tag">📦 Pack · ${items.length} comentários</span>
          <span class="muted" style="font-size:.8rem;">${fmtClock(first.show_at_seconds)} → ${fmtClock(last.show_at_seconds)}</span>
        </div>
        <button class="btn btn--sm btn--danger" data-act="del-batch">Excluir pack</button>
      </div>
      <small class="muted" style="display:block;margin-top:.35rem;font-size:.82rem;">
        Ex: <strong>${escapeHtml(first.author_name)}</strong> — "${escapeHtml(first.body)}"
      </small>`;
    el.querySelector('[data-act="del-batch"]').addEventListener("click", async () => {
      if (!confirm(`Excluir os ${items.length} comentários deste pack?`)) return;
      const { error } = await supabase.from("comments").delete()
        .eq("webinar_id", WID).eq("batch_id", batchId);
      if (error) return toast("Erro: " + error.message, "error");
      toast(`${items.length} comentários excluídos.`, "success");
      await renderComments();
    });
    host.appendChild(el);
  }

  // Renderiza comentários avulsos (adicionados manualmente)
  for (const c of manual) {
    const el = document.createElement("div");
    el.className = "sub-item";
    el.innerHTML = `
      <div class="row-head">
        <span class="tag ${c.type === "admin_reply" ? "tag--reply" : ""}">${c.type === "admin_reply" ? "Resposta ADM" : "Comentário"}</span>
        <button class="btn btn--sm btn--danger" data-act="del">Excluir</button>
      </div>
      <div class="field-row">
        <div class="field" style="max-width:200px;">
          <label>Tipo</label>
          <select data-f="type">
            <option value="comment" ${c.type === "comment" ? "selected" : ""}>Comentário fake</option>
            <option value="admin_reply" ${c.type === "admin_reply" ? "selected" : ""}>Resposta de ADM</option>
          </select>
        </div>
        <div class="field">
          <label>Nome de quem comenta</label>
          <input data-f="author_name" value="${escapeHtml(c.author_name)}" />
        </div>
        <div class="field" style="max-width:160px;">
          <label>Aparece em <small class="muted" style="font-weight:400;">(MM:SS ou H:MM:SS)</small></label>
          <input data-f="show_at_seconds" value="${fmtClock(c.show_at_seconds)}" placeholder="ex: 1:30:00" />
        </div>
      </div>
      <div class="field">
        <label>Mensagem</label>
        <textarea data-f="body">${escapeHtml(c.body)}</textarea>
      </div>
      <button class="btn btn--sm btn--primary" data-act="save">Salvar item</button>`;

    el.querySelector('[data-act="del"]').addEventListener("click", () => deleteChild("comments", c.id, renderComments));
    el.querySelector('[data-act="save"]').addEventListener("click", () => {
      updateChild("comments", c.id, {
        type: el.querySelector('[data-f="type"]').value,
        author_name: el.querySelector('[data-f="author_name"]').value.trim() || "Convidado",
        body: el.querySelector('[data-f="body"]').value.trim(),
        show_at_seconds: parseClock(el.querySelector('[data-f="show_at_seconds"]').value),
      });
    });
    host.appendChild(el);
  }
}

// ---------- Packs de comentários ----------
function setupPackInserter() {
  const grid = $("pack-selector");
  for (const p of PACKS) {
    const lbl = document.createElement("label");
    lbl.className = "pack-chip";
    lbl.innerHTML = `<input type="checkbox" value="${p.id}" /> ${p.icon} ${p.name}`;
    grid.appendChild(lbl);
  }

  // Auto-preenche "Até" com a duração total do vídeo (em minutos)
  if (webinar?.video_duration_seconds) {
    const totalMin = Math.floor(webinar.video_duration_seconds / 60);
    $("pack-end").value = totalMin;
    const hint = $("pack-end-hint");
    if (hint) hint.textContent = `(máx ${fmtClock(webinar.video_duration_seconds)})`;
  }

  $("pack-preview-btn").addEventListener("click", previewPacks);
  $("pack-apply-btn").addEventListener("click", applyPacks);
}

function getPackParams() {
  const selectedIds = [...document.querySelectorAll("#pack-selector input:checked")].map(i => i.value);
  const packs = PACKS.filter(p => selectedIds.includes(p.id));
  const count    = Math.max(1, parseInt($("pack-count").value) || 40);
  const startSec = Math.max(0, parseInt($("pack-start").value) || 0) * 60;
  const endSec   = Math.max(startSec + 60, (parseInt($("pack-end").value) || 55) * 60);
  const gender = $("pack-gender").value;
  return { packs, count, startSec, endSec, gender };
}

function previewPacks() {
  const params = getPackParams();
  if (!params.packs.length) return toast("Selecione ao menos um pack.", "error");
  const comments = buildComments(params);
  const preview = comments.slice(0, 12);
  $("pack-preview-title").textContent = `Prévia — mostrando ${preview.length} de ${comments.length} comentários`;
  $("pack-preview-sub").textContent = params.packs.map(p => p.icon + " " + p.name).join("  ·  ");
  $("pack-preview-list").innerHTML = preview.map(c => `
    <div class="pack-preview-row">
      <span class="pack-preview-time">${fmtClock(c.show_at_seconds)}</span>
      <span class="pack-preview-name">${escapeHtml(c.author_name)}</span>
      <span>${escapeHtml(c.body)}</span>
    </div>`).join("");
  $("pack-preview-box").classList.remove("hidden");
}

async function applyPacks() {
  const params = getPackParams();
  if (!params.packs.length) return toast("Selecione ao menos um pack.", "error");
  const batchId = crypto.randomUUID();
  const rows = buildComments(params).map(c => ({ ...c, webinar_id: WID, batch_id: batchId }));
  const btn = $("pack-apply-btn");
  btn.disabled = true;
  btn.textContent = "Inserindo...";
  const { error } = await supabase.from("comments").insert(rows);
  btn.disabled = false;
  btn.textContent = "✓ Aplicar pack";
  if (error) return toast("Erro: " + error.message, "error");
  toast(`${rows.length} comentários inseridos com sucesso!`, "success");
  $("pack-preview-box").classList.add("hidden");
  await renderComments();
}

// ---------- CTAs ----------
async function renderCtas() {
  const host = $("cta-list");
  const { data } = await supabase.from("ctas").select("*").eq("webinar_id", WID)
    .order("show_at_seconds", { ascending: true });
  if (!data || !data.length) { host.innerHTML = `<div class="empty">Nenhum CTA configurado.</div>`; return; }

  host.innerHTML = "";
  for (const c of data) {
    const el = document.createElement("div");
    el.className = "sub-item";
    el.innerHTML = `
      <div class="row-head">
        <span class="tag">CTA</span>
        <button class="btn btn--sm btn--danger" data-act="del">Excluir</button>
      </div>
      <div class="field-row">
        <div class="field"><label>Texto do botão</label><input data-f="label" value="${escapeHtml(c.label)}" /></div>
        <div class="field" style="max-width:140px;"><label>Aparece em (min:seg)</label><input data-f="show_at_seconds" value="${fmtClock(c.show_at_seconds)}" /></div>
      </div>
      <div class="field"><label>Link de destino</label><input data-f="url" value="${escapeHtml(c.url)}" /></div>
      <div class="checkbox" style="margin-bottom:.7rem;">
        <input type="checkbox" data-f="post_in_chat" id="pc-${c.id}" ${c.post_in_chat ? "checked" : ""} />
        <label for="pc-${c.id}">Também postar no chat da live</label>
      </div>
      <div class="field"><label>Mensagem no chat</label><input data-f="chat_message" value="${escapeHtml(c.chat_message || "")}" placeholder="Garanta sua vaga aqui 👉 ${escapeHtml(c.url)}" /></div>
      <button class="btn btn--sm btn--primary" data-act="save">Salvar item</button>`;

    el.querySelector('[data-act="del"]').addEventListener("click", () => deleteChild("ctas", c.id, renderCtas));
    el.querySelector('[data-act="save"]').addEventListener("click", () => {
      updateChild("ctas", c.id, {
        label: el.querySelector('[data-f="label"]').value.trim() || "Saiba mais",
        url: el.querySelector('[data-f="url"]').value.trim(),
        show_at_seconds: parseClock(el.querySelector('[data-f="show_at_seconds"]').value),
        post_in_chat: el.querySelector('[data-f="post_in_chat"]').checked,
        chat_message: el.querySelector('[data-f="chat_message"]').value.trim() || null,
      });
    });
    host.appendChild(el);
  }
}

// ---------- Banners ----------
async function renderBanners() {
  const host = $("banner-list");
  const { data } = await supabase.from("banners").select("*").eq("webinar_id", WID)
    .order("show_at_seconds", { ascending: true });
  if (!data || !data.length) { host.innerHTML = `<div class="empty">Nenhum banner configurado.</div>`; return; }

  host.innerHTML = "";
  for (const b of data) {
    const el = document.createElement("div");
    el.className = "sub-item";
    el.innerHTML = `
      <div class="row-head">
        <span class="tag">Banner</span>
        <button class="btn btn--sm btn--danger" data-act="del">Excluir</button>
      </div>
      <div class="field">
        <label>Imagem do banner</label>
        <input type="file" accept="image/*" data-f="file" />
        ${b.image_url ? `<img src="${escapeHtml(b.image_url)}" alt="" style="max-height:90px;margin-top:.5rem;border-radius:8px;" />` : ""}
      </div>
      <div class="field-row">
        <div class="field"><label>Link ao clicar</label><input data-f="link_url" value="${escapeHtml(b.link_url || "")}" placeholder="https://" /></div>
        <div class="field" style="max-width:160px;">
          <label>Posição</label>
          <select data-f="position">
            <option value="top" ${b.position === "top" ? "selected" : ""}>Topo</option>
            <option value="side" ${b.position === "side" ? "selected" : ""}>Lateral</option>
            <option value="below" ${b.position === "below" ? "selected" : ""}>Abaixo do vídeo</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field" style="max-width:160px;"><label>Aparece em (min:seg)</label><input data-f="show_at_seconds" value="${fmtClock(b.show_at_seconds)}" /></div>
        <div class="field" style="max-width:160px;"><label>Some em (opcional)</label><input data-f="hide_at_seconds" value="${b.hide_at_seconds != null ? fmtClock(b.hide_at_seconds) : ""}" placeholder="fim" /></div>
      </div>
      <div class="progress hidden" data-el="prog"><div class="progress__bar" data-el="bar"></div></div>
      <button class="btn btn--sm btn--primary" data-act="save">Salvar item</button>`;

    el.querySelector('[data-act="del"]').addEventListener("click", () => deleteChild("banners", b.id, renderBanners));
    el.querySelector('[data-act="save"]').addEventListener("click", async () => {
      let image_url = b.image_url;
      const fileInput = el.querySelector('[data-f="file"]');
      if (fileInput.files[0]) {
        const file = fileInput.files[0];
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${WID}/${Date.now()}-${safe}`;
        el.querySelector('[data-el="prog"]').classList.remove("hidden");
        try {
          await uploadWithProgress(CONFIG.BANNER_BUCKET, path, file, (p) => {
            el.querySelector('[data-el="bar"]').style.width = Math.round(p * 100) + "%";
          });
          image_url = supabase.storage.from(CONFIG.BANNER_BUCKET).getPublicUrl(path).data.publicUrl;
        } catch (err) { return toast("Falha no upload da imagem: " + err.message, "error"); }
      }
      const hideRaw = el.querySelector('[data-f="hide_at_seconds"]').value.trim();
      await updateChild("banners", b.id, {
        image_url,
        link_url: el.querySelector('[data-f="link_url"]').value.trim() || null,
        position: el.querySelector('[data-f="position"]').value,
        show_at_seconds: parseClock(el.querySelector('[data-f="show_at_seconds"]').value),
        hide_at_seconds: hideRaw ? parseClock(hideRaw) : null,
      });
      await renderBanners();
    });
    host.appendChild(el);
  }
}

// =====================================================================
//  HORÁRIOS (webinar_schedules)
// =====================================================================
function scheduleRelLabel(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const diff = Math.round((d - Date.now()) / 60000);
  if (diff > 0) return `começa em ${diff} min`;
  if (diff === 0) return "começa agora";
  const absMin = -diff;
  if (absMin < 60) return `em andamento há ${absMin} min`;
  return `passou há ${Math.round(absMin / 60)}h`;
}

async function renderSchedules() {
  const host = $("schedules-list");
  const { data } = await supabase
    .from("webinar_schedules")
    .select("*")
    .eq("webinar_id", WID)
    .order("start_at", { ascending: true });

  if (!data || !data.length) {
    host.innerHTML = `<div class="empty">Nenhum horário cadastrado. Clique em <b>+ Horário único</b> ou <b>↺ Recorrência</b>.</div>`;
    return;
  }

  host.innerHTML = "";
  const now = Date.now();

  // Separa linhas únicas das recorrentes (agrupadas por recurrence_group_id)
  const singles = data.filter((s) => !s.recurrence_group_id);
  const groups = {};
  for (const s of data) {
    if (!s.recurrence_group_id) continue;
    if (!groups[s.recurrence_group_id]) groups[s.recurrence_group_id] = [];
    groups[s.recurrence_group_id].push(s);
  }

  // ---- Grupos de recorrência ----
  for (const [gid, rows] of Object.entries(groups)) {
    const template = rows[0];
    const intervalDays = template.recurrence_type === "weekly" ? 7 : (template.recurrence_interval || 3);
    const typeLabel = template.recurrence_type === "weekly" ? "Semanal" : `A cada ${intervalDays} dias`;
    const futureRows = rows.filter((r) => new Date(r.start_at).getTime() > now);
    const nextRow = futureRows[0]; // já ordenado por start_at asc
    const nextLabel = nextRow
      ? new Date(nextRow.start_at).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "nenhuma futura";

    const el = document.createElement("div");
    el.className = "sub-item";
    el.innerHTML = `
      <div class="row-head">
        <span class="tag tag--recurrence">↺ ${escapeHtml(typeLabel)}</span>
        <span class="muted" style="font-size:.82rem;flex:1;margin-left:.7rem;">
          ${rows.length} ocorrência${rows.length !== 1 ? "s" : ""} · ${futureRows.length} futuras · próxima: <strong>${nextLabel}</strong>
        </span>
        <button class="btn btn--sm btn--danger" data-act="del-group">Excluir regra</button>
      </div>
      ${template.label ? `<div class="muted" style="font-size:.83rem;margin:.2rem 0 .5rem;">Rótulo: ${escapeHtml(template.label)}</div>` : ""}
      <div class="muted" style="font-size:.82rem;margin-bottom:.6rem;">
        Âncora: ${new Date(template.start_at).toLocaleString("pt-BR")} · intervalo: ${intervalDays} dias
      </div>
      <button class="btn btn--sm" data-act="regen">↺ Regenerar (próximas 8 semanas a partir de agora)</button>`;

    el.querySelector('[data-act="del-group"]').addEventListener("click", async () => {
      if (!confirm(`Excluir toda a regra de recorrência e suas ${rows.length} ocorrência(s)?`)) return;
      const { error } = await supabase.from("webinar_schedules").delete()
        .eq("webinar_id", WID).eq("recurrence_group_id", gid);
      if (error) return toast("Erro: " + error.message, "error");
      toast("Regra excluída.", "success");
      await renderSchedules();
    });

    el.querySelector('[data-act="regen"]').addEventListener("click", () => regenerateGroup(gid, template));

    host.appendChild(el);
  }

  // ---- Horários únicos ----
  for (const s of singles) {
    const rel = scheduleRelLabel(s.start_at);
    const el = document.createElement("div");
    el.className = "sub-item";
    el.innerHTML = `
      <div class="row-head">
        <span class="tag">${s.start_at ? new Date(s.start_at).toLocaleString("pt-BR") : "Sem horário"} <span style="color:var(--accent-hover); font-weight:400;">${rel}</span></span>
        <button class="btn btn--sm btn--danger" data-act="del">Excluir</button>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Data e hora de início</label>
          <input type="datetime-local" data-f="start_at" value="${isoToLocalInput(s.start_at)}" />
        </div>
        <div class="field">
          <label>Rótulo (opcional)</label>
          <input data-f="label" value="${escapeHtml(s.label || "")}" placeholder='ex: "Segunda 20h"' />
        </div>
      </div>
      <button class="btn btn--sm btn--primary" data-act="save">Salvar horário</button>`;

    el.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm("Excluir este horário?")) return;
      const { error } = await supabase.from("webinar_schedules").delete().eq("id", s.id);
      if (error) return toast("Erro: " + error.message, "error");
      await renderSchedules();
    });

    el.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const startIso = localInputToISO(el.querySelector('[data-f="start_at"]').value);
      if (!startIso) return toast("Informe a data e hora.", "error");
      const { error } = await supabase.from("webinar_schedules").update({
        start_at: startIso,
        label: el.querySelector('[data-f="label"]').value.trim() || null,
      }).eq("id", s.id);
      if (error) return toast("Erro ao salvar: " + error.message, "error");
      toast("Horário salvo!", "success");
      await renderSchedules();
    });

    host.appendChild(el);
  }
}

async function addSchedule() {
  const { error } = await supabase.from("webinar_schedules").insert({
    webinar_id: WID,
    start_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    recurrence_type: "once",
  });
  if (error) return toast("Erro: " + error.message, "error");
  await renderSchedules();
}

// =====================================================================
//  RECORRÊNCIA
// =====================================================================
function openRecurrenceForm() {
  const form = $("recurrence-form");
  form.classList.remove("hidden");
  // Pré-preenche com amanhã no mesmo horário
  const d = new Date(Date.now() + 86400000);
  d.setSeconds(0, 0);
  $("rec-anchor").value = isoToLocalInput(d.toISOString());
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function buildOccurrences(anchorIso, recType, intervalDays, weeksAhead, label) {
  const anchor = new Date(anchorIso).getTime();
  const intervalMs = intervalDays * 86400000;
  const limitMs = Date.now() + weeksAhead * 7 * 86400000;
  const groupId = crypto.randomUUID();
  const rows = [];

  // Começa da própria âncora se for no futuro; senão avança até a próxima ocorrência futura
  let t = anchor;
  const now = Date.now();
  if (t < now - 60000) {
    const missed = Math.ceil((now - t) / intervalMs);
    t += missed * intervalMs;
  }

  while (t <= limitMs) {
    rows.push({
      webinar_id: WID,
      start_at: new Date(t).toISOString(),
      label: label || null,
      active: true,
      recurrence_type: recType,
      recurrence_interval: recType === "every_n_days" ? intervalDays : null,
      recurrence_group_id: groupId,
    });
    t += intervalMs;
  }
  return rows;
}

async function saveRecurrence() {
  const anchorIso = localInputToISO($("rec-anchor").value);
  if (!anchorIso) return toast("Informe a data e hora da primeira ocorrência.", "error");

  const recType = $("rec-type").value;
  const intervalDays = recType === "weekly" ? 7 : (parseInt($("rec-interval").value, 10) || 3);
  const weeksAhead = parseInt($("rec-weeks").value, 10) || 8;
  const label = $("rec-label").value.trim() || null;

  const rows = buildOccurrences(anchorIso, recType, intervalDays, weeksAhead, label);
  if (!rows.length) return toast("Nenhuma ocorrência gerada no período informado.", "error");

  const btn = $("rec-save");
  btn.disabled = true; btn.textContent = "Criando...";

  const { error } = await supabase.from("webinar_schedules").insert(rows);
  btn.disabled = false; btn.textContent = "Criar recorrência";

  if (error) return toast("Erro: " + error.message, "error");

  $("recurrence-form").classList.add("hidden");
  toast(`${rows.length} ocorrência${rows.length !== 1 ? "s" : ""} criada${rows.length !== 1 ? "s" : ""}!`, "success");
  await renderSchedules();
}

async function regenerateGroup(groupId, template) {
  if (!confirm("Isso vai excluir todas as ocorrências futuras desta regra e gerar novas 8 semanas. Confirmar?")) return;

  const intervalDays = template.recurrence_type === "weekly" ? 7 : (template.recurrence_interval || 3);

  // Deleta ocorrências futuras do grupo
  const { error: delErr } = await supabase.from("webinar_schedules")
    .delete()
    .eq("webinar_id", WID)
    .eq("recurrence_group_id", groupId)
    .gt("start_at", new Date().toISOString());
  if (delErr) return toast("Erro ao remover antigas: " + delErr.message, "error");

  // Gera novas a partir de agora (mesma hora de âncora)
  const rows = buildOccurrences(template.start_at, template.recurrence_type, intervalDays, 8, template.label);
  // Atribui o mesmo group id
  rows.forEach((r) => { r.recurrence_group_id = groupId; });

  if (!rows.length) { toast("Nenhuma ocorrência gerada.", "error"); return; }

  const { error } = await supabase.from("webinar_schedules").insert(rows);
  if (error) return toast("Erro: " + error.message, "error");

  toast(`${rows.length} ocorrência${rows.length !== 1 ? "s" : ""} gerada${rows.length !== 1 ? "s" : ""}!`, "success");
  await renderSchedules();
}

// =====================================================================
//  LEADS
// =====================================================================
let allSchedules = [];
let leadsCache = [];
let remMap = {}; // mapa global: lead_id → { pre: bool, pos: bool }
let dispatchSettings = {};
let settingsPanelReady = false;

async function populateLeadsFilter() {
  const { data } = await supabase
    .from("webinar_schedules")
    .select("id, start_at, label")
    .eq("webinar_id", WID)
    .order("start_at", { ascending: true });

  allSchedules = data || [];
  const sel = $("leads-filter");
  sel.innerHTML = `
    <option value="all">Todos os horários</option>
    <option value="now">Assistiu Agora</option>
    <option value="relative_30">Daqui 30 minutos</option>
  `;

  // Agrupa schedules por hora do dia no Brasil (UTC-3), ex: "15:00", "20:00"
  const timeGroups = {};
  for (const s of allSchedules) {
    const brtDate = new Date(new Date(s.start_at).getTime() - 3 * 60 * 60 * 1000);
    const hhmm = brtDate.toISOString().slice(11, 16); // "15:00"
    if (!timeGroups[hhmm]) timeGroups[hhmm] = [];
    timeGroups[hhmm].push(s.id);
  }
  for (const hhmm of Object.keys(timeGroups).sort()) {
    const opt = document.createElement("option");
    opt.value = `time:${hhmm}:${timeGroups[hhmm].join(",")}`;
    opt.textContent = `${hhmm.replace(":", "h")} horas`;
    sel.appendChild(opt);
  }
}

// Retorna HTML da célula de disparo automático para um lead.
// offsetMs: negativo = antes da aula (pre), positivo = depois (pos).
// windowMs: duração da janela de envio.
function dispatchCell(hasSent, scheduledForISO, offsetMs, windowMs) {
  if (hasSent) {
    return '<span style="color:var(--green);font-weight:600;" title="Enviado automaticamente">✅ Enviado</span>';
  }
  const fireAt   = new Date(scheduledForISO).getTime() + offsetMs;
  const windowEnd = fireAt + windowMs;
  const nowMs    = Date.now();

  if (nowMs > windowEnd) {
    // Janela já passou sem envio (lead cadastrado depois, ou cron falhou)
    return '<span class="muted" title="Janela de envio passou sem registro">—</span>';
  }

  const timeStr  = new Date(fireAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const diffMin  = Math.round((fireAt - nowMs) / 60000);

  if (diffMin <= 0) {
    return `<span style="color:#f59e0b;font-weight:600;" title="Dentro da janela de envio agora — cron vai disparar">🕐 agora</span>`;
  }
  if (diffMin < 60) {
    return `<span style="color:#f59e0b;font-weight:600;" title="Envio automático em ${diffMin}min (${timeStr})">🕐 ${diffMin}min</span>`;
  }
  return `<span class="muted" title="Envio automático às ${timeStr}">${timeStr}</span>`;
}

async function loadLeads() {
  const host = $("leads-list");
  host.innerHTML = `<div class="empty">Carregando...</div>`;

  const filter = $("leads-filter").value;
  let query = supabase
    .from("schedule_leads")
    .select("*")
    .eq("webinar_id", WID)
    .order("scheduled_for", { ascending: true });

  if (filter === "now") query = query.eq("schedule_type", "now");
  else if (filter === "relative_30") query = query.eq("schedule_type", "relative_30");
  else if (filter.startsWith("time:")) {
    const ids = filter.split(":")[2].split(",");
    query = query.in("schedule_id", ids);
  } else if (filter !== "all") query = query.eq("schedule_id", filter);

  const { data, error } = await query;
  if (error) { host.innerHTML = `<div class="empty">Erro: ${escapeHtml(error.message)}</div>`; return; }
  if (!data || !data.length) { host.innerHTML = `<div class="empty">Nenhum lead capturado ainda.</div>`; return; }

  leadsCache = data;

  // Quais leads já receberam lembrete automático (pré ou pós)
  const { data: reminderLog } = await supabase
    .from("lead_reminder_log")
    .select("lead_id, type")
    .in("lead_id", data.map(l => l.id));
  remMap = {};
  for (const r of (reminderLog || [])) {
    if (!remMap[r.lead_id]) remMap[r.lead_id] = {};
    remMap[r.lead_id][r.type] = true;
  }

  const preTotal = Object.values(remMap).filter(m => m.pre).length;
  const posTotal = Object.values(remMap).filter(m => m.pos).length;

  // Aplica filtro de lembrete client-side
  const reminderFilter = $("leads-reminder-filter").value;
  let displayData = data;
  if (reminderFilter === "pre_sent")    displayData = data.filter(l => remMap[l.id]?.pre);
  else if (reminderFilter === "pre_pending")  displayData = data.filter(l => !remMap[l.id]?.pre);
  else if (reminderFilter === "pos_sent")    displayData = data.filter(l => remMap[l.id]?.pos);
  else if (reminderFilter === "pos_pending") displayData = data.filter(l => !remMap[l.id]?.pos);

  // Unificar contatos: agrupa por telefone, mantém o lead mais recente de cada número
  if ($("leads-unify").checked) {
    const phoneMap = new Map();
    for (const lead of displayData) {
      const phone = lead.phone.replace(/\D/g, "");
      if (!phoneMap.has(phone)) {
        phoneMap.set(phone, { ...lead, _count: 1 });
      } else {
        const existing = phoneMap.get(phone);
        existing._count++;
        // mantém o de scheduled_for mais recente
        if (new Date(lead.scheduled_for) > new Date(existing.scheduled_for)) {
          phoneMap.set(phone, { ...lead, _count: existing._count });
        }
        // merge do remMap: se qualquer lead do mesmo telefone recebeu, marca como enviado
        if (remMap[lead.id]?.pre) { if (!remMap[existing.id]) remMap[existing.id] = {}; remMap[existing.id].pre = true; }
        if (remMap[lead.id]?.pos) { if (!remMap[existing.id]) remMap[existing.id] = {}; remMap[existing.id].pos = true; }
      }
    }
    displayData = [...phoneMap.values()];
  }

  const showing = displayData.length !== data.length ? ` (mostrando ${displayData.length})` : "";

  // Calcula próximos disparos automáticos para o banner de resumo
  const nowMs = Date.now();
  const PRE_OFFSET  = -20 * 60 * 1000; // 20 min antes
  const PRE_WINDOW  =   5 * 60 * 1000; // janela de 5 min
  const POS_OFFSET  =  75 * 60 * 1000; // 75 min depois
  const POS_WINDOW  =   5 * 60 * 1000;

  const pendingPre = displayData.filter(l => {
    if (remMap[l.id]?.pre) return false;
    const fireAt = new Date(l.scheduled_for).getTime() + PRE_OFFSET;
    return nowMs <= fireAt + PRE_WINDOW;
  });
  const pendingPos = displayData.filter(l => {
    if (remMap[l.id]?.pos) return false;
    const fireAt = new Date(l.scheduled_for).getTime() + POS_OFFSET;
    return nowMs <= fireAt + POS_WINDOW;
  });

  function nextFireStr(leads, offset) {
    const sorted = leads
      .map(l => new Date(l.scheduled_for).getTime() + offset)
      .filter(t => t > nowMs)
      .sort((a, b) => a - b);
    if (!sorted.length) return null;
    const next = sorted[0];
    const diffMin = Math.round((next - nowMs) / 60000);
    const timeStr = new Date(next).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (diffMin <= 0) return "agora";
    if (diffMin < 60) return `em ${diffMin}min (${timeStr})`;
    return `às ${timeStr}`;
  }

  const nextPreStr  = nextFireStr(pendingPre, PRE_OFFSET);
  const nextPosStr  = nextFireStr(pendingPos, POS_OFFSET);

  const bannerParts = [];
  if (pendingPre.length) bannerParts.push(`💬 ${pendingPre.length} lembrete${pendingPre.length !== 1 ? "s" : ""} pendente${pendingPre.length !== 1 ? "s" : ""}${nextPreStr ? " · Próximo: " + nextPreStr : ""}`);
  if (pendingPos.length) bannerParts.push(`✅ ${pendingPos.length} follow-up${pendingPos.length !== 1 ? "s" : ""} pendente${pendingPos.length !== 1 ? "s" : ""}${nextPosStr ? " · Próximo: " + nextPosStr : ""}`);

  host.innerHTML = `
    <div class="leads-summary muted" style="font-size:.85rem;margin-bottom:.6rem;">
      ${data.length} lead${data.length !== 1 ? "s" : ""}${showing}
      &nbsp;·&nbsp; 💬 ${preTotal} enviado${preTotal !== 1 ? "s" : ""}
      &nbsp;·&nbsp; ✅ ${posTotal} follow-up${posTotal !== 1 ? "s" : ""} enviado${posTotal !== 1 ? "s" : ""}
    </div>
    ${bannerParts.length ? `<div class="leads-dispatch-banner">${bannerParts.join("&emsp;|&emsp;")}</div>` : ""}
    <div class="leads-table-wrap">
      <table class="leads-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Telefone</th>
            <th>Horário agendado</th>
            <th>Tipo</th>
            <th style="text-align:center;" title="Lembrete pré-aula: enviado ou horário previsto do próximo envio">💬 Próx. Lembrete</th>
            <th style="text-align:center;" title="Follow-up pós-aula: enviado ou horário previsto do próximo envio">✅ Próx. Follow-up</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody id="leads-tbody"></tbody>
      </table>
    </div>`;

  const tbody = $("leads-tbody");
  for (const lead of displayData) {
    const typeLabel = { now: "Agora", relative_30: "30 min", scheduled: "Agendado" }[lead.schedule_type] || lead.schedule_type;
    const hasPre = remMap[lead.id]?.pre;
    const hasPos = remMap[lead.id]?.pos;
    const tr = document.createElement("tr");
    const countBadge = lead._count > 1
      ? `<span class="tag" style="background:rgba(245,158,11,.2);color:#f59e0b;margin-left:.4rem;" title="${lead._count} agendamentos do mesmo número">${lead._count}x</span>`
      : "";
    tr.innerHTML = `
      <td>
        ${escapeHtml(lead.name)}${countBadge}
        ${lead.extra_data && Object.keys(lead.extra_data).length ? `
          <div style="margin-top:.25rem;">
            ${Object.entries(lead.extra_data).map(([k, v]) =>
              `<div style="font-size:.74rem;color:var(--text-dim);"><span style="font-weight:600;">${escapeHtml(k)}:</span> ${escapeHtml(v || "—")}</div>`
            ).join("")}
          </div>` : ""}
      </td>
      <td><span class="lead-phone-copy" data-phone="${escapeHtml(lead.phone)}" title="Clique para copiar">${escapeHtml(lead.phone)}</span></td>
      <td>${new Date(lead.scheduled_for).toLocaleString("pt-BR")}</td>
      <td><span class="tag tag--${lead.schedule_type}">${typeLabel}</span></td>
      <td style="text-align:center;">${dispatchCell(hasPre, lead.scheduled_for, PRE_OFFSET, PRE_WINDOW)}</td>
      <td style="text-align:center;">${dispatchCell(hasPos, lead.scheduled_for, POS_OFFSET, POS_WINDOW)}</td>
      <td>
        <div class="row" style="gap:.4rem;flex-wrap:nowrap;">
          ${profile?.role === "admin" ? `
          <button class="btn btn--sm btn--ghost lead-remind-btn" data-id="${lead.id}" title="Enviar lembrete manual">📱</button>
          <button class="btn btn--sm btn--ghost lead-followup-btn" data-id="${lead.id}" title="Enviar follow-up em texto">💬</button>
          <button class="btn btn--sm btn--ghost lead-audio-btn" data-id="${lead.id}" title="${dispatchSettings.followup_audio_url ? 'Enviar follow-up em áudio' : 'Configure a URL do áudio nas configurações'}">🎙️</button>
          ` : ""}
          <button class="btn btn--sm btn--danger lead-delete-btn" data-id="${lead.id}" title="Remover lead">×</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function exportLeadsCsv() {
  const rows = document.querySelectorAll("#leads-tbody tr");
  if (!rows.length) { toast("Nenhum lead para exportar.", "error"); return; }

  const lines = ["Nome,Telefone,Horário Agendado,Tipo,Data de Cadastro"];
  rows.forEach((tr) => {
    const cells = [...tr.querySelectorAll("td")].slice(0, 5).map((td) => `"${td.textContent.trim().replace(/"/g, '""')}"`);
    lines.push(cells.join(","));
  });

  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leads-${WID.slice(0, 8)}.csv`;
  a.click();
}

// Verifica se qualquer lead com o mesmo telefone já recebeu aquele tipo de mensagem
function phoneAlreadySent(phone, type) {
  const digits = phone.replace(/\D/g, "");
  return leadsCache.some(l => l.phone.replace(/\D/g, "") === digits && remMap[l.id]?.[type]);
}

// Fallback quando nenhuma instância está cadastrada no banco para o dono
const MANUAL_MEGA_BASE  = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-MJjV24kQIXz";
const MANUAL_MEGA_TOKEN = "MJjV24kQIXz";

async function getWebinarInstance() {
  // Tenta pela owner_id do webinário
  if (webinar?.owner_id) {
    const { data } = await supabase
      .from("dispatch_numbers")
      .select("api_url, api_token")
      .eq("owner_id", webinar.owner_id)
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  // Fallback: qualquer instância ativa (owner_id pode não estar vinculado)
  const { data } = await supabase
    .from("dispatch_numbers")
    .select("api_url, api_token")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function getWebinarDispatchMessage(dispatchType, msgType) {
  // Tenta primeiro com dispatch_type (mensagens novas)
  let q = supabase
    .from("webinar_dispatch_messages")
    .select("type, content")
    .eq("webinar_id", WID)
    .eq("dispatch_type", dispatchType)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (msgType) q = q.eq("type", msgType);
  const { data: d1, error: e1 } = await q.limit(1).maybeSingle();
  if (d1) return d1;

  // Fallback: sem filtro dispatch_type (migration não rodou ou mensagens antigas com NULL)
  let q2 = supabase
    .from("webinar_dispatch_messages")
    .select("type, content")
    .eq("webinar_id", WID)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (msgType) q2 = q2.eq("type", msgType);
  const { data: d2 } = await q2.limit(1).maybeSingle();
  return d2 || null;
}

async function sendLeadReminder(lead, btn) {
  if (phoneAlreadySent(lead.phone, "pre")) {
    if (!confirm(`${lead.name} já recebeu lembrete anteriormente. Enviar mesmo assim?`)) return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "..."; }
  try {
    const [msg, inst] = await Promise.all([
      getWebinarDispatchMessage("pre", null),
      getWebinarInstance(),
    ]);
    console.log("[sendLeadReminder] msg=", msg, "inst=", inst, "webinar.owner_id=", webinar?.owner_id);
    if (!msg) {
      toast("Nenhuma mensagem pré-aula configurada na aba Disparos deste webinário.", "error");
      return;
    }
    const digits  = lead.phone.replace(/\D/g, "");
    const to      = (digits.startsWith("55") ? digits : "55" + digits) + "@c.us";
    const base    = inst ? inst.api_url.replace(/\/$/, "") : MANUAL_MEGA_BASE;
    const token   = inst ? inst.api_token : MANUAL_MEGA_TOKEN;
    const liveUrl = publicUrl(webinar.slug) + (lead.schedule_id
      ? "&s=" + encodeURIComponent(lead.schedule_id)
      : "&start=" + new Date(lead.scheduled_for).getTime());
    console.log("[sendLeadReminder] to=", to, "base=", base, "liveUrl=", liveUrl);

    let res;
    if (msg.type === "audio") {
      const ext = msg.content.split(".").pop().split("?")[0].toLowerCase();
      const mimeType = ext === "ogg" ? "audio/ogg; codecs=opus"
        : ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/mp4";
      res = await fetch(base + "/mediaUrl", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageData: { to, url: msg.content, fileName: `audio.${ext}`, type: "ptt", mimeType, caption: "" } }),
      });
    } else {
      const text = msg.content
        .replace(/\{nome\}/gi, lead.name)
        .replace(/\{link\}/gi, liveUrl);
      res = await fetch(base + "/text", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageData: { to, text } }),
      });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[sendLeadReminder] API error", res.status, body);
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
    }
    toast(`Lembrete enviado para ${lead.name}!`, "success");
  } catch (e) {
    console.error("[sendLeadReminder] erro:", e);
    toast(`Erro ao enviar lembrete: ${e.message}`, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📱"; }
  }
}

async function sendLeadFollowup(lead, btn) {
  if (phoneAlreadySent(lead.phone, "pos")) {
    if (!confirm(`${lead.name} já recebeu follow-up anteriormente. Enviar mesmo assim?`)) return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "..."; }
  try {
    const [msg, inst] = await Promise.all([
      getWebinarDispatchMessage("pos", "text"),
      getWebinarInstance(),
    ]);
    if (!msg) {
      toast("Nenhuma mensagem pós-aula (texto) configurada na aba Disparos deste webinário.", "error");
      return;
    }
    const digits = lead.phone.replace(/\D/g, "");
    const to     = (digits.startsWith("55") ? digits : "55" + digits) + "@c.us";
    const base   = inst ? inst.api_url.replace(/\/$/, "") : MANUAL_MEGA_BASE;
    const token  = inst ? inst.api_token : MANUAL_MEGA_TOKEN;
    const text   = msg.content.replace(/\{nome\}/gi, lead.name);
    const res = await fetch(base + "/text", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messageData: { to, text } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast(`Follow-up enviado para ${lead.name}!`, "success");
  } catch (e) {
    toast(`Erro ao enviar: ${e.message}`, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "💬"; }
  }
}

async function sendLeadAudio(lead, btn) {
  if (phoneAlreadySent(lead.phone, "pos")) {
    if (!confirm(`${lead.name} já recebeu follow-up anterior. Enviar áudio mesmo assim?`)) return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "..."; }
  try {
    const [msg, inst] = await Promise.all([
      getWebinarDispatchMessage("pos", "audio"),
      getWebinarInstance(),
    ]);
    if (!msg) {
      toast("Nenhuma mensagem pós-aula (áudio) configurada na aba Disparos deste webinário.", "error");
      return;
    }
    const digits   = lead.phone.replace(/\D/g, "");
    const to       = (digits.startsWith("55") ? digits : "55" + digits) + "@c.us";
    const base     = inst ? inst.api_url.replace(/\/$/, "") : MANUAL_MEGA_BASE;
    const token    = inst ? inst.api_token : MANUAL_MEGA_TOKEN;
    const audioUrl = msg.content;
    const ext      = audioUrl.split(".").pop().split("?")[0].toLowerCase();
    const mimeType = ext === "ogg" ? "audio/ogg; codecs=opus"
      : ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/mp4";
    const res = await fetch(base + "/mediaUrl", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messageData: { to, url: audioUrl, fileName: `audio.${ext}`, type: "ptt", mimeType, caption: "" } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast(`Áudio enviado para ${lead.name}!`, "success");
  } catch (e) {
    toast(`Erro ao enviar áudio: ${e.message}`, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🎙️"; }
  }
}

// =====================================================================
//  MENSAGENS AGENDADAS
// =====================================================================
function openSchedForm() {
  $("sched-msg-form").classList.remove("hidden");
  $("new-sched-msg-btn").classList.add("hidden");
  // Preenche data/hora com +1h
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  $("sched-datetime").value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function closeSchedForm() {
  $("sched-msg-form").classList.add("hidden");
  $("sched-templates").classList.add("hidden");
  $("new-sched-msg-btn").classList.remove("hidden");
  $("sched-phone").value = "";
  $("sched-name").value = "";
  $("sched-message").value = "";
  const wa = $("sched-mode-whatsapp"); if (wa) wa.checked = true;
  $("sched-phone-dropdown").classList.add("hidden");
}

function toggleTemplatesPanel() {
  const panel = $("sched-templates");
  const isHidden = panel.classList.toggle("hidden");
  $("toggle-templates").textContent = isHidden ? "📋 Ver templates" : "📋 Ocultar templates";
  // Inicializa o texto dos templates na primeira abertura
  if (!isHidden && webinar) {
    if (!$("tmpl-link-text").value) {
      const url = publicUrl(webinar.slug);
      $("tmpl-link-text").value =
        `🌸 Oi! Tudo bem?\n\nPassando para te lembrar que a aula do *Projeto Topos Lucrativos* vai começar em breve! 💖\n\nClique no link abaixo para assistir:\n\n👉 ${url}\n\nTe esperamos lá! ✨`;
    }
    if (!$("tmpl-followup-text").value) {
      $("tmpl-followup-text").value =
        `Oii, tudo bem? 😊\n\nSou da equipe da Gisele, você conseguiu ver nossa aula certinho?`;
    }
  }
}

function filterPhoneDropdown() {
  const query  = $("sched-phone").value.replace(/\D/g, "");
  const dropdown = $("sched-phone-dropdown");
  if (query.length < 2) { dropdown.classList.add("hidden"); return; }

  const seen = new Set();
  const matches = leadsCache.filter(l => {
    const digits = l.phone.replace(/\D/g, "");
    if (seen.has(digits)) return false;
    if (!digits.includes(query)) return false;
    seen.add(digits);
    return true;
  }).slice(0, 8);

  if (!matches.length) { dropdown.classList.add("hidden"); return; }

  dropdown.innerHTML = matches.map(m => `
    <div class="phone-dd-item" data-phone="${escapeHtml(m.phone)}" data-name="${escapeHtml(m.name)}">
      <span class="phone-dd-name">${escapeHtml(m.name)}</span>
      <span class="phone-dd-phone">${escapeHtml(m.phone)}</span>
    </div>`).join("");

  dropdown.querySelectorAll(".phone-dd-item").forEach(item => {
    item.addEventListener("click", () => {
      $("sched-phone").value = item.dataset.phone;
      $("sched-name").value  = item.dataset.name;
      dropdown.classList.add("hidden");
    });
  });
  dropdown.classList.remove("hidden");
}

async function saveScheduledMessage() {
  const phone   = $("sched-phone").value.trim();
  const name    = $("sched-name").value.trim();
  const message = $("sched-message").value.trim();
  const dtVal   = $("sched-datetime").value;

  if (!phone)   return toast("Informe o telefone.", "error");
  if (!message) return toast("Informe a mensagem.", "error");
  if (!dtVal)   return toast("Informe a data e hora.", "error");

  const scheduledFor = localInputToISO(dtVal);
  if (new Date(scheduledFor) <= new Date()) return toast("A data deve ser no futuro.", "error");

  const btn = $("sched-save-btn");
  btn.disabled = true; btn.textContent = "Agendando...";

  const dispatch_mode = document.querySelector("[name='sched-dispatch-mode']:checked")?.value || "whatsapp";
  const { error } = await supabase.from("scheduled_messages").insert({
    webinar_id: WID, phone, name, message, scheduled_for: scheduledFor, dispatch_mode,
  });
  btn.disabled = false; btn.textContent = "Agendar envio";

  if (error) return toast("Erro ao agendar: " + error.message, "error");
  toast("Mensagem agendada!", "success");
  closeSchedForm();
  loadScheduledMessages();
}

async function loadScheduledMessages() {
  const { data } = await supabase
    .from("scheduled_messages")
    .select("*")
    .eq("webinar_id", WID)
    .order("scheduled_for", { ascending: false })
    .limit(50);
  renderScheduledMessages(data || []);
}

function renderScheduledMessages(list) {
  const host = $("sched-msg-list");
  if (!list.length) {
    host.innerHTML = `<div class="empty muted" style="font-size:.85rem;">Nenhuma mensagem agendada.</div>`;
    return;
  }

  const statusLabel = { pending: "🕐 Pendente", sent: "✅ Enviado", failed: "❌ Falhou", cancelled: "🚫 Cancelado" };
  const statusColor = { pending: "#f59e0b", sent: "var(--green)", failed: "#ef4444", cancelled: "var(--text-dim)" };

  host.innerHTML = `
    <div class="leads-table-wrap" style="margin-top:.6rem;">
      <table class="leads-table">
        <thead>
          <tr>
            <th>Destinatário</th>
            <th>Mensagem</th>
            <th>Agendado para</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${list.map(m => {
            const dt = new Date(m.scheduled_for).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
            const preview = m.message.length > 70 ? m.message.slice(0, 70) + "…" : m.message;
            const color = statusColor[m.status] || "var(--text-dim)";
            const label = statusLabel[m.status] || m.status;
            const cancelBtn = m.status === "pending"
              ? `<button class="btn btn--sm btn--danger sched-cancel-msg" data-id="${m.id}" style="font-size:.75rem;">Cancelar</button>`
              : "";
            return `<tr>
              <td>
                <div style="font-weight:600;font-size:.88rem;">${escapeHtml(m.name || "—")}</div>
                <div class="lead-phone-copy muted" data-phone="${escapeHtml(m.phone)}" style="font-size:.8rem;">${escapeHtml(m.phone)}</div>
              </td>
              <td style="max-width:260px;color:var(--text-dim);font-size:.83rem;">${escapeHtml(preview)}</td>
              <td style="font-size:.84rem;white-space:nowrap;">${dt}</td>
              <td style="font-size:.82rem;font-weight:600;color:${color};white-space:nowrap;">${label}</td>
              <td>${cancelBtn}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  host.querySelectorAll(".sched-cancel-msg").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Cancelar este agendamento?")) return;
      btn.disabled = true;
      const { error } = await supabase
        .from("scheduled_messages")
        .update({ status: "cancelled" })
        .eq("id", btn.dataset.id);
      if (error) return toast("Erro: " + error.message, "error");
      toast("Agendamento cancelado.", "success");
      loadScheduledMessages();
    });
  });
}

async function deleteLead(leadId, btn) {
  if (!confirm("Remover este lead permanentemente? Esta ação não pode ser desfeita.")) return;
  if (btn) { btn.disabled = true; btn.textContent = "..."; }
  const { error } = await supabase.from("schedule_leads").delete().eq("id", leadId);
  if (error) {
    toast("Erro ao remover: " + error.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "×"; }
    return;
  }
  toast("Lead removido.", "success");
  await loadLeads();
}

// =====================================================================
//  ABA DISPAROS — mensagens por webinário
// =====================================================================
let dispatchMsgReady = false;

function openDisparosTab() {
  if (!dispatchMsgReady) {
    dispatchMsgReady = true;
    setupDisparosForm();
  }
  loadDispatchMessages("pre");
  loadDispatchMessages("pos");
  loadDispatchConfig();
}

function setupDisparosForm() {
  // Pré-aula toggle text/audio
  const preText  = $("dm-pre-type-text");
  const preAudio = $("dm-pre-type-audio");
  function togglePre() {
    const isAudio = preAudio.checked;
    $("dm-pre-text-wrap").classList.toggle("hidden", isAudio);
    $("dm-pre-audio-wrap").classList.toggle("hidden", !isAudio);
  }
  preText.addEventListener("change", togglePre);
  preAudio.addEventListener("change", togglePre);
  $("dm-pre-add-btn").addEventListener("click", () => addDispatchMessage("pre"));

  // Pós-aula toggle text/audio
  const posText  = $("dm-pos-type-text");
  const posAudio = $("dm-pos-type-audio");
  function togglePos() {
    const isAudio = posAudio.checked;
    $("dm-pos-text-wrap").classList.toggle("hidden", isAudio);
    $("dm-pos-audio-wrap").classList.toggle("hidden", !isAudio);
  }
  posText.addEventListener("change", togglePos);
  posAudio.addEventListener("change", togglePos);
  $("dm-pos-add-btn").addEventListener("click", () => addDispatchMessage("pos"));

  $("dc-pre-start").addEventListener("input", updateDcPreExample);
  $("dc-pre-end").addEventListener("input",   updateDcPreExample);
  $("dc-pos-start").addEventListener("input", updateDcPosExample);
  $("dc-pos-end").addEventListener("input",   updateDcPosExample);
  $("dc-save-btn").addEventListener("click",  saveDispatchConfig);

  // Modo de envio (whatsapp / webhook)
  $("dc-mode-whatsapp").addEventListener("change", toggleDcModeFields);
  $("dc-mode-webhook").addEventListener("change",  toggleDcModeFields);
  $("dc-mode-save-btn").addEventListener("click",  saveDcMode);

  $("test-send-btn").addEventListener("click",   testDisparoSend);
  $("test-status-btn").addEventListener("click", testDisparoStatus);
  loadTestInstanceInfo();
}

function toggleDcModeFields() {
  const isWebhook = $("dc-mode-webhook").checked;
  $("dc-webhook-wrap").classList.toggle("hidden", !isWebhook);
}

async function loadTestInstanceInfo() {
  const dc   = webinar?.settings?.dispatch_config || {};
  const mode = dc.mode || "whatsapp";
  const el   = $("test-instance-info");

  if (mode === "webhook") {
    const url = dc.webhook_url || "";
    el.innerHTML = `<strong>Modo: 🔗 Webhook</strong> &nbsp;→&nbsp; <code>${url || "URL não configurada"}</code>`;
    el.style.borderLeft = url ? "3px solid var(--success, #22c55e)" : "3px solid #ef4444";
    $("test-wa-fields").classList.add("hidden");
    $("test-status-btn").style.display = "none";
    $("test-card-title").textContent = "🧪 Teste de webhook";
    $("test-card-desc").textContent  = "Dispara o payload JSON para a URL de webhook deste webinário.";
  } else {
    const inst = await getWebinarInstance();
    if (inst) {
      el.innerHTML = `<strong>Modo: 📱 WhatsApp</strong> &nbsp;→&nbsp; <code>${inst.api_url}</code>`;
      el.style.borderLeft = "3px solid var(--success, #22c55e)";
    } else {
      el.innerHTML = `<strong>Modo: 📱 WhatsApp (fallback)</strong> &nbsp;→&nbsp; <code>${MANUAL_MEGA_BASE}</code>`;
      el.style.borderLeft = "3px solid var(--warning, #f59e0b)";
    }
    $("test-wa-fields").classList.remove("hidden");
    $("test-status-btn").style.display = "";
    $("test-card-title").textContent = "🧪 Teste de disparo WhatsApp";
    $("test-card-desc").textContent  = "Envio direto pela instância deste webinário para verificar se a API está funcionando.";
  }
}

function showTestResult(label, status, body, ok) {
  const el = $("test-result");
  const pre = $("test-result-pre");
  el.classList.remove("hidden");
  const color = ok ? "#22c55e" : "#ef4444";
  let formatted;
  try { formatted = JSON.stringify(JSON.parse(body), null, 2); } catch { formatted = body; }
  pre.style.borderLeft = `3px solid ${color}`;
  pre.textContent = `${label}\nHTTP ${status}\n\n${formatted}`;
}

async function testDisparoSend() {
  const phone = $("test-phone").value.trim();
  const name  = $("test-name").value.trim() || "Teste";
  const tipo  = $("test-tipo").value;
  if (!phone) { toast("Informe o número de destino.", "error"); return; }

  const btn = $("test-send-btn");
  btn.disabled = true; btn.textContent = "Enviando...";

  const dc   = webinar?.settings?.dispatch_config || {};
  const mode = dc.mode || "whatsapp";

  try {
    if (mode === "webhook") {
      // ── TESTE WEBHOOK ──────────────────────────────────────────────
      const webhookUrl = dc.webhook_url || "";
      if (!webhookUrl) { toast("Configure a URL do webhook primeiro.", "error"); return; }

      const digits = phone.replace(/\D/g, "");
      const payload = {
        nome:     name,
        telefone: digits.startsWith("55") ? digits : "55" + digits,
        link:     publicUrl(webinar.slug) + "&s=teste-manual",
        tipo,
      };
      console.log("[testWebhook] POST", webhookUrl, payload);
      const res  = await fetch(webhookUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const body = await res.text();
      console.log("[testWebhook] resposta:", res.status, body);
      showTestResult(`POST ${webhookUrl}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`, res.status, body, res.ok);
      if (res.ok) toast("Webhook disparado com sucesso!", "success");
      else        toast(`Webhook retornou HTTP ${res.status}`, "error");

    } else {
      // ── TESTE WHATSAPP ─────────────────────────────────────────────
      const message = $("test-message").value.trim();
      if (!message) { toast("Informe a mensagem de teste.", "error"); return; }

      const inst   = await getWebinarInstance();
      const base   = inst ? inst.api_url.replace(/\/$/, "") : MANUAL_MEGA_BASE;
      const token  = inst ? inst.api_token : MANUAL_MEGA_TOKEN;
      const digits = phone.replace(/\D/g, "");
      const to     = (digits.startsWith("55") ? digits : "55" + digits) + "@c.us";

      const url = base + "/text";
      console.log("[testDisparo] POST", url, { to, text: message });
      const res  = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageData: { to, text: message } }),
      });
      const body = await res.text();
      console.log("[testDisparo] resposta:", res.status, body);
      showTestResult(`POST ${url}\nTo: ${to}`, res.status, body, res.ok);
      if (res.ok) toast("Mensagem enviada! Verifique o WhatsApp.", "success");
      else        toast(`API retornou HTTP ${res.status}`, "error");
    }
  } catch (e) {
    console.error("[testDisparo] erro:", e);
    showTestResult("ERRO de rede / CORS", 0, e.message, false);
    toast(`Erro: ${e.message}`, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Enviar teste";
  }
}

async function testDisparoStatus() {
  const btn = $("test-status-btn");
  btn.disabled = true; btn.textContent = "Verificando...";
  try {
    const inst  = await getWebinarInstance();
    const base  = inst ? inst.api_url.replace(/\/$/, "") : MANUAL_MEGA_BASE;
    const token = inst ? inst.api_token : MANUAL_MEGA_TOKEN;

    // Extrai o nome da instância do URL (último segmento)
    const instanceName = base.split("/").pop();
    // Endpoint de status do WPPConnect / Mega API
    const statusUrl = base.replace(`/sendMessage/${instanceName}`, `/getStatus/${instanceName}`);
    console.log("[testStatus] GET", statusUrl);

    const res  = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.text();
    console.log("[testStatus] resposta:", res.status, body);
    showTestResult(`GET ${statusUrl}`, res.status, body, res.ok);
  } catch (e) {
    console.error("[testStatus] erro:", e);
    showTestResult("ERRO ao verificar status", 0, e.message, false);
    toast(`Erro: ${e.message}`, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Verificar status da instância";
  }
}

function loadDispatchConfig() {
  const dc = webinar.settings?.dispatch_config || {};

  // Modo de envio
  const mode = dc.mode || "whatsapp";
  $("dc-mode-whatsapp").checked = mode !== "webhook";
  $("dc-mode-webhook").checked  = mode === "webhook";
  $("dc-webhook-url").value     = dc.webhook_url || "";
  $("dc-webhook-wrap").classList.toggle("hidden", mode !== "webhook");

  $("dc-pre-enabled").checked = dc.pre?.enabled !== false;
  $("dc-pre-start").value     = dc.pre?.window_start_minutes ?? 30;
  $("dc-pre-end").value       = dc.pre?.window_end_minutes   ?? 10;
  $("dc-pos-enabled").checked = dc.pos?.enabled !== false;
  $("dc-pos-start").value     = dc.pos?.window_start_minutes ?? 60;
  $("dc-pos-end").value       = dc.pos?.window_end_minutes   ?? 90;
  updateDcPreExample();
  updateDcPosExample();
}

async function saveDcMode() {
  const mode       = $("dc-mode-webhook").checked ? "webhook" : "whatsapp";
  const webhookUrl = $("dc-webhook-url").value.trim();
  if (mode === "webhook" && !webhookUrl) {
    toast("Informe a URL do webhook antes de salvar.", "error");
    return;
  }
  const dc         = webinar.settings?.dispatch_config || {};
  const newDc      = { ...dc, mode, webhook_url: webhookUrl };
  const newSettings = { ...(webinar.settings || {}), dispatch_config: newDc };
  const { error } = await supabase.from("webinars").update({ settings: newSettings }).eq("id", WID);
  if (error) return toast("Erro ao salvar modo: " + error.message, "error");
  webinar.settings = newSettings;
  toast(mode === "webhook" ? "Modo webhook ativado!" : "Modo WhatsApp ativado!", "success");
}

function updateDcPreExample() {
  const start = +$("dc-pre-start").value || 30;
  const end   = +$("dc-pre-end").value   || 10;
  const dur   = Math.max(0, start - end);
  const ex    = $("dc-pre-example");
  if (dur <= 0) { ex.textContent = "⚠️ Início deve ser maior que o fim."; return; }
  const ref = new Date(new Date().setHours(20, 0, 0, 0));
  const fmt = (min) => new Date(ref.getTime() - min * 60000)
    .toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  ex.textContent = `Ex: aula às 20:00 → envia de ${fmt(start)} a ${fmt(end)} (~${Math.round(60 / dur)} leads/min)`;
}

function updateDcPosExample() {
  const start = +$("dc-pos-start").value || 60;
  const end   = +$("dc-pos-end").value   || 90;
  const ex    = $("dc-pos-example");
  if (end <= start) { ex.textContent = "⚠️ Fim deve ser maior que o início."; return; }
  const ref = new Date(new Date().setHours(20, 0, 0, 0));
  const fmt = (min) => new Date(ref.getTime() + min * 60000)
    .toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  ex.textContent = `Ex: aula às 20:00 → follow-up entre ${fmt(start)} e ${fmt(end)}`;
}

async function saveDispatchConfig() {
  const preStart = +$("dc-pre-start").value || 30;
  const preEnd   = +$("dc-pre-end").value   || 10;
  const posStart = +$("dc-pos-start").value || 60;
  const posEnd   = +$("dc-pos-end").value   || 90;

  if ($("dc-pre-enabled").checked && preStart <= preEnd)
    return toast("Pré-aula: início deve ser maior que o fim.", "error");
  if ($("dc-pos-enabled").checked && posEnd <= posStart)
    return toast("Pós-aula: fim deve ser maior que o início.", "error");

  const config = {
    pre: {
      enabled:              $("dc-pre-enabled").checked,
      window_start_minutes: preStart,
      window_end_minutes:   preEnd,
    },
    pos: {
      enabled:              $("dc-pos-enabled").checked,
      window_start_minutes: posStart,
      window_end_minutes:   posEnd,
    },
  };

  const newSettings = { ...(webinar.settings || {}), dispatch_config: config };
  const { error } = await supabase.from("webinars").update({ settings: newSettings }).eq("id", WID);
  if (error) return toast("Erro ao salvar: " + error.message, "error");
  webinar.settings = newSettings;
  toast("Configurações de disparo salvas!", "success");
}

async function loadDispatchMessages(dispatchType) {
  const hostId = dispatchType === "pos" ? "dispatch-pos-list" : "dispatch-pre-list";
  const host = $(hostId);
  host.innerHTML = `<p class="muted">Carregando...</p>`;

  const { data, error } = await supabase
    .from("webinar_dispatch_messages")
    .select("*")
    .eq("webinar_id", WID)
    .eq("dispatch_type", dispatchType)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) { host.innerHTML = `<div class="empty">Erro: ${escapeHtml(error.message)}</div>`; return; }

  if (!data.length) {
    host.innerHTML = `<div class="empty" style="border-style:dashed;">Nenhuma variação cadastrada ainda.</div>`;
    return;
  }

  host.innerHTML = "";
  data.forEach((msg, i) => {
    const card = document.createElement("div");
    card.className = "sub-item";
    card.style.cssText = "display:flex;align-items:flex-start;gap:.8rem;";

    const typeBadge = msg.type === "audio"
      ? `<span class="tag" style="background:rgba(124,92,255,.2);color:#a78bfa;flex-shrink:0;">🎙️ Áudio</span>`
      : `<span class="tag" style="background:rgba(43,182,115,.2);color:#4ade80;flex-shrink:0;">💬 Texto</span>`;

    const preview = msg.type === "audio"
      ? `<a href="${escapeHtml(msg.content)}" target="_blank" style="font-size:.82rem;color:var(--text-dim);">Ouvir áudio ↗</a>`
      : `<span style="font-size:.84rem;color:var(--text-dim);white-space:pre-wrap;word-break:break-word;">${escapeHtml(msg.content.length > 120 ? msg.content.slice(0,120) + "…" : msg.content)}</span>`;

    card.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div class="row" style="gap:.5rem;margin-bottom:.35rem;flex-wrap:wrap;">
          ${typeBadge}
          <span style="font-size:.78rem;color:var(--text-mut);">Variação ${i + 1}</span>
          <span class="tag" style="background:${msg.active ? "rgba(43,182,115,.15)" : "rgba(100,100,100,.15)"};color:${msg.active ? "#4ade80" : "var(--text-dim)"};">
            ${msg.active ? "● Ativa" : "○ Pausada"}
          </span>
        </div>
        ${preview}
      </div>
      <div class="row" style="gap:.35rem;flex-shrink:0;">
        <button class="btn btn--sm btn--ghost" data-act="toggle" data-id="${msg.id}" data-active="${msg.active}">
          ${msg.active ? "Pausar" : "Ativar"}
        </button>
        <button class="btn btn--sm btn--danger" data-act="del" data-id="${msg.id}" data-type="${dispatchType}">×</button>
      </div>`;

    card.querySelector('[data-act="toggle"]').addEventListener("click", (e) => {
      const btn = e.currentTarget;
      toggleDispatchMessage(btn.dataset.id, btn.dataset.active === "true", dispatchType);
    });
    card.querySelector('[data-act="del"]').addEventListener("click", (e) => {
      deleteDispatchMessage(e.currentTarget.dataset.id, dispatchType);
    });
    host.appendChild(card);
  });
}

async function addDispatchMessage(dispatchType) {
  const isAudio = $(`dm-${dispatchType}-type-audio`).checked;
  const btn = $(`dm-${dispatchType}-add-btn`);
  btn.disabled = true; btn.textContent = "Salvando...";

  let content = "";
  try {
    if (isAudio) {
      const file = $(`dm-${dispatchType}-audio-file`).files[0];
      if (!file) { toast("Selecione um arquivo de áudio.", "error"); return; }
      $(`dm-${dispatchType}-audio-status`).textContent = "Enviando áudio...";
      content = await uploadDispatchAudio(file);
      $(`dm-${dispatchType}-audio-status`).textContent = "✓ Enviado";
      $(`dm-${dispatchType}-audio-file`).value = "";
    } else {
      content = $(`dm-${dispatchType}-text`).value.trim();
      if (!content) { toast("Digite o texto da mensagem.", "error"); return; }
    }

    const { data: existing } = await supabase
      .from("webinar_dispatch_messages")
      .select("sort_order")
      .eq("webinar_id", WID)
      .eq("dispatch_type", dispatchType)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.from("webinar_dispatch_messages").insert({
      webinar_id: WID,
      dispatch_type: dispatchType,
      type: isAudio ? "audio" : "text",
      content,
      sort_order: (existing?.sort_order ?? -1) + 1,
    });
    if (error) throw new Error(error.message);

    toast("Variação adicionada!", "success");
    $(`dm-${dispatchType}-text`).value = "";
    await loadDispatchMessages(dispatchType);
  } catch (err) {
    toast("Erro: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Adicionar variação";
  }
}

async function toggleDispatchMessage(id, currentActive, dispatchType) {
  const { error } = await supabase
    .from("webinar_dispatch_messages")
    .update({ active: !currentActive })
    .eq("id", id);
  if (error) return toast("Erro: " + error.message, "error");
  await loadDispatchMessages(dispatchType);
}

async function deleteDispatchMessage(id, dispatchType) {
  if (!confirm("Remover esta variação?")) return;
  const { error } = await supabase.from("webinar_dispatch_messages").delete().eq("id", id);
  if (error) return toast("Erro: " + error.message, "error");
  toast("Variação removida.", "success");
  await loadDispatchMessages(dispatchType);
}

async function uploadDispatchAudio(file) {
  const ext  = (file.name.split(".").pop() || "mp3").toLowerCase();
  const path = `${WID}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("webinar-dispatch")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("webinar-dispatch").getPublicUrl(path);
  return data.publicUrl;
}
