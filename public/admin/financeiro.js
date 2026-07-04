import { supabase }            from "../assets/js/supabase-client.js";
import { requireAuth }          from "../assets/js/auth-guard.js";
import { escapeHtml, toast }    from "../assets/js/util.js";
import { initSidebar }          from "../assets/js/admin-sidebar.js";

const $ = id => document.getElementById(id);

let allRecords = [];
let searchTimer = null;

(async function init() {
  const profile = await requireAuth({ adminOnly: true });
  if (!profile) return;
  initSidebar(profile, "financeiro");

  // Set default date to today
  $("fin-date").value = new Date().toISOString().slice(0, 10);

  setupForm();
  await loadRecords();
})();

// ── Formulário ──────────────────────────────────────────────────────

function setupForm() {
  // Busca de lead com debounce
  $("fin-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchLeads($("fin-search").value.trim()), 280);
  });

  // Fecha sugestões ao clicar fora
  document.addEventListener("click", e => {
    if (!$("fin-search-wrap").contains(e.target)) hideSuggestions();
  });

  // Gera preview ao mudar valor, data ou parcelas
  ["fin-amount", "fin-date", "fin-installments"].forEach(id =>
    $(id).addEventListener("input", generatePreview)
  );

  $("fin-save").addEventListener("click", saveFin);
  $("fin-filter").addEventListener("input", () => renderList(allRecords));
}

async function searchLeads(query) {
  const ul = $("fin-suggestions");
  if (!query || query.length < 2) { hideSuggestions(); return; }

  const { data } = await supabase
    .from("schedule_leads")
    .select("id, name, phone")
    .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(10);

  if (!data || !data.length) { hideSuggestions(); return; }

  ul.innerHTML = "";
  data.forEach(lead => {
    const li = document.createElement("li");
    li.textContent = `${lead.name} — ${lead.phone}`;
    li.addEventListener("click", () => fillLead(lead));
    ul.appendChild(li);
  });
  ul.style.display = "block";
}

function fillLead(lead) {
  $("fin-lead-id").value = lead.id;
  $("fin-name").value    = lead.name;
  $("fin-phone").value   = lead.phone;
  $("fin-search").value  = `${lead.name} — ${lead.phone}`;
  hideSuggestions();
}

function hideSuggestions() {
  $("fin-suggestions").style.display = "none";
}

