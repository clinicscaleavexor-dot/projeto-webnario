import { supabase } from "../assets/js/supabase-client.js";
import { requireAuth } from "../assets/js/auth-guard.js";
import { initSidebar } from "../assets/js/admin-sidebar.js";
import { escapeHtml, toast } from "../assets/js/util.js";

const MEGA_URL       = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-M6hpeUt7tF1/text";
const MEGA_MEDIA_URL = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-M6hpeUt7tF1/mediaUrl";
const MEGA_TOKEN     = "M6hpeUt7tF1";

const $ = (id) => document.getElementById(id);

let leads = [];       // [{name, phone, status: null|"sent"|"error"|"sending"}]
let messages = [];    // [{type:"text"|"audio", content:"..."}]
let blasting = false;
let stopFlag  = false;

// =====================================================================
//  INIT
// =====================================================================
(async function init() {
  const profile = await requireAuth({ adminOnly: true });
  if (!profile) return;
  initSidebar(profile, "disparo");

  $("leads-file").addEventListener("change", onFileChange);
  $("leads-clear").addEventListener("click", clearLeads);

  $("msg-type-text").addEventListener("change",  toggleMsgType);
  $("msg-type-audio").addEventListener("change", toggleMsgType);
  $("msg-add-btn").addEventListener("click", addMessage);

  $("interval-preset").addEventListener("change", onIntervalChange);
  onIntervalChange();

  $("blast-start-btn").addEventListener("click", startBlast);
  $("blast-stop-btn").addEventListener("click",  stopBlast);

  renderMessages();
  updateStartBtn();
})();

// =====================================================================
//  LEADS — upload Excel/CSV
// =====================================================================
function onFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: "binary" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      parseLeads(rows);
    } catch (err) {
      toast("Erro ao ler arquivo: " + err.message, "error");
    }
  };
  reader.readAsBinaryString(file);
  e.target.value = "";
}

function findCol(keys, ...candidates) {
  for (const c of candidates) {
    const found = keys.find(k => k.toLowerCase().trim() === c.toLowerCase());
    if (found) return found;
  }
  return null;
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return (digits.startsWith("55") ? digits : "55" + digits) + "@c.us";
}

function parseLeads(rows) {
  if (!rows.length) { toast("Planilha vazia.", "error"); return; }
  const keys    = Object.keys(rows[0]);
  const nameCol = findCol(keys, "nome", "name", "nome completo", "full name");
  const phoneCol = findCol(keys, "telefone", "phone", "whatsapp", "celular", "fone", "número", "numero");

  if (!nameCol || !phoneCol) {
    toast(`Colunas não encontradas. Esperado: Nome e Telefone. Encontrado: ${keys.join(", ")}`, "error");
    return;
  }

  leads = rows
    .map(r => ({ name: String(r[nameCol] || "").trim(), rawPhone: String(r[phoneCol] || "") }))
    .filter(r => r.name && r.rawPhone)
    .map(r => ({ name: r.name, phone: normalizePhone(r.rawPhone), status: null }))
    .filter(r => r.phone);

  if (!leads.length) { toast("Nenhum lead válido encontrado.", "error"); return; }
  toast(`${leads.length} leads carregados!`, "success");
  renderLeadsPreview();
  updateStartBtn();
}

function renderLeadsPreview() {
  if (!leads.length) {
    $("leads-preview").classList.add("hidden");
    $("leads-empty").classList.remove("hidden");
    return;
  }
  $("leads-empty").classList.add("hidden");
  $("leads-preview").classList.remove("hidden");
  $("leads-count").textContent = `${leads.length} lead${leads.length !== 1 ? "s" : ""} carregado${leads.length !== 1 ? "s" : ""}`;

  const tbody = $("leads-tbody");
  tbody.innerHTML = leads.map((l, i) => `
    <tr id="lead-row-${i}" style="border-bottom:1px solid var(--border);">
      <td style="padding:.35rem .6rem;color:var(--text-dim);">${i + 1}</td>
      <td style="padding:.35rem .6rem;">${escapeHtml(l.name)}</td>
      <td style="padding:.35rem .6rem;font-size:.8rem;color:var(--text-dim);">${escapeHtml(l.phone.replace("@c.us",""))}</td>
      <td style="padding:.35rem .6rem;" id="lead-status-${i}">—</td>
    </tr>`).join("");
}

function clearLeads() {
  leads = [];
  renderLeadsPreview();
  updateStartBtn();
}

