// Vercel serverless function — disparo automático de WhatsApp via Mega API
// Chamado por cron externo (ex: cron-job.org) a cada minuto
// Env vars obrigatórias: SUPABASE_URL, SUPABASE_SERVICE_KEY, DISPATCH_SECRET

const MEGA_URL  = "https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-M6hpeUt7tF1/text";
const MEGA_TOKEN = "M6hpeUt7tF1";
const BRAZIL_OFFSET_MS = -3 * 60 * 60 * 1000; // UTC-3, sem horário de verão

function brazilNow() {
  return new Date(Date.now() + BRAZIL_OFFSET_MS);
}

async function sbGet(path) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return [];
  return res.json();
}

async function sbPost(path, body) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  return res.ok;
}

module.exports = async function handler(req, res) {
  const { DISPATCH_SECRET } = process.env;

  if (!DISPATCH_SECRET || req.headers["x-dispatch-secret"] !== DISPATCH_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = brazilNow();
  const todayISO  = now.toISOString().slice(0, 10);  // "2026-06-11"
  const nowHHMM   = now.toISOString().slice(11, 16); // "HH:MM" no horário de Brasília

  // Faixa UTC que cobre "hoje" no Brasil (meia-noite BRT = 03:00 UTC)
  const utcDayStart = todayISO + "T03:00:00Z";
  const tomorrowISO = new Date(Date.parse(todayISO + "T12:00:00Z") + 24 * 3600 * 1000)
    .toISOString().slice(0, 10);
  const utcDayEnd = tomorrowISO + "T03:00:00Z";

  const fired = [];

  const dispatches = await sbGet("group_dispatches?active=eq.true&select=*");

  for (const d of dispatches) {
    const config = Array.isArray(d.config) ? d.config : [];

    for (const entry of config) {
      if (!entry.schedule_id || !entry.group_id) continue;

      // Verifica se existe um horário deste webinário ocorrendo hoje (horário BRT)
      const schedules = await sbGet(
        `webinar_schedules?id=eq.${entry.schedule_id}&start_at=gte.${utcDayStart}&start_at=lt.${utcDayEnd}&select=id`
      );
      if (!schedules.length) continue;

      const msgs = Array.isArray(entry.messages) ? entry.messages : [];

      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        if (!msg || msg.time !== nowHHMM) continue;

        // Dedup: verifica se já foi enviado hoje
        const logs = await sbGet(
          `group_dispatch_logs?dispatch_id=eq.${d.id}&schedule_id=eq.${entry.schedule_id}&message_index=eq.${i}&sent_at=gte.${utcDayStart}&sent_at=lt.${utcDayEnd}&select=id&limit=1`
        );
        if (logs.length > 0) continue;

        const groupId = entry.group_id.includes("@")
          ? entry.group_id
          : entry.group_id + "@g.us";

        let status = "sent";
        let errorMessage = null;

        try {
          const megaRes = await fetch(MEGA_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${MEGA_TOKEN}`,
            },
            body: JSON.stringify({ messageData: { to: groupId, text: msg.text } }),
          });
          if (!megaRes.ok) {
            status = "error";
            errorMessage = await megaRes.text();
          }
        } catch (e) {
          status = "error";
          errorMessage = e.message;
        }

        await sbPost("group_dispatch_logs", {
          dispatch_id: d.id,
          schedule_id: entry.schedule_id,
          message_index: i,
          group_id: groupId,
          status,
          error_message: errorMessage,
        });

        fired.push({ dispatch: d.id, group: groupId, idx: i, status });
      }
    }
  }

  return res.status(200).json({
    ok: true,
    time_brazil: nowHHMM,
    today_brazil: todayISO,
    fired: fired.length,
    results: fired,
  });
};
