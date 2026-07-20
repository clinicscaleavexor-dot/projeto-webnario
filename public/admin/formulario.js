import { supabase } from "../assets/js/supabase-client.js";
import { requireAuth } from "../assets/js/auth-guard.js";
import { escapeHtml, toast } from "../assets/js/util.js";
import { initSidebar } from "../assets/js/admin-sidebar.js";

const listEl = document.getElementById("list");

(async function init() {
  const profile = await requireAuth();
  if (!profile) return;

  initSidebar(profile, "formulario");
  document.getElementById("new-form").addEventListener("click", createForm);
  await loadList();
})();

async function loadList() {
  listEl.innerHTML = `<p class="muted">Carregando...</p>`;
  const { data, error } = await supabase
    .from("custom_forms")
    .select("id, name, fields, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    listEl.innerHTML = `<div class="empty">Erro ao carregar: ${escapeHtml(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    listEl.innerHTML = `<div class="empty">Nenhum formulário ainda.<br>Clique em <b>+ Novo formulário</b> para começar.</div>`;
    return;
  }

  listEl.innerHTML = "";
  for (const f of data) {
    const fieldCount = Array.isArray(f.fields) ? f.fields.length : 0;
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="grow">
        <strong>${escapeHtml(f.name)}</strong>
        <span class="muted" style="margin-left:.6rem;font-size:.85rem;">${fieldCount} pergunta${fieldCount !== 1 ? "s" : ""}</span>
      </div>
      <div class="row wrap">
        <a class="btn btn--sm btn--primary" href="formulario-editor.html?id=${f.id}">Configurar</a>
        <a class="btn btn--sm" href="formulario-editor.html?id=${f.id}&tab=leads">Ver leads</a>
        <button class="btn btn--sm btn--danger" data-act="del">Excluir</button>
      </div>`;

    item.querySelector('[data-act="del"]').addEventListener("click", () => remove(f.id, f.name));
    listEl.appendChild(item);
  }
}

async function createForm() {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("custom_forms")
    .insert({ owner_id: u.user.id, name: "Novo formulário", fields: [] })
    .select("id")
    .single();

  if (error) return toast("Erro: " + error.message, "error");
  window.location.href = `formulario-editor.html?id=${data.id}`;
}

async function remove(id, name) {
  if (!confirm(`Excluir "${name}"? Isso apaga também todos os leads recebidos por ele. Esta ação não pode ser desfeita.`)) return;
  const { error } = await supabase.from("custom_forms").delete().eq("id", id);
  if (error) return toast("Erro: " + error.message, "error");
  toast("Formulário excluído.", "success");
  await loadList();
}
