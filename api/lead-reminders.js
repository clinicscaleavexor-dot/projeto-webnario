const MEGA_URL       = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-MJjV24kQIXz/text";
const MEGA_MEDIA_URL = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-MJjV24kQIXz/mediaUrl";
const MEGA_TOKEN     = "MJjV24kQIXz";
const BATCH_SIZE = 5;   // por execução (cron a cada 1 min → ~50 msgs em 10 min)
const DELAY_MS   = 3000; // 3s entre cada mensagem para não disparar tudo de uma vez

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

async function sbQuery(table, qs) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}?${qs}`;
  const res = await fetch(url, { headers: sbHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`${table}: ${res.status} ${text}`);
  return JSON.parse(text);
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

async function sendWhatsApp(phone, text, baseUrl, token) {
  const digits = phone.replace(/\D/g, "");
  const to  = (digits.startsWith("55") ? digits : "55" + digits) + "@c.us";
  const url = (baseUrl || MEGA_URL.replace(/\/text$/, "")) + "/text";
  const tok = token || MEGA_TOKEN;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ messageData: { to, text } }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendWhatsAppAudio(phone, audioUrl, baseUrl, token) {
  const digits = phone.replace(/\D/g, "");
  const to  = (digits.startsWith("55") ? digits : "55" + digits) + "@c.us";
  const url = (baseUrl || MEGA_MEDIA_URL.replace(/\/mediaUrl$/, "")) + "/mediaUrl";
  const tok = token || MEGA_TOKEN;
  const ext = audioUrl.split(".").pop().split("?")[0].toLowerCase();
  const mimeType = ext === "ogg" ? "audio/ogg; codecs=opus"
    : ext === "mp3" ? "audio/mpeg"
    : ext === "wav" ? "audio/wav"
    : "audio/mp4";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ messageData: { to, url: audioUrl, fileName: `audio.${ext}`, type: "ptt", mimeType, caption: "" } }),
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

  // Verifica configurações de disparo (respeita pausas, modo e pool de mensagens)
  let autoPreEnabled    = true;
  let autoPosEnabled    = true;
  let dispatchMode      = "text_all";
  let followupAudioUrl  = "";
  let messagePool       = [];
  let preWinStart       = 30;
  let preWinEnd         = 10;
  let posWinStart       = 60;
  let posWinEnd         = 90;
  let webhookEnabled    = false;
  let webhookUrl        = "";

  let settings = [];
  try {
    settings = await sbRpc("get_dispatch_settings", {});
    for (const s of settings) {
      if (s.key === "auto_pre_enabled")           autoPreEnabled = s.value !== "false";
      if (s.key === "auto_pos_enabled")           autoPosEnabled = s.value !== "false";
      if (s.key === "dispatch_mode")              dispatchMode   = s.value;
      if (s.key === "followup_audio_url")         followupAudioUrl = s.value;
      if (s.key === "lead_window_start_minutes")  preWinStart    = +s.value || preWinStart;
      if (s.key === "lead_window_end_minutes")    preWinEnd      = +s.value || preWinEnd;
      if (s.key === "pos_window_start_minutes")   posWinStart    = +s.value || posWinStart;
      if (s.key === "pos_window_end_minutes")     posWinEnd      = +s.value || posWinEnd;
      if (s.key === "webhook_enabled")            webhookEnabled = s.value === "true";
      if (s.key === "webhook_url")                webhookUrl     = s.value || "";
      if (s.key === "message_pool") {
        try { messagePool = JSON.parse(s.value).filter(t => t && t.trim()); } catch {}
      }
    }
  } catch {}

  if (!autoPreEnabled && !autoPosEnabled) {
    return res.status(200).json({ ok: true, paused: "all", time: new Date().toISOString() });
  }

  const nowMs  = Date.now();
  const preMin = new Date(nowMs + preWinEnd   * 60 * 1000).toISOString();
  const preMax = new Date(nowMs + preWinStart * 60 * 1000).toISOString();
  const posMin = new Date(nowMs - posWinEnd   * 60 * 1000).toISOString();
  const posMax = new Date(nowMs - posWinStart * 60 * 1000).toISOString();

  // Busca leads pendentes pelos dois modos em paralelo
  // get_pending_webhooks: timing fixo por schedule_type (para webinários em modo webhook)
  // get_pending_reminders: janelas configuráveis (para webinários em modo whatsapp)
  let whatsappLeads = [];
  let webhookLeads  = [];
  try {
    [whatsappLeads, webhookLeads] = await Promise.all([
      sbRpc("get_pending_reminders", { p_pre_min: preMin, p_pre_max: preMax, p_pos_min: posMin, p_pos_max: posMax }),
      sbRpc("get_pending_webhooks", {}).catch(() => []),
    ]);
  } catch (e) {
    return res.status(200).json({ ok: false, rpc_error: e.message, window: { preMin, preMax, posMin, posMax } });
  }

  // Une todos os leads para carregar configs de webinário de uma vez
  const leads = [...whatsappLeads, ...webhookLeads];

  // Busca mensagens e owner por webinário
  const webinarIds = [...new Set(leads.map(l => l.webinar_id).filter(Boolean))];
  const webinarPreMessages = {};
  const webinarPosMessages = {};
  const webinarOwner      = {};
  const webinarMode       = {}; // webinar_id -> 'whatsapp' | 'webhook'
  const webinarWebhookUrl = {}; // webinar_id -> url
  if (webinarIds.length) {
    try {
      const [msgRows, webRows] = await Promise.all([
        sbQuery(
          "webinar_dispatch_messages",
          `webinar_id=in.(${webinarIds.join(",")})&active=eq.true&order=sort_order.asc,created_at.asc`
        ),
        sbQuery("webinars", `id=in.(${webinarIds.join(",")})&select=id,owner_id,settings`),
      ]);
      for (const r of msgRows) {
        if (r.dispatch_type === "pos") {
          if (!webinarPosMessages[r.webinar_id]) webinarPosMessages[r.webinar_id] = [];
          webinarPosMessages[r.webinar_id].push(r);
        } else {
          if (!webinarPreMessages[r.webinar_id]) webinarPreMessages[r.webinar_id] = [];
          webinarPreMessages[r.webinar_id].push(r);
        }
      }
      for (const w of webRows) {
        webinarOwner[w.id] = w.owner_id;
        webinarMode[w.id]       = w.settings?.dispatch_config?.mode || "whatsapp";
        webinarWebhookUrl[w.id] = w.settings?.dispatch_config?.webhook_url || "";
      }
    } catch {}
  }

  // Busca instâncias WhatsApp por dono do webinário
  const ownerIds = [...new Set(Object.values(webinarOwner).filter(Boolean))];
  const ownerInstances = {}; // owner_id -> [{api_url, api_token}]
  if (ownerIds.length) {
    try {
      const instRows = await sbQuery(
        "dispatch_numbers",
        `owner_id=in.(${ownerIds.join(",")})&active=eq.true&order=sort_order.asc`
      );
      for (const inst of instRows) {
        if (!ownerInstances[inst.owner_id]) ownerInstances[inst.owner_id] = [];
        ownerInstances[inst.owner_id].push(inst);
      }
    } catch {}
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

    // Envia após garantir o claim no banco

    const watchUrl = buildWatchUrl(lead.webinar_slug, lead);
    const mode     = webinarMode[lead.webinar_id] || "whatsapp";

    // ── MODO WEBHOOK ────────────────────────────────────────────────────
    if (mode === "webhook") {
      // Leads do get_pending_reminders com modo webhook: verifica se vieram do RPC correto
      // Os leads de whatsappLeads com modo webhook são ignorados (timing errado);
      // apenas webhookLeads (get_pending_webhooks) têm timing correto para webhook.
      const isFromWebhookRpc = webhookLeads.some(wl => wl.id === lead.id && wl.reminder_type === type);
      if (!isFromWebhookRpc) {
        results.log.push({ name: lead.name, type, skip: "webhook_wrong_rpc" });
        continue;
      }
      const wUrl = webinarWebhookUrl[lead.webinar_id];
      if (!wUrl) {
        results.errors++;
        results.log.push({ name: lead.name, type, skip: "webhook_url_missing" });
        continue;
      }
      const digits = (lead.phone || "").replace(/\D/g, "");
      const payload = {
        nome:     lead.name,
        telefone: digits.startsWith("55") ? digits : "55" + digits,
        link:     watchUrl,
        tipo:     type === "pre" ? "lembrete" : "follow-up",
      };
      try {
        const wRes = await fetch(wUrl, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        });
        if (wRes.ok) {
          results[type]++; sent++;
          results.log.push({ name: lead.name, type, sent: true, mode: "webhook" });
        } else {
          const body = await wRes.text().catch(() => "");
          results.errors++;
          results.log.push({ name: lead.name, type, skip: "webhook_http_error", status: wRes.status, body: body.slice(0, 200) });
        }
      } catch (e) {
        results.errors++;
        results.log.push({ name: lead.name, type, skip: "webhook_network_error", error: e.message });
      }
      await sleep(DELAY_MS);
      continue;
    }

    // ── MODO WHATSAPP ────────────────────────────────────────────────────
    // Leads do get_pending_webhooks com modo whatsapp: ignora (timing incorreto para WA)
    const isFromWebhookRpc = webhookLeads.some(wl => wl.id === lead.id && wl.reminder_type === type);
    if (isFromWebhookRpc) {
      results.log.push({ name: lead.name, type, skip: "whatsapp_wrong_rpc" });
      continue;
    }

    const rotIdx = Number(lead.rotation_index) || 0;
    const wMsgs  = type === "pre"
      ? (webinarPreMessages[lead.webinar_id] || [])
      : (webinarPosMessages[lead.webinar_id] || []);

    let useAudio = false;
    let audioUrl = "";
    let text = "";

    if (wMsgs.length > 0) {
      const msg = wMsgs[rotIdx % wMsgs.length];
      if (msg.type === "audio") {
        useAudio = true; audioUrl = msg.content;
      } else {
        text = msg.content
          .replace(/\{nome\}/gi, lead.name)
          .replace(/\{link\}/gi, watchUrl);
      }
    } else if (type === "pre" && messagePool.length > 0) {
      const template = messagePool[rotIdx % messagePool.length];
      text = template.replace(/\{nome\}/gi, lead.name).replace(/\{link\}/gi, watchUrl);
    } else if (type === "pre") {
      text = `🌸 Oi, ${lead.name}! Tudo bem?\n\nSua aula começa em breve! 💖\n\nJá pode clicar no link abaixo para entrar na transmissão:\n\n👉 ${watchUrl}\n\nTe esperamos lá! ✨`;
    } else {
      if (dispatchMode === "text_pre_audio_pos" && followupAudioUrl) {
        useAudio = true; audioUrl = followupAudioUrl;
      } else {
        text = `🌸 Oi, ${lead.name}! Tudo bem?\n\nQueria saber se você conseguiu assistir à nossa aula hoje! 💖\n\nConseguiu assistir certinho? Me conta! 😊`;
      }
    }

    const ownerId   = webinarOwner[lead.webinar_id];
    const instances = ownerId ? (ownerInstances[ownerId] || []) : [];
    const inst      = instances.length ? instances[rotIdx % instances.length] : null;
    const instBase  = inst ? inst.api_url.replace(/\/$/, "") : null;
    const instToken = inst ? inst.api_token : null;

    const { ok, status, error: sendErr } = useAudio
      ? await sendWhatsAppAudio(lead.phone, audioUrl, instBase, instToken)
      : await sendWhatsApp(lead.phone, text, instBase, instToken);

    if (ok) {
      results[type]++; sent++;
      results.log.push({ name: lead.name, type, sent: true, mode: "whatsapp" });
    } else {
      results.errors++;
      results.log.push({ name: lead.name, type, skip: "mega_error", status, error: sendErr });
    }

    await sleep(DELAY_MS);
  }

  // ── Mensagens agendadas ──────────────────────────────────────────
  let schedSent = 0;
  try {
    const pendingMsgs = await sbRpc("get_pending_scheduled_messages", {});
    for (const msg of pendingMsgs) {
      if (sent + schedSent >= BATCH_SIZE) break;

      let claimed = false;
      try { claimed = await sbRpc("claim_scheduled_message", { p_id: msg.id }); } catch {}
      if (!claimed) continue;

      const { ok, status: httpStatus, error: sendErr } = await sendWhatsApp(msg.phone, msg.message);
      if (ok) {
        schedSent++;
        results.log.push({ name: msg.name || msg.phone, type: "scheduled", sent: true });
      } else {
        results.errors++;
        results.log.push({ name: msg.name || msg.phone, type: "scheduled", skip: "mega_error", error: sendErr });
        try { await sbRpc("fail_scheduled_message", { p_id: msg.id, p_error: sendErr || `HTTP ${httpStatus}` }); } catch {}
      }
      await sleep(DELAY_MS);
    }
  } catch {}

  return res.status(200).json({
    ok: true,
    time: new Date().toISOString(),
    window: { preMin, preMax, posMin, posMax },
    found: leads.length,
    pre_sent: results.pre,
    pos_sent: results.pos,
    scheduled_sent: schedSent,
    errors: results.errors,
    log: results.log,
  });
};

// =====================================================================
//  WEBHOOK MODE
//  Timing fixo por schedule_type, sem Mega API.
//  Payload: { nome, telefone, link, tipo: "lembrete"|"follow-up" }
// =====================================================================
async function handleWebhookDispatches(req, res, webhookUrl) {
  let leads = [];
  try {
    leads = await sbRpc("get_pending_webhooks", {});
  } catch (e) {
    return res.status(200).json({ ok: false, mode: "webhook", rpc_error: e.message });
  }

  const results = { pre: 0, pos: 0, errors: 0, log: [] };
  let sent = 0;

  for (const lead of leads) {
    if (sent >= BATCH_SIZE) break;

    const type = lead.reminder_type; // 'pre' | 'pos'

    let claimed = false;
    try {
      claimed = await sbRpc("claim_reminder", { p_lead_id: lead.id, p_type: type });
    } catch (e) {
      results.errors++;
      results.log.push({ name: lead.name, type, skip: "claim_error", error: e.message });
      continue;
    }
    if (!claimed) {
      results.log.push({ name: lead.name, type, skip: "ja_enviado" });
      continue;
    }

    const watchUrl = buildWatchUrl(lead.webinar_slug, lead);
    const digits   = (lead.phone || "").replace(/\D/g, "");
    const telefone = digits.startsWith("55") ? digits : "55" + digits;

    const payload = {
      nome:     lead.name,
      telefone,
      link:     watchUrl,
      tipo:     type === "pre" ? "lembrete" : "follow-up",
    };

    try {
      const wRes = await fetch(webhookUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      if (wRes.ok) {
        results[type]++;
        sent++;
        results.log.push({ name: lead.name, type, sent: true, webhook: webhookUrl });
      } else {
        const body = await wRes.text().catch(() => "");
        results.errors++;
        results.log.push({ name: lead.name, type, skip: "webhook_error", status: wRes.status, body: body.slice(0, 200) });
      }
    } catch (e) {
      results.errors++;
      results.log.push({ name: lead.name, type, skip: "webhook_network_error", error: e.message });
    }

    await sleep(DELAY_MS);
  }

  return res.status(200).json({
    ok:      true,
    mode:    "webhook",
    time:    new Date().toISOString(),
    found:   leads.length,
    pre_sent:  results.pre,
    pos_sent:  results.pos,
    errors:    results.errors,
    log:       results.log,
  });
}
