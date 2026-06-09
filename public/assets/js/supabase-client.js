// Inicializa o cliente Supabase (compartilhado por todas as páginas).
// Importa a lib via CDN (sem etapa de build).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.APP_CONFIG;

if (!cfg || cfg.SUPABASE_URL.includes("SEU-PROJETO")) {
  console.warn(
    "[config] Preencha public/config.js com a URL e a anon key do seu projeto Supabase."
  );
}

export const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
export const CONFIG = cfg;

// Sessão atual (ou null).
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

// Perfil do usuário logado (inclui role).
export async function getMyProfile() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, role, name")
    .eq("id", u.user.id)
    .single();
  return data ?? { id: u.user.id, role: "user", name: u.user.email };
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "../index.html";
}
