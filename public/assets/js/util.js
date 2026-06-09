// Utilitários compartilhados.

// Converte segundos -> "MM:SS" ou "HH:MM:SS".
export function fmtClock(totalSeconds) {
  totalSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// "MM:SS" ou "HH:MM:SS" ou número -> segundos.
export function parseClock(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Math.max(0, Math.floor(value));
  const parts = String(value).trim().split(":").map((p) => parseInt(p, 10) || 0);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// Slug a partir de um título (+ sufixo aleatório para garantir unicidade).
export function makeSlug(title) {
  const base = (title || "webinario")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "webinario";
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${rand}`;
}

// Escapa HTML (para inserir texto do usuário com segurança).
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Converte um <input type="datetime-local"> (horário local) -> ISO UTC.
export function localInputToISO(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

// Converte ISO -> valor para <input type="datetime-local"> (horário local).
export function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

// Toast simples.
export function toast(msg, type = "info") {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.classList.add("toast--show"), 10);
  setTimeout(() => {
    el.classList.remove("toast--show");
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// Avatar colorido a partir do nome (data-URI SVG).
export function avatarFor(name) {
  const colors = ["#7c5cff", "#ff5c8a", "#2bb673", "#f5a623", "#3aa0ff", "#ff7a45", "#9b59b6"];
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  let hash = 0;
  for (const ch of name || "?") hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = colors[hash % colors.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='32' fill='${bg}'/><text x='50%' y='50%' dy='.35em' text-anchor='middle' font-family='Arial' font-size='30' fill='white'>${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
