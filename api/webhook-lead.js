// Vercel serverless function — recebe leads de formulários externos via webhook
// e só salva na tabela public.webhook_form_leads (nenhum disparo é feito aqui).
// Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Uso: POST https://SEU-DOMINIO/api/webhook-lead?webinar_id=ID_DO_WEBINARIO
// Body JSON: { "nome": "Maria Silva", "telefone": "11999999999" }
// (também aceita "name" / "phone" / "whatsapp" como chaves)

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function sbGet(path) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

async function sbPost(path, body) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido, use POST." });

  const webinarId = req.query?.webinar_id;
  if (!webinarId) return res.status(400).json({ error: "Informe ?webinar_id=... na URL do webhook." });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "JSON inválido no corpo da requisição." }); }
  }
  body = body || {};

  const name  = String(body.nome ?? body.name ?? "").trim();
  const phone = String(body.telefone ?? body.phone ?? body.whatsapp ?? "").trim();

  if (!name || !phone) {
    return res.status(400).json({ error: "Envie 'nome' e 'telefone' no corpo JSON." });
  }

  try {
    const webinars = await sbGet(`webinars?id=eq.${encodeURIComponent(webinarId)}&select=id`);
    if (!webinars.length) return res.status(404).json({ error: "Webinário não encontrado." });
  } catch (e) {
    return res.status(500).json({ error: "Falha ao validar webinário.", detail: e.message });
  }

  try {
    const [lead] = await sbPost("webhook_form_leads", {
      webinar_id: webinarId,
      name,
      phone,
      raw: body,
    });
    return res.status(200).json({ ok: true, lead: { id: lead.id, name: lead.name, phone: lead.phone, created_at: lead.created_at } });
  } catch (e) {
    return res.status(500).json({ error: "Falha ao salvar o lead.", detail: e.message });
  }
};
