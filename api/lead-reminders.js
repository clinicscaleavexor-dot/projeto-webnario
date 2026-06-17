const MEGA_URL   = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-M6hpeUt7tF1/text";
const MEGA_TOKEN = "M6hpeUt7tF1";
const BATCH_SIZE = 8;
const DELAY_MS   = 700;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function sbRpc(fn, params) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RPC ${fn}: ${res.status} ${text}`);
  return JSON.parse(text);
}

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
    return { ok: false, error: e.message };
  }
}

function isAuthorized(req) {
  const { DISPATCH_SECRET, CRON_SECRET } = process.env;
  if (CRON_SECRET && req.headers["authorization"] === `Bearer ${CRON_SECRET}`) return true;
  if (DISPATCH_SECRET && req.headers["x-dispatch-secret"] === DISPATCH_SECRET) return true;
  return false;
}

module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: "unauthorized" });

  // Verifica configurações de disparo (respeita pausas do painel admin)
  let autoPreEnabled = true;
  let autoPosEnabled = true;
  try {
    const settings = await sbRpc("get_dispatch_settings", {});
    for (const s of settings) {
      if (s.key === "auto_pre_enabled") autoPreEnabled = s.value !== "false";
      if (s.key === "auto_pos_enabled") autoPosEnabled = s.value !== "false";
    }
  } catch {} // Se falhar, mantém padrão (ativado)

  if (!autoPreEnabled && !autoPosEnabled) {
    return res.status(200).json({ ok: true, paused: "all", time: new Date().toISOString() });
  }

  const nowMs  = Date.now();
  const preMin = new Date(nowMs + 15 * 60 * 1000).toISOString();
  const preMax = new Date(nowMs + 20 * 60 * 1000).toISOString();
  const posMin = new Date(nowMs - 80 * 60 * 1000).toISOString();
  const posMax = new Date(nowMs - 75 * 60 * 1000).toISOString();

  // Busca leads pendentes via RPC (filtra já enviados com NOT EXISTS)
  let leads = [];
  try {
    leads = await sbRpc("get_pending_reminders", {
      p_pre_min: preMin, p_pre_max: preMax,
      p_pos_min: posMin, p_pos_max: posMax,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, rpc_error: e.message, window: { preMin, preMax, posMin, posMax } });
  }

  const results = { pre: 0, pos: 0, errors: 0, log: [] };
  let sent = 0;

  for (const lead of leads) {
    if (sent >= BATCH_SIZE) break;

    const type = lead.reminder_type;

    // Pula se o tipo estiver desativado nas configurações do painel
    if (type === "pre" && !autoPreEnabled) {
      results.log.push({ name: lead.name, type, skip: "pre_disabled" });
      continue;
    }
    if (type === "pos" && !autoPosEnabled) {
      results.log.push({ name: lead.name, type, skip: "pos_disabled" });
      continue;
    }

    // Grava o log ANTES de enviar (atômico via ON CONFLICT DO NOTHING).
    // Se retornar false, outra invocação já enviou — pula.
    let claimed = false;
    try {
      claimed = await sbRpc("claim_reminder", { p_lead_id: lead.id, p_type: type });
    } catch (e) {
      results.log.push({ name: lead.name, type, skip: "claim_error", error: e.message });
      results.errors++;
      continue;
    }

    if (!claimed) {
      results.log.push({ name: lead.name, type, skip: "ja_enviado" });
      continue;
    }

    // Envia WhatsApp somente após garantir o claim no banco
    const url  = buildWatchUrl(lead.webinar_slug, lead);
    const text = type === "pre"
      ? `🌸 Oi, ${lead.name}! Tudo bem?\n\nSua aula do *Projeto Topos Lucrativos* começa em breve! 💖\n\nJá pode clicar no link abaixo para entrar na transmissão:\n\n👉 ${url}\n\nTe esperamos lá! ✨`
      : `🌸 Oi, ${lead.name}! Tudo bem?\n\nQueria saber se você conseguiu assistir à nossa aula do *Projeto Topos Lucrativos* hoje! 💖\n\nConseguiu assistir certinho? Me conta! 😊`;

    const { ok, status, error: sendErr } = await sendWhatsApp(lead.phone, text);

    if (ok) {
      results[type]++;
      sent++;
      results.log.push({ name: lead.name, type, sent: true });
    } else {
      results.errors++;
      results.log.push({ name: lead.name, type, skip: "mega_error", status, error: sendErr });
    }

    await sleep(DELAY_MS);
  }

  return res.status(200).json({
    ok: true,
    time: new Date().toISOString(),
    window: { preMin, preMax, posMin, posMax },
    found: leads.length,
    pre_sent: results.pre,
    pos_sent: results.pos,
    errors: results.errors,
    log: results.log,
  });
};
