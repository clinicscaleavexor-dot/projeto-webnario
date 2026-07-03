import { supabase } from "../assets/js/supabase-client.js";
import { requireAuth } from "../assets/js/auth-guard.js";
import { escapeHtml } from "../assets/js/util.js";
import { initSidebar } from "../assets/js/admin-sidebar.js";

const $ = (id) => document.getElementById(id);

(async function init() {
  const profile = await requireAuth();
  if (!profile) return;

  initSidebar(profile, "leads");
  await loadWebinars();
})();

async function loadWebinars() {
  const host = $("leads-webinar-list");
  const { data, error } = await supabase
    .from("webinars")
    .select("id, title, slug, status")
    .order("updated_at", { ascending: false });

  if (error || !data?.length) {
    host.innerHTML = `<div class="empty">Nenhum webinário encontrado.</div>`;
    return;
  }

  host.innerHTML = "";
  for (const w of data) {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="grow">
        <strong>${escapeHtml(w.title)}</strong>
        <span class="badge badge--${w.status}" style="margin-left:.5rem;">${w.status === "published" ? "Publicado" : "Rascunho"}</span>
      </div>
      <a class="btn btn--primary btn--sm" href="editor.html?id=${w.id}&tab=leads">Ver Leads</a>`;
    host.appendChild(item);
  }
}
