import { supabase } from "../assets/js/supabase-client.js";
import { requireAuth } from "../assets/js/auth-guard.js";
import { initSidebar } from "../assets/js/admin-sidebar.js";
import { escapeHtml, toast } from "../assets/js/util.js";

const params = new URLSearchParams(location.search);
const FID = params.get("id");

const $ = (id) => document.getElementById(id);

let form = null;
let fields = []; // [{ key, label, required }]
let leadsCache = [];

(async function init() {
  const profile = await requireAuth();
  if (!profile) return;
  initSidebar(profile, "formulario");
  if (!FID) { toast("Formulário não informado.", "error"); return; }

  setupTabs();
  await loadForm();

  $("save-btn").addEventListener("click", saveForm);
  $("fm-add-field").addEventListener("click", addField);
  $("fm-copy-url").addEventListener("click", () => {
    navigator.clipboard.writeText($("fm-webhook-url").value).then(() => toast("URL copiada!", "success"));
  });
  $("fm-leads-refresh").addEventListener("click", () => loadLeads());
  $("fm-leads-export").addEventListener("click", exportLeadsCsv);
  $("fm-fields-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".fm-field-remove");
    if (btn) removeField(+btn.dataset.idx);
  });
  $("fm-leads-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".fm-lead-delete-btn");
    if (btn) deleteLead(btn.dataset.id, btn);
  });

  const tabParam = params.get("tab");
  if (tabParam) {
    activateTab(tabParam);
    if (tabParam === "leads") loadLeads();
  }
})();

// ---------- Tabs ----------
function activateTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelector(`[data-tab="${name}"]`)?.classList.add("active");
  document.querySelector(`[data-panel="${name}"]`)?.classList.add("active");
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activateTab(tab.dataset.tab);
      if (tab.dataset.tab === "webhook") renderWebhookTab();
      if (tab.dataset.tab === "leads") loadLeads();
    });
  });
}

// ---------- Carregar / salvar ----------
async function loadForm() {
  const { data, error } = await supabase
    .from("custom_forms")
    .select("*")
    .eq("id", FID)
    .single();

  if (error || !data) {
    toast("Erro ao carregar formulário: " + (error?.message || "não encontrado"), "error");
    return;
  }
  form = data;
  fields = Array.isArray(data.fields) ? data.fields : [];
  $("fm-name").value = data.name || "";
  renderFields();
  renderWebhookTab();
}

async function saveForm() {
  const name = $("fm-name").value.trim() || "Novo formulário";
  const { error } = await supabase
    .from("custom_forms")
    .update({ name, fields, updated_at: new Date().toISOString() })
    .eq("id", FID);

  if (error) return toast("Erro ao salvar: " + error.message, "error");
  toast("Formulário salvo!", "success");
}

// ---------- Perguntas ----------
function slugifyKey(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "campo";
}

function uniqueKey(base) {
  let key = base;
  let n = 2;
  while (fields.some((f) => f.key === key)) key = `${base}_${n++}`;
  return key;
}

function renderFields() {
  const host = $("fm-fields-list");
  if (!fields.length) {
    host.innerHTML = `<div class="empty">Nenhuma pergunta cadastrada ainda.</div>`;
    return;
  }
  host.innerHTML = fields.map((f, idx) => `
    <div class="sub-item row spread wrap" style="align-items:center;">
      <div>
        <strong>${escapeHtml(f.label)}</strong>
        <span class="muted" style="margin-left:.5rem;font-size:.82rem;">chave: <code>${escapeHtml(f.key)}</code>${f.required ? " · obrigatório" : ""}</span>
      </div>
      <button class="btn btn--sm btn--danger fm-field-remove" data-idx="${idx}">Remover</button>
    </div>
  `).join("");
}

function addField() {
  const label = $("fm-new-label").value.trim();
  if (!label) { toast("Digite o texto da pergunta.", "error"); return; }
  const rawKey = $("fm-new-key").value.trim();
  const key = uniqueKey(slugifyKey(rawKey || label));
  const required = $("fm-new-required").checked;

  fields.push({ key, label, required });
  $("fm-new-label").value = "";
  $("fm-new-key").value = "";
  $("fm-new-required").checked = false;

  renderFields();
  renderWebhookTab();
  toast("Pergunta adicionada. Clique em Salvar para confirmar.", "success");
}

