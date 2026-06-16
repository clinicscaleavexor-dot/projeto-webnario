const { createClient } = require("@supabase/supabase-js");

const MEGA_URL   = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-M6hpeUt7tF1/text";
const MEGA_TOKEN = "M6hpeUt7tF1";

const BATCH_SIZE = 8;
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
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

async function processLeads({ supabase, leads, type, slugMap, msgBuilder, results, log }) {
  let sent = 0;

  for (const lead of leads) {
    if (sent >= BATCH_SIZE) break;

    const slug = slugMap[lead.webinar_id];
    if (!slug) {
      log.push({ id: lead.id, name: lead.name, type, skipped: "sem_slug", webinar_id: lead.webinar_id });
      results.skipped++;
      continue;
    }

    // Deduplicação — pula se já foi enviado
    const { data: already, error: dupErr } = await supabase
      .from("lead_reminder_log")
      .select("lead_id")
      .eq("lead_id", lead.id)
      .eq("type", type)
      .maybeSingle();

    if (dupErr) {
      log.push({ id: lead.id, name: lead.name, type, skipped: "dup_check_error", error: dupErr.message });
      results.errors++;
      continue;
    }
    if (already) {
      log.push({ id: lead.id, name: lead.name, type, skipped: "ja_enviado" });
      continue;
    }

    const url  = buildWatchUrl(slug, lead);
    const text = msgBuilder(lead, url);
    const { ok, status, error: sendErr } = await sendWhatsApp(lead.phone, text);

    if (ok) {
      const { error: logErr } = await supabase
        .from("lead_reminder_log")
        .insert({ lead_id: lead.id, type });
      if (logErr) {
        log.push({ id: lead.id, name: lead.name, type, skipped: "log_insert_error", error: logErr.message });
      } else {
        log.push({ id: lead.id, name: lead.name, type, sent: true, url });
        results[type]++;
        sent++;
      }
    } else {
      log.push({ id: lead.id, name: lead.name, type, skipped: "mega_error", status, error: sendErr });
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

  const nowMs  = Date.now();
  const results = { pre: 0, pos: 0, errors: 0, skipped: 0 };
  const log     = [];

  // Janela PRÉ-AULA: entre 15 e 20 minutos antes do início
  const preMin = new Date(nowMs + 15 * 60 * 1000).toISOString();
  const preMax = new Date(nowMs + 20 * 60 * 1000).toISOString();

  // Janela PÓS-AULA: entre 75 e 80 minutos após o início
  const posMin = new Date(nowMs - 80 * 60 * 1000).toISOString();
  const posMax = new Date(nowMs - 75 * 60 * 1000).toISOString();

  // Busca leads nas janelas — SEM join para evitar falha silenciosa
  const [preResult, posResult] = await Promise.all([
    supabase
      .from("schedule_leads")
      .select("id, name, phone, scheduled_for, schedule_id, webinar_id")
      .gte("scheduled_for", preMin)
      .lte("scheduled_for", preMax)
      .limit(50),
    supabase
      .from("schedule_leads")
      .select("id, name, phone, scheduled_for, schedule_id, webinar_id")
      .gte("scheduled_for", posMin)
      .lte("scheduled_for", posMax)
      .limit(50),
  ]);

  if (preResult.error) log.push({ step: "query_pre", error: preResult.error.message });
  if (posResult.error) log.push({ step: "query_pos", error: posResult.error.message });

  const preLeads = preResult.data || [];
  const posLeads = posResult.data || [];

  // Busca slugs dos webinários envolvidos em uma query separada
  const slugMap = {};
  const webinarIds = [...new Set(
    [...preLeads, ...posLeads].map(l => l.webinar_id).filter(Boolean)
  )];

  if (webinarIds.length) {
    const { data: webinars, error: wErr } = await supabase
      .from("webinars")
      .select("id, slug")
      .in("id", webinarIds);
    if (wErr) log.push({ step: "query_webinars", error: wErr.message });
    for (const w of (webinars || [])) slugMap[w.id] = w.slug;
  }

  // Lembrete pré-aula
  await processLeads({
    supabase, leads: preLeads, type: "pre", slugMap, results, log,
    msgBuilder: (lead, url) =>
      `🌸 Oi, ${lead.name}! Tudo bem?\n\n` +
      `Sua aula do *Projeto Topos Lucrativos* começa em breve! 💖\n\n` +
      `Já pode clicar no link abaixo para entrar na transmissão:\n\n` +
      `👉 ${url}\n\n` +
      `Te esperamos lá! ✨`,
  });

  // Follow-up pós-aula
  await processLeads({
    supabase, leads: posLeads, type: "pos", slugMap, results, log,
    msgBuilder: (lead) =>
      `🌸 Oi, ${lead.name}! Tudo bem?\n\n` +
      `Queria saber se você conseguiu assistir à nossa aula do *Projeto Topos Lucrativos* hoje! 💖\n\n` +
      `Conseguiu assistir certinho? Me conta! 😊`,
  });

  return res.status(200).json({
    ok: true,
    time: new Date().toISOString(),
    window: { preMin, preMax, posMin, posMax },
    found: { pre: preLeads.length, pos: posLeads.length },
    slugMap,
    pre_sent: results.pre,
    pos_sent: results.pos,
    errors: results.errors,
    skipped: results.skipped,
    log,
  });
};
