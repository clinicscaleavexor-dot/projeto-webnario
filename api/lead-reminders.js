const { createClient } = require("@supabase/supabase-js");

const MEGA_URL   = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-M6hpeUt7tF1/text";
const MEGA_TOKEN = "M6hpeUt7tF1";

// Máximo de envios por execução do cron (evita disparar tudo de uma vez)
const BATCH_SIZE = 8;
// Pausa entre cada envio (ms) para não sobrecarregar a API
const DELAY_MS   = 700;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildWatchUrl(slug, lead) {
  const base = (process.env.SITE_URL || "").replace(/\/$/, "");
  const param = lead.schedule_id
    ? `s=${encodeURIComponent(lead.schedule_id)}`
    : `start=${new Date(lead.scheduled_for).getTime()}`;
  return `${base}/watch.html?w=${encodeURIComponent(slug)}&${param}`;
}

async function sendWhatsApp(phone, text) {
  const digits = phone.replace(/\D/g, "");
  const to = (digits.startsWith("55") ? digits : "55" + digits) + "@c.us";
  try {
    const res = await fetch(MEGA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${MEGA_TOKEN}` },
      body: JSON.stringify({ messageData: { to, text } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function processLeads({ supabase, leads, type, msgBuilder, results }) {
  let sent = 0;

  for (const lead of leads) {
    if (sent >= BATCH_SIZE) break;

    // Checa deduplicação — pula se já foi enviado
    const { data: already } = await supabase
      .from("lead_reminder_log")
      .select("lead_id")
      .eq("lead_id", lead.id)
      .eq("type", type)
      .maybeSingle();

    if (already) continue;

    const slug = lead.webinars?.slug;
    if (!slug) continue;

    const text = msgBuilder(lead, buildWatchUrl(slug, lead));
    const ok = await sendWhatsApp(lead.phone, text);

    if (ok) {
      await supabase.from("lead_reminder_log").insert({ lead_id: lead.id, type });
      results[type]++;
      sent++;
    } else {
      results.errors++;
    }

    await sleep(DELAY_MS);
  }
}

function isAuthorized(req) {
  const { DISPATCH_SECRET, CRON_SECRET } = process.env;
  if (CRON_SECRET && req.headers["authorization"] === `Bearer ${CRON_SECRET}`) return true;
  if (DISPATCH_SECRET && req.headers["x-dispatch-secret"] === DISPATCH_SECRET) return true;
  return false;
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const nowMs = Date.now();
  const results = { pre: 0, pos: 0, errors: 0 };

  // Janela PRÉ-AULA: entre 15 e 20 minutos antes do início
  const preMin = new Date(nowMs + 15 * 60 * 1000).toISOString();
  const preMax = new Date(nowMs + 20 * 60 * 1000).toISOString();

  // Janela PÓS-AULA: entre 75 e 80 minutos após o início (≈ 1h20 depois)
  const posMin = new Date(nowMs - 80 * 60 * 1000).toISOString();
  const posMax = new Date(nowMs - 75 * 60 * 1000).toISOString();

  // Busca leads em cada janela (limite generoso para o filtro de dedup em JS)
  const [{ data: preLeads }, { data: posLeads }] = await Promise.all([
    supabase
      .from("schedule_leads")
      .select("id, name, phone, scheduled_for, schedule_id, webinar_id, webinars(slug)")
      .gte("scheduled_for", preMin)
      .lte("scheduled_for", preMax)
      .limit(50),
    supabase
      .from("schedule_leads")
      .select("id, name, phone, scheduled_for, schedule_id, webinar_id, webinars(slug)")
      .gte("scheduled_for", posMin)
      .lte("scheduled_for", posMax)
      .limit(50),
  ]);

  // --- Lembrete pré-aula ---
  await processLeads({
    supabase,
    leads: preLeads || [],
    type: "pre",
    msgBuilder: (lead, url) =>
      `🌸 Oi, ${lead.name}! Tudo bem?\n\n` +
      `Sua aula do *Projeto Topos Lucrativos* começa em breve! 💖\n\n` +
      `Já pode clicar no link abaixo para entrar na transmissão:\n\n` +
      `👉 ${url}\n\n` +
      `Te esperamos lá! ✨`,
    results,
  });

  // --- Follow-up pós-aula ---
  await processLeads({
    supabase,
    leads: posLeads || [],
    type: "pos",
    msgBuilder: (lead) =>
      `🌸 Oi, ${lead.name}! Tudo bem?\n\n` +
      `Queria saber se você conseguiu assistir à nossa aula do *Projeto Topos Lucrativos* hoje! 💖\n\n` +
      `Conseguiu assistir certinho? Me conta! 😊`,
    results,
  });

  return res.status(200).json({
    ok: true,
    pre_sent: results.pre,
    pos_sent: results.pos,
    errors: results.errors,
    time: new Date().toISOString(),
  });
};
