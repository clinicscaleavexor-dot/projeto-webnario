// Guarda de autenticação para páginas do painel admin.
// Redireciona para o login se não houver sessão. Retorna o profile.
import { supabase, getMyProfile } from "./supabase-client.js";

export async function requireAuth({ adminOnly = false } = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "../index.html";
    return null;
  }
  const profile = await getMyProfile();
  if (adminOnly && profile?.role !== "admin") {
    window.location.href = "dashboard.html";
    return null;
  }
  return profile;
}