function setLeadStatus(i, status) {
  leads[i].status = status;
  const el = $(`lead-status-${i}`);
  if (!el) return;
  const map = {
    sending: `<span style="color:#f5a623;">⏳ Enviando…</span>`,
    sent:    `<span style="color:var(--green);">✓ Enviado</span>`,
    error:   `<span style="color:var(--red);">✗ Erro</span>`,
    skipped: `<span style="color:var(--text-dim);">⏭ Pulado</span>`,
  };
  el.innerHTML = map[status] || "—";
}

// =====================================================================
//  MENSAGENS
// =====================================================================
function toggleMsgType() {
  const isAudio = $("msg-type-audio").checked;
  $("msg-text-wrap").classList.toggle("hidden",  isAudio);
  $("msg-audio-wrap").classList.toggle("hidden", !isAudio);
}

async function addMessage() {
  const isAudio = $("msg-type-audio").checked;
  const btn = $("msg-add-btn");
  btn.disabled = true; btn.textContent = "Adicionando…";

  try {
    if (isAudio) {
      const file = $("msg-audio-file").files[0];
      if (!file) { toast("Selecione um arquivo de áudio.", "error"); return; }
      $("msg-audio-status").textContent = "Enviando…";
      const url = await uploadAudio(file);
      $("msg-audio-status").textContent = "✓ Enviado";
      $("msg-audio-file").value = "";
      messages.push({ type: "audio", content: url });
    } else {
      const text = $("msg-text").value.trim();
      if (!text) { toast("Digite o texto da mensagem.", "error"); return; }
      messages.push({ type: "text", content: text });
      $("msg-text").value = "";
    }
    renderMessages();
    updateStartBtn();
    toast("Variação adicionada!", "success");
  } finally {
    btn.disabled = false; btn.textContent = "+ Adicionar variação";
  }
}

function removeMessage(i) {
  messages.splice(i, 1);
  renderMessages();
  updateStartBtn();
}

function renderMessages() {
  const host = $("msg-variants");
  if (!messages.length) {
    host.innerHTML = `<p class="muted" style="font-size:.85rem;">Nenhuma variação adicionada. Use o formulário abaixo.</p>`;
    return;
  }
  host.innerHTML = messages.map((m, i) => {
    const badge = m.type === "audio"
      ? `<span class="tag" style="background:rgba(124,92,255,.2);color:#a78bfa;">🎙️ Áudio</span>`
      : `<span class="tag" style="background:rgba(43,182,115,.2);color:#4ade80;">💬 Texto</span>`;
    const preview = m.type === "audio"
      ? `<a href="${escapeHtml(m.content)}" target="_blank" style="font-size:.8rem;color:var(--text-dim);">Ouvir ↗</a>`
      : `<span style="font-size:.83rem;color:var(--text-dim);white-space:pre-wrap;word-break:break-word;">${escapeHtml(m.content.length > 120 ? m.content.slice(0,120)+"…" : m.content)}</span>`;
    return `
      <div class="sub-item" style="display:flex;align-items:flex-start;gap:.8rem;">
        <div style="flex:1;min-width:0;">
          <div class="row" style="gap:.5rem;margin-bottom:.3rem;">${badge}<span style="font-size:.78rem;color:var(--text-mut);">Variação ${i+1}</span></div>
          ${preview}
        </div>
        <button class="btn btn--sm btn--danger" onclick="removeMsg(${i})">×</button>
      </div>`;
  }).join("");
}
window.removeMsg = removeMessage;

// =====================================================================
//  INTERVALO
// =====================================================================
function onIntervalChange() {
  const val = $("interval-preset").value;
  const customWrap = $("interval-custom-wrap");
  customWrap.classList.toggle("hidden", val !== "custom");
  updateIntervalHint();
}

function getIntervalMs() {
  const val = $("interval-preset").value;
  if (val === "custom") return (parseInt($("interval-custom").value, 10) || 10) * 1000;
  return parseInt(val, 10);
}

function updateIntervalHint() {
  const ms = getIntervalMs();
  const total = leads.length;
  if (!total) { $("interval-hint").textContent = ""; return; }
  const totalSec = Math.round((ms * total) / 1000);
  const min = Math.floor(totalSec / 60), sec = totalSec % 60;
  $("interval-hint").textContent = `Com ${total} leads: duração estimada ≈ ${min > 0 ? min + "min " : ""}${sec}s`;
}

// =====================================================================
//  VALIDAÇÃO E START BUTTON
// =====================================================================
function updateStartBtn() {
  const warnings = [];
  if (!leads.length)    warnings.push("Carregue uma lista de leads.");
  if (!messages.length) warnings.push("Adicione pelo menos uma mensagem.");

  const warnEl = $("blast-warnings");
  if (warnings.length) {
    warnEl.innerHTML = warnings.map(w => `⚠️ ${w}`).join("<br>");
    warnEl.classList.remove("hidden");
    $("blast-start-btn").disabled = true;
  } else {
    warnEl.classList.add("hidden");
    $("blast-start-btn").disabled = blasting;
  }
  updateIntervalHint();
}

