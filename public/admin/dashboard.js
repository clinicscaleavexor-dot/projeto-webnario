import { supabase, signOut } from "../assets/js/supabase-client.js";
import { requireAuth } from "../assets/js/auth-guard.js";
import { makeSlug, escapeHtml, toast } from "../assets/js/util.js";

const listEl = document.getElementById("list");
let profile = null;

(async function init() {
  profile = await requireAuth();
  if (!profile) return;

  document.getElementById("who").textContent = profile.name || "Você";
  if (profile.role === "admin") {
    document.getElementById("users-link").classList.remove("hidden");
  }
  document.getElementById("logout").addEventListener("click", signOut);
  document.getElementById("new-webinar").addEventListener("click", createWebinar);

  await loadList();
})();

async function loadList() {
  listEl.innerHTML = `<p class="muted">Carregando...</p>`;
  const { data, error } = await supabase
    .from("webinars")
    .select("id, title, slug, status, scheduled_start_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    listEl.innerHTML = `<div class="empty">Erro ao carregar: ${escapeHtml(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    listEl.innerHTML = `<div class="empty">Nenhum webinário ainda.<br>Clique em <b>+ Novo webinário</b> para começar.</div>`;
    return;
  }

  listEl.innerHTML = "";
  for (const w of data) {
    const when = w.scheduled_start_at
      ? new Date(w.scheduled_start_at).toLocaleString("pt-BR")
      : "sem horário definido";
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="grow">
        <div class="row wrap" style="gap:.6rem; margin-bottom:.3rem;">
          <strong>${escapeHtml(w.title)}</strong>
          <span class="badge badge--${w.status}">${w.status === "published" ? "Publicado" : "Rascunho"}</span>
        </div>
        <small class="muted">Início: ${when}</small>
      </div>
      <div class="row wrap">
        <button class="btn btn--sm" data-act="copy">Copiar link</button>
        <a class="btn btn--sm" href="../watch.html?w=${encodeURIComponent(w.slug)}" target="_blank">Abrir live</a>
        <a class="btn btn--sm btn--primary" href="editor.html?id=${w.id}">Configurar</a>
        <button class="btn btn--sm" data-act="dup">Duplicar</button>
        <button class="btn btn--sm btn--danger" data-act="del">Excluir</button>
      </div>`;

    item.querySelector('[data-act="copy"]').addEventListener("click", () => copyLink(w.slug));
    item.querySelector('[data-act="dup"]').addEventListener("click", () => duplicate(w.id));
    item.querySelector('[data-act="del"]').addEventListener("click", () => remove(w.id, w.title));
    listEl.appendChild(item);
  }
}

function publicUrl(slug) {
  return new URL(`watch.html?w=${encodeURIComponent(slug)}`, new URL("../", location.href)).href;
}

async function copyLink(slug) {
  try {
    await navigator.clipboard.writeText(publicUrl(slug));
    toast("Link copiado!", "success");
  } catch {
    toast(publicUrl(slug));
  }
}

async function createWebinar() {
  const title = "Novo webinário";
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("webinars")
    .insert({
      owner_id: u.user.id,
      title,
      slug: makeSlug(title),
      settings: { viewers: { base: 120, peak: 850, jitter: 12 }, waiting_text: "A transmissão vai começar em breve.", ended_text: "Esta transmissão foi encerrada." },
    })
    .select("id")
    .single();

  if (error) return toast("Erro: " + error.message, "error");
  window.location.href = `editor.html?id=${data.id}`;
}

async function duplicate(id) {
  const { data: u } = await supabase.auth.getUser();
  // Copia o webinário
  const { data: orig, error } = await supabase.from("webinars").select("*").eq("id", id).single();
  if (error) return toast("Erro: " + error.message, "error");

  const copy = {
    owner_id: u.user.id,
    title: orig.title + " (cópia)",
    slug: makeSlug(orig.title),
    status: "draft",
    video_url: orig.video_url,
    video_duration_seconds: orig.video_duration_seconds,
    scheduled_start_at: orig.scheduled_start_at,
    timezone: orig.timezone,
    settings: orig.settings,
  };
  const { data: nw, error: e2 } = await supabase.from("webinars").insert(copy).select("id").single();
  if (e2) return toast("Erro: " + e2.message, "error");

  // Copia filhos (comentários, ctas, banners)
  for (const tbl of ["comments", "ctas", "banners"]) {
    const { data: rows } = await supabase.from(tbl).select("*").eq("webinar_id", id);
    if (rows && rows.length) {
      const mapped = rows.map(({ id: _id, created_at, webinar_id, reply_to_id, ...rest }) => ({
        ...rest,
        webinar_id: nw.id,
        // reply_to_id apontaria para IDs do original; zeramos na cópia.
        ...(tbl === "comments" ? { reply_to_id: null } : {}),
      }));
      await supabase.from(tbl).insert(mapped);
    }
  }
  toast("Webinário duplicado!", "success");
  await loadList();
}

async function remove(id, title) {
  if (!confirm(`Excluir "${title}"? Esta ação não pode ser desfeita.`)) return;
  const { error } = await supabase.from("webinars").delete().eq("id", id);
  if (error) return toast("Erro: " + error.message, "error");
  toast("Webinário excluído.", "success");
  await loadList();
}
