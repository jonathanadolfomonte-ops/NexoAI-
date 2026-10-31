import fs from "node:fs";
import path from "node:path";

// Agenda personal de Lindsy: anotar, listar y borrar. Se guarda en un archivo JSON.
// OJO: en Render gratis el disco se borra al reiniciar; con base de datos/disco persistente queda fija.
const DIR = process.env.AGENDA_DIR || path.join(process.cwd(), "datos");
const ARCHIVO = path.join(DIR, "agenda.json");
const DESFASE = -3 * 3600 * 1000; // Argentina, UTC-3 sin horario de verano
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function leer() {
  try {
    const d = JSON.parse(fs.readFileSync(ARCHIVO, "utf8"));
    return { siguiente: Number(d.siguiente) || 1, items: Array.isArray(d.items) ? d.items : [] };
  } catch {
    return { siguiente: 1, items: [] };
  }
}
function guardar(d) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = ARCHIVO + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, ARCHIVO);
}

const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const dos = (n) => String(n).padStart(2, "0");
function local(ms) { const d = new Date(ms + DESFASE); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay() }; }
function iso(y, m, d) { return `${y}-${dos(m)}-${dos(d)}`; }
function sumarDias(fechaIso, n) {
  const [y, m, d] = fechaIso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function hoyIso(ahora) { const l = local(ahora); return iso(l.y, l.m, l.d); }

// Saca fecha y hora del texto y devuelve lo que sobra como título.
export function extraerFechaHora(texto, ahora = Date.now()) {
  let t = " " + texto + " ";
  let fecha = null, hora = null;
  const hoy = hoyIso(ahora);
  const dowHoy = local(ahora).dow;
  const quita = (re) => { t = t.replace(re, " "); };
  const sin = (s) => sinTildes(s.toLowerCase());
  const base = sin(t);
  // t y base tienen el mismo largo: se busca en base y se recorta en t
  const buscar = (re) => { const m = re.exec(base); return m; };
  const cortar = (m) => { t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length); };

  let m;
  if ((m = buscar(/\bpasado manana\b/))) { fecha = sumarDias(hoy, 2); }
  else if ((m = buscar(/\bmanana\b/))) {
    // "de la mañana" (hora) no es el día de mañana
    const antes = base.slice(Math.max(0, m.index - 8), m.index);
    if (!/de la\s*$/.test(antes)) fecha = sumarDias(hoy, 1); else m = null;
  }
  else if ((m = buscar(/\bhoy\b/))) { fecha = hoy; }
  else if ((m = buscar(/\b(?:el\s+)?(?:proximo\s+)?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/))) {
    const idx = ["domingo","lunes","martes","miercoles","jueves","viernes","sabado"].indexOf(m[1]);
    let dif = (idx - dowHoy + 7) % 7; if (dif === 0) dif = 7;
    fecha = sumarDias(hoy, dif);
  }
  else if ((m = buscar(/\b(?:el\s+)?(\d{1,2})\s*[\/-]\s*(\d{1,2})(?:\s*[\/-]\s*\d{2,4})?\b/)) && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
    const l = local(ahora); let y = l.y;
    let f = iso(y, +m[2], +m[1]); if (f < hoy) f = iso(y + 1, +m[2], +m[1]);
    fecha = f;
  } else m = null;
  if (m && fecha) cortar(m);
  const base2 = () => sin(t);
  let h = null;
  const b = base2();
  let mh;
  if ((mh = /\b(?:a\s+las?\s+)?(\d{1,2})\s*(?::|h|\.)\s*(\d{2})\s*(?:hs|horas)?\b/.exec(b))) h = { hh: +mh[1], mm: +mh[2], mh };
  else if ((mh = /\ba\s+las?\s+(\d{1,2})\b(?:\s*(?:hs|horas))?/.exec(b))) h = { hh: +mh[1], mm: 0, mh };
  if (h && h.hh <= 24 && h.mm < 60) {
    const resto = b.slice(h.mh.index + h.mh[0].length);
    let hh = h.hh;
    let ex = /^\s*de la\s+(tarde|noche|manana)\b/.exec(resto);
    let largo = h.mh[0].length;
    if (ex) {
      if ((ex[1] === "tarde" || ex[1] === "noche") && hh < 12) hh += 12;
      largo += ex[0].length;
    }
    if (hh === 24) hh = 0;
    hora = `${dos(hh)}:${dos(h.mm)}`;
    t = t.slice(0, h.mh.index) + " " + t.slice(h.mh.index + largo);
  }
  const titulo = t.replace(/\s+/g, " ").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "").replace(/^(que|de|para|el|la)\s+/i, "").trim();
  return { fecha, hora, titulo };
}

