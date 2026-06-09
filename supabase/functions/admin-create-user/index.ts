// =====================================================================
//  Edge Function: admin-create-user  (Deno)
//  Cria um novo usuário — SOMENTE se quem chamou for admin.
//
//  Deploy:
//    supabase functions deploy admin-create-user
//  (a function recebe automaticamente SUPABASE_URL e
//   SUPABASE_SERVICE_ROLE_KEY do ambiente do projeto)
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // 1) Identifica quem chamou (a partir do token JWT enviado pelo frontend)
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return json({ error: "Não autenticado" }, 401);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Sessão inválida" }, 401);

  // 2) Confere se o chamador é admin
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return json({ error: "Apenas administradores podem criar usuários." }, 403);
  }

  // 3) Lê os dados do novo usuário
  let payload: { email?: string; password?: string; name?: string; role?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const email = (payload.email ?? "").trim().toLowerCase();
  const password = payload.password ?? "";
  const name = (payload.name ?? "").trim();
  const role = payload.role === "admin" ? "admin" : "user";

  if (!email || password.length < 6) {
    return json({ error: "Informe e-mail e senha (mín. 6 caracteres)." }, 400);
  }

  // 4) Cria o usuário (já confirmado, sem precisar de e-mail de verificação)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (createErr || !created?.user) {
    return json({ error: createErr?.message ?? "Falha ao criar usuário" }, 400);
  }

  // 5) Garante o profile com o papel escolhido
  await admin
    .from("profiles")
    .upsert({ id: created.user.id, name: name || email, role }, { onConflict: "id" });

  return json({ ok: true, user: { id: created.user.id, email, name, role } });
});