function removeField(idx) {
  if (!confirm("Remover esta pergunta do formulário?")) return;
  fields.splice(idx, 1);
  renderFields();
  renderWebhookTab();
}

// ---------- Webhook ----------
function webhookUrl() {
  return `${location.origin}/api/webhook-form?form_id=${FID}`;
}

function renderWebhookTab() {
  $("fm-webhook-url").value = webhookUrl();
  const example = {};
  if (fields.length) {
    for (const f of fields) example[f.key] = `<${f.label}>`;
  } else {
    example.chave = "valor";
  }
  $("fm-webhook-example").textContent = JSON.stringify(example, null, 2);
}

// ---------- Leads ----------
async function loadLeads() {
  const host = $("fm-leads-list");
  host.innerHTML = `<div class="empty">Carregando...</div>`;

  const { data, error } = await supabase
    .from("custom_form_leads")
    .select("*")
    .eq("form_id", FID)
    .order("created_at", { ascending: false });

  if (error) { host.innerHTML = `<div class="empty">Erro: ${escapeHtml(error.message)}</div>`; return; }
  if (!data || !data.length) { host.innerHTML = `<div class="empty">Nenhum lead recebido pelo webhook ainda.</div>`; return; }

  leadsCache = data;

  const columns = fields.length ? fields : deriveColumnsFromLeads(data);

  host.innerHTML = `
    <div class="leads-summary muted" style="font-size:.85rem;margin-bottom:.6rem;">
      ${data.length} lead${data.length !== 1 ? "s" : ""}
    </div>
    <div class="leads-table-wrap">
      <table class="leads-table">
        <thead>
          <tr>
            ${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}
            <th>Recebido em</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody id="fm-leads-tbody"></tbody>
      </table>
    </div>`;

  const tbody = $("fm-leads-tbody");
  for (const lead of data) {
    const tr = document.createElement("tr");
    const cells = columns.map((c) => `<td>${escapeHtml(lead.data?.[c.key] ?? "—")}</td>`).join("");
    tr.innerHTML = `
      ${cells}
      <td>${new Date(lead.created_at).toLocaleString("pt-BR")}</td>
      <td><button class="btn btn--sm btn--danger fm-lead-delete-btn" data-id="${lead.id}" title="Remover lead">×</button></td>
    `;
    tbody.appendChild(tr);
  }
}

// Quando não há perguntas cadastradas, monta colunas a partir das chaves que já chegaram.
function deriveColumnsFromLeads(leads) {
  const keys = new Set();
  for (const l of leads) Object.keys(l.data || {}).forEach((k) => keys.add(k));
  return [...keys].map((key) => ({ key, label: key }));
}

async function deleteLead(leadId, btn) {
  if (!confirm("Remover este lead permanentemente? Esta ação não pode ser desfeita.")) return;
  if (btn) { btn.disabled = true; btn.textContent = "..."; }
  const { error } = await supabase.from("custom_form_leads").delete().eq("id", leadId);
  if (error) {
    toast("Erro ao remover: " + error.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "×"; }
    return;
  }
  toast("Lead removido.", "success");
  await loadLeads();
}

function exportLeadsCsv() {
  if (!leadsCache.length) { toast("Nenhum lead para exportar.", "error"); return; }

  const columns = fields.length ? fields : deriveColumnsFromLeads(leadsCache);
  const lines = [[...columns.map((c) => c.label), "Recebido em"].map(csvCell).join(",")];
  for (const lead of leadsCache) {
    const row = [...columns.map((c) => lead.data?.[c.key] ?? ""), new Date(lead.created_at).toLocaleString("pt-BR")];
    lines.push(row.map(csvCell).join(","));
  }

  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `formulario-${FID.slice(0, 8)}.csv`;
  a.click();
}

function csvCell(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