export function nombreDia(fechaIso, ahora = Date.now()) {
  const hoy = hoyIso(ahora);
  if (fechaIso === hoy) return "hoy";
  if (fechaIso === sumarDias(hoy, 1)) return "mañana";
  const [y, m, d] = fechaIso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIAS[dow]} ${d}/${m}`;
}

function linea(it, ahora) {
  const cuando = it.fecha ? ` — ${nombreDia(it.fecha, ahora)}${it.hora ? " " + it.hora : ""}` : it.hora ? ` — ${it.hora}` : "";
  return `*${it.id}.* ${it.texto}${cuando}`;
}
const orden = (a, b) => (a.fecha || "9999").localeCompare(b.fecha || "9999") || (a.hora || "99:99").localeCompare(b.hora || "99:99") || a.id - b.id;

// Devuelve el texto de respuesta, o null si el mensaje no es de la agenda.
export function manejarAgenda(texto, ahora = Date.now()) {
  const limpio = String(texto || "").trim();
  const b = sinTildes(limpio.toLowerCase());

  let m = /^\s*(anota|anotame|agenda|agendame|agrega|agregame|apunta|apuntame|recordame|recorda|acordate)\b[\s:,]*(.*)$/s.exec(b);
  const extra = m ? extraerFechaHora(limpio.slice(limpio.length - m[2].length), ahora) : null;
  // «agenda» sola (o «agenda mañana») es pedir la agenda, no anotar
  if (m && m[1] === "agenda" && !extra.titulo) m = null;
  if (m) {
    const { fecha, hora, titulo } = extra;
    if (!titulo) return "¿Qué querés que anote? Por ejemplo: «anotá dentista mañana a las 15».";
    const d = leer();
    const it = { id: d.siguiente++, texto: titulo.slice(0, 300), fecha, hora, creado: new Date(ahora).toISOString() };
    d.items.push(it);
    try { guardar(d); } catch (e) { console.error("Error guardando agenda:", e.message); return "No pude guardar eso en la agenda. Probá de nuevo en un rato."; }
    return `Anotado ✅\n${linea(it, ahora)}` + (it.hora ? "\n(Todavía no te aviso solo: preguntame «qué tengo hoy».)" : "");
  }

  m = /^\s*(?:borra|borrame|elimina|quita|tacha|completa|listo|hecho)\s+(?:el\s+|la\s+)?(?:numero\s+|n°\s*|#)?(\d+)\s*$/.exec(b);
  if (m) {
    const d = leer();
    const i = d.items.findIndex((x) => x.id === Number(m[1]));
    if (i < 0) return `No encuentro el pendiente número ${m[1]}. Pedime la agenda para ver los números.`;
    const [it] = d.items.splice(i, 1);
    try { guardar(d); } catch (e) { console.error("Error guardando agenda:", e.message); return "No pude borrarlo ahora. Probá de nuevo en un rato."; }
    return `Listo, saqué: ${it.texto}`;
  }

  if (/^\s*(?:que tengo|que hay|mi agenda|la agenda|agenda|mis pendientes|pendientes|mis tareas|mis citas|ver agenda|mostrame (?:la |mi )?agenda)\b/.test(b) || /\bque tengo (?:hoy|manana|pendiente)/.test(b)) {
    const hoy = hoyIso(ahora);
    const d = leer();
    let items = d.items.slice().sort(orden);
    let titulo = "Tu agenda";
    if (/\bhoy\b/.test(b)) { items = items.filter((x) => x.fecha === hoy); titulo = "Hoy"; }
    else if (/\bmanana\b/.test(b)) { const mn = sumarDias(hoy, 1); items = items.filter((x) => x.fecha === mn); titulo = "Mañana"; }
    if (!items.length) return titulo === "Tu agenda" ? "No tenés nada anotado. Decime «anotá …» y lo agrego." : `No tenés nada anotado para ${titulo.toLowerCase()}. 🎉`;
    return `📅 *${titulo}*\n` + items.map((x) => linea(x, ahora)).join("\n") + "\n\nPara sacar uno: «borrá 2».";
  }
  return null;
}
