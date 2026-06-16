// Disparo automático de lembretes pré-aula e follow-up pós-aula via Mega API.
// Chamado pelo pg_cron do Supabase a cada minuto.
// Usa fetch puro (igual ao dispatch.js) para evitar problemas de URL com o SDK.

const MEGA_URL   = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-M6hpeUt7tF1/text";
const MEGA_TOKEN = "M6hpeUt7tF1";
const BATCH_SIZE = 8;
const DELAY_MS   = 700;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- Supabase REST helpers (mesmo padrão do dispatch.js) ----------

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function sbGet(path) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPost(path, body) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

// ---------- Mega API ----------

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

// ---------- URL da aula ----------

function buildWatchUrl(slug, lead) {
  const base = (process.env.SITE_URL || "").replace(/\/$/, "");
  const param = lead.schedule_id
    ? `s=${encodeURIComponent(lead.schedule_id)}`
    : `start=${new Date(lead.scheduled_for).getTime()}`;
  return `${base}/watch.html?w=${encodeURIComponent(slug)}&${param}`;
}

// ---------- Processamento ----------

async function processLeads({ leads, type, slugMap, msgBuilder, results, log }) {
  let sent = 0;

  for (const lead of leads) {
    if (sent >= BATCH_SIZE) break;

    const slug = slugMap[lead.webinar_id];
    if (!slug) {
      log.push({ name: lead.name, type, skip: "sem_slug" });
      results.skipped++;
      continue;
    }

    // Deduplicação
    let already = false;
    try {
      const rows = await sbGet(
        `lead_reminder_log?lead_id=eq.${lead.id}&type=eq.${type}&limit=1`
      );
      already = rows.length > 0;
    } catch (e) {
      log.push({ name: lead.name, type, skip: "dup_error", error: e.message });
      results.errors++;
      continue;
    }
    if (already) {
      log.push({ name: lead.name, type, skip: "ja_enviado" });
      continue;
    }

    const url  = buildWatchUrl(slug, lead);
    const text = msgBuilder(lead, url);
    const { ok, status, error: sendErr } = await sendWhatsApp(lead.phone, text);

    if (ok) {
      const logged = await sbPost("lead_reminder_log", { lead_id: lead.id, type });
      if (logged) {
        log.push({ name: lead.name, type, sent: true });
        results[type]++;
        sent++;
      } else {
        log.push({ name: lead.name, type, skip: "log_insert_falhou" });
        results.errors++;
      }
    } else {
      log.push({ name: lead.name, type, skip: "mega_error", status, error: sendErr });
      results.errors++;
    }

    await sleep(DELAY_MS);
  }
}

// ---------- Auth ----------

function isAuthorized(req) {
  const { DISPATCH_SECRET, CRON_SECRET } = process.env;
  if (CRON_SECRET && req.headers["authorization"] === `Bearer ${CRON_SECRET}`) return true;
  if (DISPATCH_SECRET && req.headers["x-dispatch-secret"] === DISPATCH_SECRET) return true;
  return false;
}

// ---------- Handler ----------

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const nowMs  = Date.now();
  const results = { pre: 0, pos: 0, errors: 0, skipped: 0 };
  const log     = [];

  const preMin = new Date(nowMs + 15 * 60 * 1000).toISOString();
  const preMax = new Date(nowMs + 20 * 60 * 1000).toISOString();
  const posMin = new Date(nowMs - 80 * 60 * 1000).toISOString();
  const posMax = new Date(nowMs - 75 * 60 * 1000).toISOString();

  // Busca leads nas janelas
  let preLeads = [], posLeads = [];
  try {
    preLeads = await sbGet(
      `schedule_leads?select=id,name,phone,scheduled_for,schedule_id,webinar_id` +
      `&scheduled_for=gte.${encodeURIComponent(preMin)}` +
      `&scheduled_for=lte.${encodeURIComponent(preMax)}` +
      `&limit=50`
    );
  } catch (e) {
    log.push({ step: "query_pre", error: e.message });
  }

  try {
    posLeads = await sbGet(
      `schedule_leads?select=id,name,phone,scheduled_for,schedule_id,webinar_id` +
      `&scheduled_for=gte.${encodeURIComponent(posMin)}` +
      `&scheduled_for=lte.${encodeURIComponent(posMax)}` +
      `&limit=50`
    );
  } catch (e) {
    log.push({ step: "query_pos", error: e.message });
  }

  // Busca slugs dos webinários envolvidos
  const slugMap = {};
  const webinarIds = [...new Set(
    [...preLeads, ...posLeads].map(l => l.webinar_id).filter(Boolean)
  )];
  if (webinarIds.length) {
    try {
      const webinars = await sbGet(
        `webinars?select=id,slug&id=in.(${webinarIds.join(",")})`
      );
      for (const w of webinars) slugMap[w.id] = w.slug;
    } catch (e) {
      log.push({ step: "query_webinars", error: e.message });
    }
  }

  // Lembrete pré-aula
  await processLeads({
    leads: preLeads, type: "pre", slugMap, results, log,
    msgBuilder: (lead, url) =>
      `🌸 Oi, ${lead.name}! Tudo bem?\n\n` +
      `Sua aula do *Projeto Topos Lucrativos* começa em breve! 💖\n\n` +
      `Já pode clicar no link abaixo para entrar na transmissão:\n\n` +
      `👉 ${url}\n\n` +
      `Te esperamos lá! ✨`,
  });

  // Follow-up pós-aula
  await processLeads({
    leads: posLeads, type: "pos", slugMap, results, log,
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
