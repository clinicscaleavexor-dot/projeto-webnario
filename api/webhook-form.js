// Vercel serverless function — recebe dados de um formulário avulso
// (menu "Formulário", não vinculado a nenhum webinário) e só salva o
// lead. Nenhum disparo é feito aqui.
// Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Uso: POST https://SEU-DOMINIO/api/webhook-form?form_id=ID_DO_FORMULARIO
// Body JSON: livre — qualquer chave/valor que sua ferramenta enviar.

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

  const formId = req.query?.form_id;
  if (!formId) return res.status(400).json({ error: "Informe ?form_id=... na URL do webhook." });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "JSON inválido no corpo da requisição." }); }
  }
  body = body || {};

  if (!Object.keys(body).length) {
    return res.status(400).json({ error: "Corpo JSON vazio." });
  }

  try {
    const forms = await sbGet(`custom_forms?id=eq.${encodeURIComponent(formId)}&select=id`);
    if (!forms.length) return res.status(404).json({ error: "Formulário não encontrado." });
  } catch (e) {
    return res.status(500).json({ error: "Falha ao validar formulário.", detail: e.message });
  }

  try {
    const [lead] = await sbPost("custom_form_leads", { form_id: formId, data: body });
    return res.status(200).json({ ok: true, lead: { id: lead.id, data: lead.data, created_at: lead.created_at } });
  } catch (e) {
    return res.status(500).json({ error: "Falha ao salvar o lead.", detail: e.message });
  }
};
