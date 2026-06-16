import { supabase, CONFIG } from "../assets/js/supabase-client.js";
import { requireAuth } from "../assets/js/auth-guard.js";
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
  if (!WID) { toast("Webinário não informado.", "error"); return; }

  setupTabs();
  await loadWebinar();

  $("save-btn").addEventListener("click", saveCore);
  $("publish-btn").addEventListener("click", togglePublish);
  $("copy-link").addEventListener("click", copyLink);
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
  $("leads-export").addEventListener("click", exportLeadsCsv);
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
    const btn = e.target.closest(".lead-remind-btn");
    if (!btn) return;
    const lead = leadsCache.find((l) => l.id === btn.dataset.id);
    if (lead) sendLeadReminder(lead, btn);
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
      if (tab.dataset.tab === "leads") loadLeads();
    });
  });
  // Ativa aba via parâmetro ?tab= na URL (ex: ?tab=leads)
  const tabParam = new URLSearchParams(location.search).get("tab");
  if (tabParam) {
    activateTab(tabParam);
    if (tabParam === "leads") loadLeads();
  }
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
  $("v-base").value = v.base ?? 120;
  $("v-peak").value = v.peak ?? 850;
  $("v-jitter").value = v.jitter ?? 12;
  $("waiting-text").value = s.waiting_text || "";
  $("ended-text").value = s.ended_text || "";
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
  const url = publicUrl(webinar.slug);
  $("preview-link").href = url;
}
async function copyLink() {
  try { await navigator.clipboard.writeText(publicUrl(webinar.slug)); toast("Link copiado!", "success"); }
  catch { toast(publicUrl(webinar.slug)); }
}

// ---------- Salvar core ----------
async function saveCore() {
  const btn = $("save-btn");
  btn.disabled = true; btn.textContent = "Salvando...";

  const settings = {
    ...(webinar.settings || {}),
    viewers: {
      base: parseInt($("v-base").value, 10) || 0,
      peak: parseInt($("v-peak").value, 10) || 0,
      jitter: parseInt($("v-jitter").value, 10) || 0,
    },
    waiting_text: $("waiting-text").value.trim(),
    ended_text: $("ended-text").value.trim(),
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

async function populateLeadsFilter() {
  const { data } = await supabase
    .from("webinar_schedules")
    .select("id, start_at, label")
    .eq("webinar_id", WID)
    .order("start_at", { ascending: true });

  allSchedules = data || [];
  const sel = $("leads-filter");
  // Mantém a opção "Todos" e adiciona fixas + horários reais
  sel.innerHTML = `
    <option value="all">Todos os horários</option>
    <option value="now">Assistiu Agora</option>
    <option value="relative_30">Em 30 minutos</option>
  `;
  for (const s of allSchedules) {
    const d = new Date(s.start_at);
    const label = s.label
      ? `${s.label} — ${d.toLocaleString("pt-BR")}`
      : d.toLocaleString("pt-BR");
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = label;
    sel.appendChild(opt);
  }
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
  else if (filter !== "all") query = query.eq("schedule_id", filter);

  const { data, error } = await query;
  if (error) { host.innerHTML = `<div class="empty">Erro: ${escapeHtml(error.message)}</div>`; return; }
  if (!data || !data.length) { host.innerHTML = `<div class="empty">Nenhum lead capturado ainda.</div>`; return; }

  leadsCache = data;

  host.innerHTML = `
    <div class="leads-summary muted" style="font-size:.85rem;margin-bottom:.6rem;">${data.length} lead${data.length !== 1 ? "s" : ""}</div>
    <div class="leads-table-wrap">
      <table class="leads-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Telefone</th>
            <th>Horário agendado</th>
            <th>Tipo</th>
            <th>Cadastro</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody id="leads-tbody"></tbody>
      </table>
    </div>`;

  const tbody = $("leads-tbody");
  for (const lead of data) {
    const typeLabel = { now: "Agora", relative_30: "30 min", scheduled: "Agendado" }[lead.schedule_type] || lead.schedule_type;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(lead.name)}</td>
      <td><span class="lead-phone-copy" data-phone="${escapeHtml(lead.phone)}" title="Clique para copiar">${escapeHtml(lead.phone)}</span></td>
      <td>${new Date(lead.scheduled_for).toLocaleString("pt-BR")}</td>
      <td><span class="tag tag--${lead.schedule_type}">${typeLabel}</span></td>
      <td class="muted">${new Date(lead.created_at).toLocaleString("pt-BR")}</td>
      <td><button class="btn btn--sm btn--ghost lead-remind-btn" data-id="${lead.id}">📱 Lembrete</button></td>
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

async function sendLeadReminder(lead, btn) {
  const digits = lead.phone.replace(/\D/g, "");
  const to = (digits.startsWith("55") ? digits : "55" + digits) + "@c.us";
  const baseUrl = publicUrl(webinar.slug);
  const liveUrl = lead.schedule_id
    ? baseUrl + "&s=" + encodeURIComponent(lead.schedule_id)
    : baseUrl + "&start=" + new Date(lead.scheduled_for).getTime();
  const text =
    `🌸 Oi, tudo bem?\n\n` +
    `Passando para te lembrar que a aula do *Projeto Topos Lucrativos* já vai começar! 💖\n\n` +
    `Nessa aula, você vai descobrir como transformar sua criatividade em uma fonte de renda, mesmo que esteja começando do zero.\n\n` +
    `Clique no link abaixo para assistir:\n\n` +
    `👉 ${liveUrl}\n\n` +
    `Estou te esperando para dar o primeiro passo rumo à sua transformação! ✨`;

  const MEGA_URL = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-M6hpeUt7tF1/text";
  const MEGA_TOKEN = "M6hpeUt7tF1";

  if (btn) { btn.disabled = true; btn.textContent = "Enviando..."; }
  try {
    const res = await fetch(MEGA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${MEGA_TOKEN}` },
      body: JSON.stringify({ messageData: { to, text } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast(`Lembrete enviado para ${lead.name}!`, "success");
  } catch (e) {
    toast(`Erro ao enviar: ${e.message}`, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📱 Lembrete"; }
  }
}
