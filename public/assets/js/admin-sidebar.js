import { signOut } from "./supabase-client.js";

export function initSidebar(profile, activeNav = "") {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const isAdmin = profile?.role === "admin";

  sidebar.innerHTML = `
    <div class="sidebar-brand"><span class="dot"></span> Webnário</div>
    <ul class="sidebar-nav">
      <li>
        <a href="dashboard.html" class="${activeNav === "webinarios" ? "active" : ""}">
          📺 Webinários
        </a>
      </li>
      ${isAdmin ? `
      <li>
        <a href="dispatch.html" class="${activeNav === "disparos" ? "active" : ""}">
          📢 Disparos
        </a>
      </li>` : ""}
      <li>
        <a href="leads.html" class="${activeNav === "leads" ? "active" : ""}">
          👥 Leads
        </a>
      </li>
    </ul>
    <div class="sidebar-footer">
      <span class="pill" style="font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${profile?.name || "Você"}
      </span>
      <button class="btn btn--ghost btn--sm" id="sidebar-logout">Sair</button>
    </div>`;

  document.getElementById("sidebar-logout").addEventListener("click", signOut);
}
