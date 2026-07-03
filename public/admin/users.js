import { supabase, CONFIG } from "../assets/js/supabase-client.js";
import { requireAuth } from "../assets/js/auth-guard.js";
import { escapeHtml, toast } from "../assets/js/util.js";
import { initSidebar } from "../assets/js/admin-sidebar.js";

const $ = (id) => document.getElementById(id);

(async function init() {
  const profile = await requireAuth({ adminOnly: true });
  if (!profile) return;

  initSidebar(profile, "");
  $("create-form").addEventListener("submit", onCreate);
  await loadUsers();
})();

async function loadUsers() {
  const host = $("users-list");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role, created_at")
    .order("created_at", { ascending: true });

  if (error) { host.innerHTML = `<div class="empty">Erro: ${escapeHtml(error.message)}</div>`; return; }
  if (!data.length) { host.innerHTML = `<div class="empty">Nenhum usuário.</div>`; return; }

  host.innerHTML = "";
  for (const u of data) {
    const el = document.createElement("div");
    el.className = "list-item";
    el.innerHTML = `
      <div>
        <strong>${escapeHtml(u.name || "—")}</strong>
        <div><small class="muted">Criado em ${new Date(u.created_at).toLocaleDateString("pt-BR")}</small></div>
      </div>
      <span class="badge ${u.role === "admin" ? "badge--published" : "badge--draft"}">${u.role === "admin" ? "Administrador" : "Usuário"}</span>`;
    host.appendChild(el);
  }
}

async function onCreate(e) {
  e.preventDefault();
  const btn = $("create-btn");
  btn.disabled = true; btn.textContent = "Criando...";

  const payload = {
    name: $("u-name").value.trim(),
    email: $("u-email").value.trim(),
    password: $("u-pass").value,
    role: $("u-role").value,
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/admin-create-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": CONFIG.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Falha ao criar usuário");

    toast("Usuário criado com sucesso!", "success");
    $("create-form").reset();
    await loadUsers();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Criar usuário";
  }
}