function generatePreview() {
  const amount      = parseFloat($("fin-amount").value);
  const dateVal     = $("fin-date").value;
  const installments = parseInt($("fin-installments").value, 10);

  if (!amount || !dateVal || !installments || installments < 1) {
    $("fin-preview").style.display = "none";
    return;
  }

  const perInstallment = Math.floor((amount / installments) * 100) / 100;
  const remainder      = Math.round((amount - perInstallment * installments) * 100);
  const tbody          = $("fin-preview-body");
  tbody.innerHTML      = "";

  for (let i = 0; i < installments; i++) {
    const d = new Date(dateVal + "T12:00:00");
    d.setMonth(d.getMonth() + i);
    const value = i === installments - 1
      ? perInstallment + remainder / 100  // última parcela absorve resíduo de arredondamento
      : perInstallment;

    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${i + 1}/${installments}</td>` +
      `<td>${d.toLocaleDateString("pt-BR")}</td>` +
      `<td>R$ ${value.toFixed(2).replace(".", ",")}</td>`;
    tbody.appendChild(tr);
  }

  $("fin-preview").style.display = "block";
}

async function saveFin() {
  const name         = $("fin-name").value.trim();
  const phone        = $("fin-phone").value.trim();
  const amount       = parseFloat($("fin-amount").value);
  const dateVal      = $("fin-date").value;
  const installments = parseInt($("fin-installments").value, 10);
  const notes        = $("fin-notes").value.trim();
  const leadId       = $("fin-lead-id").value || null;

  if (!name)            return toast("Informe o nome do cliente.", "error");
  if (!phone)           return toast("Informe o telefone.", "error");
  if (!amount || amount <= 0) return toast("Informe um valor válido.", "error");
  if (!dateVal)         return toast("Informe a data da 1ª parcela.", "error");
  if (!installments || installments < 1) return toast("Informe o número de parcelas.", "error");

  const btn = $("fin-save");
  btn.disabled = true; btn.textContent = "Salvando…";

  try {
    const { data: { user } } = await supabase.auth.getUser();

    const { data: rec, error: recErr } = await supabase
      .from("financial_records")
      .insert({
        owner_id:     user.id,
        lead_id:      leadId,
        name, phone, notes,
        total_amount: amount,
        payment_date: dateVal,
        installments,
      })
      .select("id")
      .single();

    if (recErr) throw new Error(recErr.message);

    const perInstallment = Math.floor((amount / installments) * 100) / 100;
    const remainder      = Math.round((amount - perInstallment * installments) * 100);
    const rows = [];

    for (let i = 0; i < installments; i++) {
      const d = new Date(dateVal + "T12:00:00");
      d.setMonth(d.getMonth() + i);
      const value = i === installments - 1
        ? perInstallment + remainder / 100
        : perInstallment;

      rows.push({
        record_id:          rec.id,
        installment_number: i + 1,
        due_date:           d.toISOString().slice(0, 10),
        amount:             value,
      });
    }

    const { error: instErr } = await supabase
      .from("financial_installments")
      .insert(rows);

    if (instErr) throw new Error(instErr.message);

    toast("Cliente salvo com sucesso!", "success");
    resetForm();
    await loadRecords();
  } catch (err) {
    toast("Erro: " + err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Salvar cliente";
  }
}

function resetForm() {
  $("fin-lead-id").value    = "";
  $("fin-search").value     = "";
  $("fin-name").value       = "";
  $("fin-phone").value      = "";
  $("fin-amount").value     = "";
  $("fin-date").value       = new Date().toISOString().slice(0, 10);
  $("fin-installments").value = "1";
  $("fin-notes").value      = "";
  $("fin-preview").style.display = "none";
}

// ── Lista de clientes ────────────────────────────────────────────────

async function loadRecords() {
  const { data, error } = await supabase
    .from("financial_records")
    .select("*, financial_installments(*)")
    .order("created_at", { ascending: false });

  if (error) { $("fin-list").innerHTML = `<p class="muted">Erro: ${escapeHtml(error.message)}</p>`; return; }

  allRecords = data || [];
  renderSummary(allRecords);
  renderList(allRecords);
}

function renderSummary(records) {
  const totalClients  = records.length;
  const totalValue    = records.reduce((s, r) => s + Number(r.total_amount), 0);
  const totalPaid     = records.reduce((s, r) =>
    s + (r.financial_installments || []).filter(i => i.paid).reduce((a, i) => a + Number(i.amount), 0), 0);

  $("fin-summary").innerHTML =
    `<span>👤 <strong>${totalClients}</strong> cliente${totalClients !== 1 ? "s" : ""}</span>` +
    `<span>💵 Total: <strong>R$ ${fmtMoney(totalValue)}</strong></span>` +
    `<span>✅ Recebido: <strong style="color:#4ade80;">R$ ${fmtMoney(totalPaid)}</strong></span>` +
    `<span>⏳ Pendente: <strong style="color:#fbbf24;">R$ ${fmtMoney(totalValue - totalPaid)}</strong></span>`;
}

function renderList(records) {
  const filter = $("fin-filter").value.trim().toLowerCase();
  const host   = $("fin-list");

  const filtered = filter
    ? records.filter(r => r.name.toLowerCase().includes(filter) || r.phone.includes(filter))
    : records;

  if (!filtered.length) {
    host.innerHTML = `<div class="empty" style="border-style:dashed;">Nenhum cliente encontrado.</div>`;
    return;
  }

  host.innerHTML = "";
  filtered.forEach(rec => host.appendChild(buildRecordCard(rec)));
}

function buildRecordCard(rec) {
  const inst       = rec.financial_installments || [];
  const paidCount  = inst.filter(i => i.paid).length;
  const paidAmount = inst.filter(i => i.paid).reduce((s, i) => s + Number(i.amount), 0);
  const allPaid    = paidCount === inst.length && inst.length > 0;
  const statusBadge = allPaid
    ? `<span class="badge-paid">✓ Quitado</span>`
    : paidCount > 0
      ? `<span class="badge-pend">${paidCount}/${inst.length} pagas</span>`
      : `<span class="badge-pend">0/${inst.length} pagas</span>`;

  const wrap = document.createElement("div");
  wrap.className = "record-card";

  const header = document.createElement("div");
  header.className = "record-header";
  header.innerHTML =
    `<div style="flex:1;min-width:0;">` +
      `<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(rec.name)}</div>` +
      `<div style="font-size:.8rem;color:var(--text-dim);">${escapeHtml(rec.phone)}</div>` +
    `</div>` +
    `<div style="text-align:right;flex-shrink:0;">` +
      `<div style="font-weight:700;">R$ ${fmtMoney(rec.total_amount)}</div>` +
      `<div style="font-size:.78rem;color:var(--text-dim);">${rec.installments}x</div>` +
    `</div>` +
    `<div style="flex-shrink:0;">${statusBadge}</div>` +
    `<div style="color:var(--text-dim);font-size:.8rem;flex-shrink:0;">▼</div>`;

  const body = document.createElement("div");
  body.className = "record-body";

  if (rec.notes) {
    body.innerHTML += `<p style="font-size:.82rem;color:var(--text-dim);margin-bottom:.6rem;">📝 ${escapeHtml(rec.notes)}</p>`;
  }

  const table = document.createElement("table");
  table.className = "fin-table";
  table.innerHTML =
    `<thead><tr><th>#</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>`;
  const tbody = document.createElement("tbody");

  const sorted = [...inst].sort((a, b) => a.installment_number - b.installment_number);
  sorted.forEach(inst => {
    const tr = document.createElement("tr");
    const dueDate = new Date(inst.due_date + "T12:00:00").toLocaleDateString("pt-BR");
    tr.innerHTML =
      `<td>${inst.installment_number}/${rec.installments}</td>` +
      `<td>${dueDate}</td>` +
      `<td>R$ ${fmtMoney(inst.amount)}</td>` +
      `<td>${inst.paid
        ? `<span class="badge-paid">✓ Pago</span>`
        : `<span class="badge-pend">Pendente</span>`}</td>` +
      `<td>` +
        `<button class="btn btn--sm btn--ghost" data-id="${inst.id}" data-paid="${inst.paid}">` +
          (inst.paid ? "Desfazer" : "✓ Marcar pago") +
        `</button>` +
      `</td>`;

    tr.querySelector("button").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      await togglePaid(btn.dataset.id, btn.dataset.paid === "true", rec.id);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  body.appendChild(table);

  // Totais do card
  const resumo = document.createElement("div");
  resumo.style.cssText = "display:flex;gap:1.2rem;margin-top:.7rem;font-size:.82rem;color:var(--text-dim);flex-wrap:wrap;";
  resumo.innerHTML =
    `<span>Recebido: <strong style="color:#4ade80;">R$ ${fmtMoney(paidAmount)}</strong></span>` +
    `<span>Pendente: <strong style="color:#fbbf24;">R$ ${fmtMoney(Number(rec.total_amount) - paidAmount)}</strong></span>`;
  body.appendChild(resumo);

  // Botão excluir registro
  const delWrap = document.createElement("div");
  delWrap.style.cssText = "margin-top:.6rem;text-align:right;";
  const delBtn = document.createElement("button");
  delBtn.className = "btn btn--sm btn--danger";
  delBtn.textContent = "Excluir cliente";
  delBtn.addEventListener("click", () => deleteRecord(rec.id, rec.name));
  delWrap.appendChild(delBtn);
  body.appendChild(delWrap);

  header.addEventListener("click", () => {
    const isOpen = body.classList.toggle("open");
    header.querySelector("div:last-child").textContent = isOpen ? "▲" : "▼";
  });

  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

async function togglePaid(installmentId, currentPaid, recordId) {
  const newPaid = !currentPaid;
  const { error } = await supabase
    .from("financial_installments")
    .update({ paid: newPaid, paid_at: newPaid ? new Date().toISOString() : null })
    .eq("id", installmentId);

  if (error) { toast("Erro: " + error.message, "error"); return; }
  await loadRecords();
  // Re-abre o card que estava expandido
  setTimeout(() => {
    const cards = $("fin-list").querySelectorAll(".record-card");
    // Abre o primeiro card que corresponde ao record (re-render reseta tudo)
  }, 50);
}

async function deleteRecord(id, name) {
  if (!confirm(`Excluir o cliente "${name}" e todas as parcelas?`)) return;
  const { error } = await supabase.from("financial_records").delete().eq("id", id);
  if (error) return toast("Erro: " + error.message, "error");
  toast("Cliente excluído.", "success");
  await loadRecords();
}

// ── Utilitários ──────────────────────────────────────────────────────

function fmtMoney(value) {
  return Number(value).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
