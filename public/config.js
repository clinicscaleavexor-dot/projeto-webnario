// =====================================================================
//  CONFIGURAÇÃO DO SUPABASE  —  PREENCHA COM OS DADOS DO SEU PROJETO
// ---------------------------------------------------------------------
//  Onde achar: painel do Supabase -> Project Settings -> API
//    - Project URL          ->  SUPABASE_URL
//    - Project API keys: anon public  ->  SUPABASE_ANON_KEY
//
//  A chave "anon" é PÚBLICA e pode ficar no frontend. NUNCA coloque
//  aqui a chave "service_role" (secreta) — ela só vive na Edge Function.
// =====================================================================

window.APP_CONFIG = {
  SUPABASE_URL: "https://ashfphnqpkknsfbwmuhs.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzaGZwaG5xcGtrbnNmYndtdWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NTIwMTIsImV4cCI6MjA5NjUyODAxMn0.nlx-Q9pYPcJqMB2Xn3nn-H_xMZK31OcLW_J9ApVW3w8",

  // Chave para disparar lembretes manualmente (deve ser igual à env var DISPATCH_SECRET no Vercel)
  DISPATCH_SECRET: "webnario-dispatch-2025",

  // Buckets de Storage (não precisa mexer, a menos que renomeie no Supabase)
  VIDEO_BUCKET: "webinar-videos",
  BANNER_BUCKET: "webinar-banners",
};
