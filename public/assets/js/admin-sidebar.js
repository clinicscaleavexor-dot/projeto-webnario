import { signOut } from "./supabase-client.js";

export function initSidebar(profile, activeNav) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const isAdmin = profile?.role === "admin";
  const a = activeNav || "";

  // Monta links de admin separadamente para evitar template literals aninhados
  let adminLinks = "";
  if (isAdmin) {
    const dClass   = a === "disparo"  ? "active" : "";
    const grpClass = a === "disparos" ? "active" : "";
    adminLinks =
      '<li><a href="blast.html" class="' + dClass + '">📤 Disparo</a></li>' +
      '<li><a href="dispatch.html" class="' + grpClass + '">📢 Grupos</a></li>';
  }

  const wClass = a === "webinarios" ? "active" : "";
  const lClass = a === "leads"      ? "active" : "";
  const name   = profile?.name || "Você";

  sidebar.innerHTML =
    '<div class="sidebar-brand"><span class="dot"></span> Webnário</div>' +
    '<ul class="sidebar-nav">' +
      '<li><a href="dashboard.html" class="' + wClass + '">📺 Webinários</a></li>' +
      adminLinks +
      '<li><a href="leads.html" class="' + lClass + '">👥 Leads</a></li>' +
    '</ul>' +
    '<div class="sidebar-footer">' +
      '<span class="pill" style="font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</span>' +
      '<button class="btn btn--ghost btn--sm" id="sidebar-logout">Sair</button>' +
    '</div>';

  document.getElementById("sidebar-logout").addEventListener("click", signOut);
}