// =====================================================================
//  DISPARO
// =====================================================================
async function startBlast() {
  if (blasting || !leads.length || !messages.length) return;
  blasting = true; stopFlag = false;

  $("blast-start-btn").classList.add("hidden");
  $("blast-stop-btn").classList.remove("hidden");
  $("blast-progress-wrap").classList.remove("hidden");
  $("blast-log").classList.remove("hidden");
  $("blast-log-entries").innerHTML = "";

  const interval = getIntervalMs();
  const total    = leads.length;
  let sent = 0, errors = 0;

  for (let i = 0; i < total; i++) {
    if (stopFlag) { addLog("⏹ Disparo interrompido pelo usuário.", "muted"); break; }

    const lead = leads[i];
    const msg  = messages[i % messages.length];

    setLeadStatus(i, "sending");
    updateProgress(i, total, sent, errors);

    let ok = false;
    try {
      if (msg.type === "audio") {
        const res = await sendAudio(lead.phone, msg.content);
        ok = res.ok;
      } else {
        const text = msg.content.replace(/\{nome\}/gi, lead.name);
        const res  = await sendText(lead.phone, text);
        ok = res.ok;
      }
    } catch {}

    if (ok) {
      sent++;
      setLeadStatus(i, "sent");
      addLog(`✓ <strong>${escapeHtml(lead.name)}</strong> — ${escapeHtml(lead.phone.replace("@c.us",""))}`, "green");
    } else {
      errors++;
      setLeadStatus(i, "error");
      addLog(`✗ <strong>${escapeHtml(lead.name)}</strong> — falha no envio`, "red");
    }

    updateProgress(i + 1, total, sent, errors);

    if (i < total - 1 && !stopFlag) await sleep(interval);
  }

  blasting = false;
  $("blast-start-btn").classList.remove("hidden");
  $("blast-stop-btn").classList.add("hidden");
  $("blast-start-btn").disabled = false;

  const finalMsg = stopFlag
    ? `Disparo interrompido. ${sent} enviado${sent!==1?"s":""}, ${errors} erro${errors!==1?"s":""}.`
    : `✅ Disparo concluído! ${sent} enviado${sent!==1?"s":""}, ${errors} erro${errors!==1?"s":""}.`;
  addLog(finalMsg, sent === total - errors ? "green" : "muted");
  toast(finalMsg, "success");
}

function stopBlast() {
  stopFlag = true;
  $("blast-stop-btn").disabled = true;
  $("blast-stop-btn").textContent = "Parando…";
}

function updateProgress(done, total, sent, errors) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("blast-progress-bar").style.width = pct + "%";
  $("blast-progress-label").textContent = `${done} / ${total} — ✓ ${sent} enviados, ✗ ${errors} erros`;
  $("blast-progress-pct").textContent = pct + "%";
}

function addLog(html, color = "") {
  const el = document.createElement("div");
  el.style.cssText = `padding:.2rem 0;border-bottom:1px solid var(--border);color:${
    color === "green" ? "var(--green)" : color === "red" ? "var(--red)" : "var(--text-dim)"
  };`;
  el.innerHTML = html;
  $("blast-log-entries").prepend(el);
}

// =====================================================================
//  MEGA API
// =====================================================================
async function sendText(to, text) {
  const res = await fetch(MEGA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${MEGA_TOKEN}` },
    body: JSON.stringify({ messageData: { to, text } }),
  });
  return { ok: res.ok, status: res.status };
}

async function sendAudio(to, audioUrl) {
  const ext = audioUrl.split(".").pop().split("?")[0].toLowerCase();
  const mimeMap = { ogg: "audio/ogg; codecs=opus", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
  const res = await fetch(MEGA_MEDIA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${MEGA_TOKEN}` },
    body: JSON.stringify({ messageData: { to, url: audioUrl, fileName: `audio.${ext}`, type: "ptt", mimeType: mimeMap[ext] || "audio/mpeg", caption: "" } }),
  });
  return { ok: res.ok, status: res.status };
}

// =====================================================================
//  UPLOAD DE ÁUDIO (Supabase Storage)
// =====================================================================
async function uploadAudio(file) {
  const ext  = (file.name.split(".").pop() || "mp3").toLowerCase();
  const path = `blast/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("webinar-dispatch")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("webinar-dispatch").getPublicUrl(path);
  return data.publicUrl;
}

// =====================================================================
//  UTILS
// =====================================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
