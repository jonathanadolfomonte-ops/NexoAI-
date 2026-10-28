import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const {
  PORT = 3000,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_VERIFY_TOKEN,
  META_APP_SECRET,
  ANTHROPIC_API_KEY,
  GROQ_API_KEY,
  GROQ_MODEL = "openai/gpt-oss-20b",
  PERSONAL_WHATSAPP_NUMBER,
  // ID de teléfono de Meta para el número personal habilitado mediante coexistencia.
  PERSONAL_WHATSAPP_PHONE_NUMBER_ID,
  PERSONAL_ASSISTANT_ONLY = "false",
  CLAUDE_MODEL = "claude-sonnet-5-5",
  WHATSAPP_API_VERSION = "v21.0",
  // Numero del dueño que recibe el aviso de cada pedido confirmado (formato 549 + area + numero, sin + ni 15)
  OWNER_WHATSAPP_NUMBER,
  // Horas que el bot se queda callado con un cliente cuando el dueño le responde desde la app (coexistencia)
  PAUSA_HORAS = "8",
  // Planilla de Google donde se registran las conversaciones (Apps Script). Opcional.
  WEBHOOK_PLANILLA_URL,
  PLANILLA_CLAVE,
} = process.env;

const modoSoloPersonal = PERSONAL_ASSISTANT_ONLY === "true";
const requeridas = modoSoloPersonal
  ? ["WHATSAPP_TOKEN", "WHATSAPP_VERIFY_TOKEN", "META_APP_SECRET", "GROQ_API_KEY", "PERSONAL_WHATSAPP_PHONE_NUMBER_ID"]
  : ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "META_APP_SECRET", "ANTHROPIC_API_KEY"];
const faltan = requeridas.filter((k) => !process.env[k]);
if (faltan.length) {
  console.error("Faltan variables de entorno:", faltan.join(", "));
  process.exit(1);
}

const ID_TELEFONO_PREDETERMINADO = modoSoloPersonal
  ? PERSONAL_WHATSAPP_PHONE_NUMBER_ID
  : WHATSAPP_PHONE_NUMBER_ID;
const instrucciones = modoSoloPersonal
  ? ""
  : fs.readFileSync(new URL("./instrucciones-negocio.md", import.meta.url), "utf-8");
const claude = modoSoloPersonal ? null : new Anthropic({ apiKey: ANTHROPIC_API_KEY });
// Groq queda opcional y solo se usa para mensajes del número personal autorizado.
const groq = GROQ_API_KEY
  ? new OpenAI({ apiKey: GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" })
  : null;
const numeroPersonal = String(PERSONAL_WHATSAPP_NUMBER || "").replace(/\D/g, "");

// Plantilla de conversación de Lindsy (editable en instrucciones-lindsy.md)
const SALUDO_LINDSY = "¡Hola! Soy Lindsy, el asistente personal de Jonathan. 😊 ¿En qué puedo ayudarte hoy?";
function leerArchivoLindsy(nombre) {
  try {
    return fs.readFileSync(new URL(`./${nombre}`, import.meta.url), "utf-8");
  } catch {
    return "";
  }
}
// Instrucciones de Lindsy: guía de personalidad + reglas adicionales (archivos editables)
let instruccionesLindsy = [leerArchivoLindsy("guia-personalidad-lindsy.md"), leerArchivoLindsy("instrucciones-lindsy.md")]
  .filter(Boolean)
  .join("\n\n---\n\n");
if (!instruccionesLindsy) {
  instruccionesLindsy =
    "Sos Lindsy, el asistente personal de Jonathan. Hablás en español natural, con calidez y claridad, en respuestas breves. " +
    "Si te preguntan quién sos, decís que sos Lindsy, el asistente personal de Jonathan. No inventás datos ni acciones. " +
    "No pedís ni aceptás claves, códigos ni datos bancarios.";
}
// Derivación a Jonathan: link directo a su WhatsApp (como en el bot de Moda Florencia)
const LINK_JONATHAN = "https://wa.me/5493873441084";
const MENSAJE_DERIVACION =
  "¡Claro! 😊 Si querés hablar directamente con Jonathan, escribile por acá:\n" +
  LINK_JONATHAN +
  "\n\nÉl te responde apenas pueda.";
const QUIERE_QUE_JONATHAN_CONTACTE = /(?:avis[aá]le|avis[aá]|dec[ií]le|decile|ped[ií]le|pedile)[^.?!]{0,60}(?:que\s+)?(?:Jonathan\s+)?(?:me\s+)?(?:escriba|contacte|llame|mande\s+mensaje)|(?:quiero|necesito)\s+que\s+Jonathan\s+(?:me\s+)?(?:escriba|contacte|llame)/i;
const QUIERE_HABLAR_CON_JONATHAN = new RegExp(
  "(hablar|comunicar|contactar|escribir|contacto|pasame|pasá|derivame|llamar|ver)[^.?!]{0,40}(jonathan|jona\\b|due[ñn]o|humano|persona real|una persona|alguien real)" +
    "|(jonathan|due[ñn]o)[^.?!]{0,30}(hablar|contactar|n[uú]mero|whatsapp|contacto)" +
    "|(quiero|necesito|puedo|podr[ií]a)[^.?!]{0,25}\\bjonathan\\b",
  "i"
);
const SOLO_SALUDO = /^\s*(hola|holis?|buenas?|buen[oa]s?\s+(d[ií]as?|tardes?|noches?)|hey|ey|hello|hi)(\s+lindsy)?[\s!.¡,?]*$/i;

// Memoria corta de cada conversacion (se borra si el servidor se reinicia)
const MAX_HISTORIAL = 10;
const historiales = new Map();
const historialesPersonal = new Map();
const vistos = new Set();

// Conversaciones en pausa: numero del cliente -> momento (ms) hasta el que el bot no contesta
const pausados = new Map();
const PAUSA_MS = (Number(PAUSA_HORAS) > 0 ? Number(PAUSA_HORAS) : 8) * 60 * 60 * 1000;
// Ids de los mensajes que mando el propio bot, para no confundirlos con los del dueño
const enviadosPorBot = new Set();

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/", (_req, res) => res.send(modoSoloPersonal ? "NexoAI Personal activo" : "NexoAI WhatsApp activo"));

// ---- Registro en planilla (inicio)
// Guarda cada conversacion en una planilla de Google (via Apps Script).
// Si no estan cargadas WEBHOOK_PLANILLA_URL y PLANILLA_CLAVE, no hace nada.
const nombresPorNumero = new Map();

function textoDe(m) {
  return m.type === "text" ? m.text?.body || "" : `[${m.type}]`;
}

function fechaArgentina() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

async function registrarEnPlanilla({ numero, texto, respuesta, estado }) {
  if (!WEBHOOK_PLANILLA_URL || !PLANILLA_CLAVE) return;
  try {
    const r = await fetch(WEBHOOK_PLANILLA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify({
        clave: PLANILLA_CLAVE,
        fecha: fechaArgentina(),
        numero,
        nombre: nombresPorNumero.get(numero) || "",
        texto,
        respuesta,
        estado,
      }),
    });
    if (!r.ok) console.error("Planilla: respuesta inesperada", r.status);
  } catch (err) {
    console.error("Error guardando en la planilla:", err);
  }
}
// ---- Registro en planilla (fin)

// Paginas publicas que Meta exige para publicar la app
const paginasPublicas = {
  "/privacidad": "privacidad.html",
  "/eliminacion-datos": "eliminacion-datos.html",
};
for (const [ruta, archivo] of Object.entries(paginasPublicas)) {
  const html = fs.readFileSync(new URL(`./${archivo}`, import.meta.url), "utf-8");
  app.get(ruta, (_req, res) => res.type("html").send(html));
}

// Meta llama a esta ruta una vez para verificar el webhook
app.get("/webhook", (req, res) => {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const desafio = req.query["hub.challenge"];
  if (modo === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(desafio);
  }
  res.sendStatus(403);
});

function firmaValida(req) {
  const recibida = req.get("x-hub-signature-256") || "";
  const esperada =
    "sha256=" +
    crypto
      .createHmac("sha256", META_APP_SECRET)
      .update(req.rawBody || "")
      .digest("hex");
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Meta manda aca cada mensaje que escribe un cliente
app.post("/webhook", (req, res) => {
  console.log("Webhook POST recibido");
  if (!firmaValida(req)) {
    console.error("Firma invalida: revisar META_APP_SECRET");
    return res.sendStatus(401);
  }
  res.sendStatus(200); // responder rapido; Meta reintenta si tarda

  const cambios = (req.body.entry || []).flatMap((e) => e.changes || []);

  // Nombre de perfil de cada cliente (para el registro de conversaciones)
  if (nombresPorNumero.size > 1000) nombresPorNumero.clear();
  for (const c of cambios) {
    for (const k of c.value?.contacts || []) {
      if (k.wa_id && k.profile?.name) nombresPorNumero.set(k.wa_id, k.profile.name);
    }
  }

  const mensajes = cambios.flatMap((c) =>
    (c.value?.messages || []).map((mensaje) => ({
      mensaje,
      phoneNumberId: c.value?.metadata?.phone_number_id,
    }))
  );
  // Mensajes que el dueño escribe desde la app de WhatsApp Business (coexistencia)
  const ecos = cambios
    .filter((c) => c.field === "smb_message_echoes")
    .flatMap((c) => c.value?.message_echoes || []);

  console.log("Mensajes recibidos:", mensajes.length);
  for (const c of cambios) {
    for (const s of c.value?.statuses || []) {
      if (s.status === "failed") {
        manejarFalloEntrega(s, c.value?.metadata?.phone_number_id).catch((err) => console.error("Error con estado fallido:", err));
      }
    }
  }
  for (const { mensaje, phoneNumberId } of mensajes) {
    procesar(mensaje, phoneNumberId).catch((err) => console.error("Error procesando mensaje:", err));
  }
  if (ecos.length) console.log("Mensajes enviados desde la app:", ecos.length);
  for (const eco of ecos) manejarEco(eco);
});

// Aviso a Jonathan (su línea 084) cuando alguien pide hablar con él por Lindsy.
// Sale desde la línea de Lindsy: WhatsApp solo lo entrega si Jonathan le escribió al 789 en las últimas 24 h.
const NUMERO_AVISO_JONATHAN = String(OWNER_WHATSAPP_NUMBER || "5493873441084").replace(/\D/g, "");
const avisosJonathan = new Map();
// Solicitudes de contacto pendientes de autorización. Son temporales y se pierden si el proceso reinicia.
const solicitudesContacto = new Map();
const LIMITE_SOLICITUD_MS = 30 * 60 * 1000;
function limpiarSolicitudesContacto() {
  const ahora = Date.now();
  for (const [id, solicitud] of solicitudesContacto) {
    if (ahora - solicitud.ts > LIMITE_SOLICITUD_MS) solicitudesContacto.delete(id);
  }
}
async function avisarJonathanDesdeLindsy(numeroPersona, texto, phoneNumberId) {
  const persona = String(numeroPersona || "").replace(/\D/g, "");
  if (!persona || persona.slice(-10) === NUMERO_AVISO_JONATHAN.slice(-10)) return { ok: false };
  limpiarSolicitudesContacto();
  const existente = [...solicitudesContacto.values()].find((x) => x.numero === persona && x.estado === "pendiente");
  if (existente) return { ok: true, id: existente.id, repetida: true };
  const id = persona.slice(-4);
  const resumen = String(texto || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const nombre = nombresPorNumero.get(persona) || "";
  const solicitud = { id, numero: persona, nombre, texto: resumen, phoneNumberId, ts: Date.now(), estado: "pendiente" };
  solicitudesContacto.set(id, solicitud);
  if (solicitudesContacto.size > 100) solicitudesContacto.delete(solicitudesContacto.keys().next().value);
  const aviso =
    `🙋 Lindsy: alguien quiere hablar con vos.\n\n` +
    `Solicitud #${id}${nombre ? ` — ${nombre}` : ""}\nNúmero: +${persona}\nMensaje: "${resumen}"\n\n` +
    `Respondé: SI ${id} para autorizar el contacto, o NO ${id} ocupado para rechazar por ahora.`;
  try {
    const enviado = await enviar(NUMERO_AVISO_JONATHAN, aviso, phoneNumberId);
    if (!enviado) {
      solicitudesContacto.delete(id);
      return { ok: false, id };
    }
    avisosJonathan.set(persona, Date.now());
    console.log("WhatsApp aceptó el envío de la solicitud de contacto al dueño");
    return { ok: true, id };
  } catch (err) {
    console.error("No se pudo avisar a Jonathan:", err);
    solicitudesContacto.delete(id);
    return { ok: false, id };
  }
}

// ---- Mensajes de Jonathan a terceros (orden por WhatsApp desde su línea)
// Ej.: "Lindsy, escribile al 3873123456 que ya llegué y mañana lo llamo".
// Si la persona le escribió en las últimas 24 h, se manda el mensaje libre. Si no, WhatsApp lo rechaza (error 131047):
// se manda la plantilla aprobada de contacto y el mensaje queda pendiente hasta que la persona responda.
const PLANTILLA_PRIMER_MENSAJE = process.env.LINDSY_PLANTILLA || "aviso_contacto_dueno";
const PLANTILLA_PRIMER_MENSAJE_IDIOMA = process.env.LINDSY_PLANTILLA_IDIOMA || "es_AR";
const ordenesRecientes = new Map();
const ordenEnEspera = { destino: null, ts: 0 }; // orden sin mensaje: el próximo texto de Jonathan es el mensaje // últimos 10 dígitos -> { mensaje, ts, plantilla, falloAvisado }
const mensajesPendientes = new Map(); // últimos 10 dígitos -> { mensaje, ts }
const ultimos10 = (n) => String(n || "").replace(/\D/g, "").slice(-10);
const esJonathan = (n) => ultimos10(n).length === 10 && ultimos10(n) === ultimos10(NUMERO_AVISO_JONATHAN);

function normalizarDestino(crudo) {
  let d = String(crudo || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) {
    d = d.slice(1);
    const m = d.match(/^(\d{2,4})15(\d{6,8})$/); // código de área + 15 + número
    if (m && m[1].length + m[2].length === 10) d = m[1] + m[2];
  }
  if (d.length === 10) return "549" + d;
  if (d.startsWith("549") && d.length === 13) return d;
  if (d.startsWith("54") && d.length === 12) return "549" + d.slice(2);
  if (!d.startsWith("54") && d.length >= 11 && d.length <= 15) return d; // número de otro país
  return null;
}

function leerOrdenDeJonathan(texto) {
  const t = String(texto || "");
  const m = t.match(/\+?\d[\d\s().-]{7,}\d/);
  if (!m) return null;
  if (!/(escrib|mand[aá]|envi[aá]|dec[ií]|avis[aá]|salud[aá]|contact[aá])/i.test(t)) return null;
  return { destino: normalizarDestino(m[0]), instruccion: t.replace(m[0], " ").replace(/\s+/g, " ").trim() };
}

function limpiarInstruccion(t) {
  let s = String(t || "").replace(/\blindsy\b[\s,:;-]*/gi, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^(por favor[\s,]*)?(escrib\w*|mand\w*|envi\w*|dec\w*|avis\w*|salud\w*|contact\w*)\s+(le\s+|les\s+)?(a\s+|al\s+)?(el\s+)?(n[uú]mero\s+|contacto\s+)?(de\s+)?/i, "");
  s = s.replace(/^(y\s+)?(dec[ií]le|dile|avisale|diciendo|dici[eé]ndole)?\s*(que\s+)?/i, "");
  return s.trim();
}

const INTRO_LINDSY = "Hola, soy Lindsy, el asistente personal de Jonathan. 😊 Te escribo de su parte.";

async function redactarMensajeDeJonathan(instruccion) {
  const limpio = limpiarInstruccion(instruccion);
  if (limpio.length < 3) return "SIN_MENSAJE";
  let cuerpo = "";
  try {
    const r = await groq.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: 1500,
      reasoning_effort: "low",
      messages: [
        {
          role: "system",
          content:
            "Sos Lindsy, el asistente personal de Jonathan. Jonathan te pide que le escribas a una persona de su parte. " +
            "Escribí SOLO el contenido del mensaje (1 o 2 frases), en español rioplatense, cálido y claro, hablando de Jonathan en tercera persona. " +
            "No incluyas saludo ni presentación: eso ya se agrega aparte. " +
            "Ejemplos: instrucción 'que me llame' -> 'Jonathan te pide que lo llames cuando puedas.'; " +
            "instrucción 'que ya llegué y mañana lo llamo' -> 'Jonathan te avisa que ya llegó y que mañana te llama.'; " +
            "instrucción 'que quiero saber cómo está' -> 'Jonathan quería saber cómo estás.' " +
            "Corregí errores de tipeo evidentes sin cambiar el sentido. No inventes datos, horarios, lugares ni promesas. Sin comillas ni explicaciones.",
        },
        { role: "user", content: instruccion },
      ],
    });
    cuerpo = String(r.choices?.[0]?.message?.content || "").trim();
  } catch (err) {
    console.error("Groq no pudo redactar el mensaje de Jonathan:", err?.message || err);
  }
  cuerpo = cuerpo.replace(/^Hola,? soy Lindsy[^.]*\.\s*(😊\s*)?(Te escribo de su parte\.?\s*)?/i, "").trim();
  if (cuerpo.length < 8 || /SIN_MENSAJE/.test(cuerpo)) {
    console.error("Redacción vacía o muy corta: se usa el texto de Jonathan tal cual");
    cuerpo = `Jonathan te manda a decir: "${limpio}"`;
  }
  return `${INTRO_LINDSY} ${cuerpo}\n\nPodés escribirle directamente acá: ${LINK_JONATHAN}`;
}

async function enviarConResultado(numero, texto, phoneNumberId) {
  for (const destino of variantesNumero(numero)) {
    const r = await enviarA(destino, texto, phoneNumberId);
    if (r.ok) {
      const datos = await r.json().catch(() => null);
      const id = datos?.messages?.[0]?.id;
      if (id) enviadosPorBot.add(id);
      return true;
    }
    const cuerpo = await r.text().catch(() => "");
    console.error(`Error enviando a ${destino}:`, r.status, cuerpo.slice(0, 200));
    if (!cuerpo.includes("131030")) return false;
  }
  return false;
}

async function enviarPlantillaPrimerMensaje(numero, phoneNumberId) {
  const miNumero = "+549" + ultimos10(NUMERO_AVISO_JONATHAN);
  const template = { name: PLANTILLA_PRIMER_MENSAJE, language: { code: PLANTILLA_PRIMER_MENSAJE_IDIOMA } };
  if (PLANTILLA_PRIMER_MENSAJE === "aviso_contacto_dueno") {
    template.components = [{ type: "body", parameters: [{ type: "text", text: miNumero }] }];
  }
  for (const destino of variantesNumero(numero)) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: destino, type: "template", template }),
    });
    if (r.ok) return true;
    const cuerpo = await r.text().catch(() => "");
    console.error(`Error enviando plantilla a ${destino}:`, r.status, cuerpo.slice(0, 200));
    if (!cuerpo.includes("131030")) return false;
  }
  return false;
}

async function usarPlantillaPrimerMensaje(destino, phoneNumberId) {
  const clave = ultimos10(destino);
  const o = ordenesRecientes.get(clave);
  if (!o || o.plantilla) return;
  o.plantilla = true;
  const ok = await enviarPlantillaPrimerMensaje(destino, phoneNumberId);
  if (ok) {
    mensajesPendientes.set(clave, { mensaje: o.mensaje, ts: Date.now() });
    if (mensajesPendientes.size > 200) mensajesPendientes.clear();
    await enviar(
      NUMERO_AVISO_JONATHAN,
      `ℹ️ +${destino} no te escribió en las últimas 24 h, así que WhatsApp no deja mandarle un mensaje libre. ` +
        `Le mandé la plantilla de contacto y, apenas responda, le entrego tu mensaje:\n\n${o.mensaje}`,
      phoneNumberId
    );
  } else {
    await enviar(NUMERO_AVISO_JONATHAN, `⚠️ No pude escribirle a +${destino}. Escribile vos: https://wa.me/${destino}`, phoneNumberId);
  }
}

async function manejarFalloEntrega(s, phoneNumberId) {
  const destino = s?.recipient_id;
  if (!destino || esJonathan(destino)) return;
  console.error("Entrega fallida:", JSON.stringify({ destino, errores: s?.errors }));
  const errorWA = (s?.errors || [])[0];
  const detalleError = errorWA ? ` (código ${errorWA.code}: ${String(errorWA.title || errorWA.message || "").slice(0, 120)})` : "";
  const o = ordenesRecientes.get(ultimos10(destino));
  if (!o || Date.now() - o.ts > 10 * 60 * 1000) return;
  const ventanaCerrada = (s.errors || []).some((e) => e.code === 131047 || e.code === 131049);
  if (ventanaCerrada && !o.plantilla) {
    await usarPlantillaPrimerMensaje(destino, phoneNumberId);
    return;
  }
  if (o.falloAvisado) return;
  o.falloAvisado = true;
  await enviar(NUMERO_AVISO_JONATHAN, `⚠️ WhatsApp no pudo entregar el mensaje a +${destino}${detalleError}. Escribile vos: https://wa.me/${destino}`, phoneNumberId);
}

async function manejarOrdenDeJonathan(orden, phoneNumberId) {
  const jonathan = NUMERO_AVISO_JONATHAN;
  if (!orden.destino) {
    await enviar(jonathan, "No entendí el número. Escribilo con código de área, sin 0 ni 15. Por ejemplo: Lindsy, escribile al 3873123456 que ya llegué.", phoneNumberId);
    return;
  }
  if (esJonathan(orden.destino)) {
    await enviar(jonathan, "Ese es tu mismo número 😊. Pasame el de la otra persona.", phoneNumberId);
    return;
  }
  let mensaje = "";
  try {
    mensaje = await redactarMensajeDeJonathan(orden.instruccion);
  } catch (err) {
    console.error("Error redactando el mensaje de Jonathan:", err);
  }
  if (!mensaje || /SIN_MENSAJE/.test(mensaje)) {
    ordenEnEspera.destino = orden.destino;
    ordenEnEspera.ts = Date.now();
    await enviar(jonathan, `¿Qué querés que le diga a +${orden.destino}? Escribime solo el mensaje, por ejemplo: ya llegué y mañana lo llamo.`, phoneNumberId);
    return;
  }
  ordenesRecientes.set(ultimos10(orden.destino), { mensaje, ts: Date.now(), plantilla: false, falloAvisado: false });
  if (ordenesRecientes.size > 200) ordenesRecientes.clear();
  const ok = await enviarConResultado(orden.destino, mensaje, phoneNumberId);
  if (!ok) {
    await usarPlantillaPrimerMensaje(orden.destino, phoneNumberId);
    return;
  }
  const h = historialesPersonal.get(orden.destino);
  if (h?.length) h.push({ role: "assistant", content: mensaje });
  await enviar(
    jonathan,
    `📤 Le mandé a +${orden.destino}:\n\n${mensaje}\n\nSi esa persona no te escribió en las últimas 24 h, WhatsApp puede rechazarlo y entonces te aviso y uso la plantilla de contacto.`,
    phoneNumberId
  );
}
// ---- Fin: mensajes de Jonathan a terceros

// Asistente personal separado. Si Groq falla, nunca se deriva la consulta a Claude.
async function procesarAsistentePersonal(numero, texto, phoneNumberId = ID_TELEFONO_PREDETERMINADO) {
  if (!groq) {
    await enviar(numero, "El asistente personal todavía no está activado. Falta configurar GROQ_API_KEY. La atención habitual de NexoAI permanece separada.", phoneNumberId);
    return;
  }

  if (esJonathan(numero)) {
    limpiarSolicitudesContacto();
    const decision = texto.match(/^\\s*(si|sí|no)\\s+(\\d{4})(?:\\s+(.*))?\\s*$/i);
    if (decision) {
      const solicitud = solicitudesContacto.get(decision[2]);
      if (!solicitud || solicitud.estado !== "pendiente") {
        await enviar(numero, "No encuentro una solicitud pendiente con ese código. Pedile a la persona que vuelva a solicitar contacto.", phoneNumberId);
        return;
      }
      solicitudesContacto.delete(decision[2]);
      if (/^(si|sí)$/i.test(decision[1])) {
        const ok = await enviar(solicitud.numero, "¡Jonathan está disponible para que le escribas! 😊 Su WhatsApp: " + LINK_JONATHAN, solicitud.phoneNumberId || phoneNumberId);
        await enviar(numero, ok ? "Listo. WhatsApp aceptó enviar el enlace a la persona; no puedo confirmar entrega o lectura." : "No pude confirmar el envío del enlace. Revisá WhatsApp antes de darlo por hecho.", phoneNumberId);
      } else {
        const ok = await enviar(solicitud.numero, "Jonathan está ocupado en este momento. Ya recibió tu solicitud y te responderá cuando pueda. Gracias por esperar. 😊", solicitud.phoneNumberId || phoneNumberId);
        await enviar(numero, ok ? "Le indiqué que estás ocupado y que ya recibiste su solicitud." : "No pude confirmar el envío de la respuesta a la persona.", phoneNumberId);
      }
      return;
    }
    let orden = leerOrdenDeJonathan(texto);
    const esperando = ordenEnEspera.destino && Date.now() - ordenEnEspera.ts < 10 * 60 * 1000;
    if (!orden && esperando) {
      if (/^\s*(s[ií]|ok|dale|bueno|eso|por favor|s[ií],? por favor|s[ií],? eso)[\s!.,]*$/i.test(texto)) {
        await enviar(numero, "Dale 😊 ¿Cuál es el mensaje? Escribilo y se lo mando.", phoneNumberId);
        return;
      }
      orden = { destino: ordenEnEspera.destino, instruccion: texto };
    }
    if (orden) {
      ordenEnEspera.destino = null;
      await manejarOrdenDeJonathan(orden, phoneNumberId).catch((err) => console.error("Error con la orden de Jonathan:", err));
      return;
    }
  }
  const pendiente = mensajesPendientes.get(ultimos10(numero));
  if (pendiente && Date.now() - pendiente.ts < 7 * 24 * 60 * 60 * 1000) {
    // La persona respondió a la plantilla: ahora sí se le entrega el mensaje de Jonathan
    mensajesPendientes.delete(ultimos10(numero));
    await enviar(numero, pendiente.mensaje, phoneNumberId);
    if (SOLO_SALUDO.test(texto)) {
      historialesPersonal.set(numero, [{ role: "user", content: texto }, { role: "assistant", content: pendiente.mensaje }]);
      return;
    }
    historialesPersonal.set(numero, [{ role: "assistant", content: pendiente.mensaje }]);
  }
  const historial = historialesPersonal.get(numero) || [];
  if (historial.length === 0 && SOLO_SALUDO.test(texto)) {
    // Primer contacto con un saludo breve: presentar a Lindsy una sola vez.
    await enviar(numero, SALUDO_LINDSY, phoneNumberId);
    historialesPersonal.set(numero, [
      { role: "user", content: texto },
      { role: "assistant", content: SALUDO_LINDSY },
    ]);
    return;
  }
  if (QUIERE_QUE_JONATHAN_CONTACTE.test(texto)) {
    const avisoAceptado = await avisarJonathanDesdeLindsy(numero, texto, phoneNumberId);
    const respuesta = avisoAceptado
      ? "Listo 😊 WhatsApp aceptó el envío del aviso a Jonathan. La entrega final depende de WhatsApp y no puedo confirmar que ya lo haya leído."
      : "Quise avisarle a Jonathan, pero no pude confirmar el envío del aviso ahora. Para asegurarte, escribile directamente por WhatsApp: " + LINK_JONATHAN;
    historial.push({ role: "user", content: texto }, { role: "assistant", content: respuesta });
    while (historial.length > MAX_HISTORIAL) historial.shift();
    if (historial[0]?.role === "assistant") historial.shift();
    historialesPersonal.set(numero, historial);
    await enviar(numero, respuesta, phoneNumberId);
    return;
  }
  if (QUIERE_HABLAR_CON_JONATHAN.test(texto)) {
    // Derivación fija con link, sin pasar por el modelo
    historial.push({ role: "user", content: texto }, { role: "assistant", content: MENSAJE_DERIVACION });
    while (historial.length > MAX_HISTORIAL) historial.shift();
    if (historial[0]?.role === "assistant") historial.shift();
    historialesPersonal.set(numero, historial);
    await enviar(numero, MENSAJE_DERIVACION, phoneNumberId);
    await avisarJonathanDesdeLindsy(numero, texto, phoneNumberId);
    return;
  }
  historial.push({ role: "user", content: texto });

  try {
    const r = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: instruccionesLindsy,
        },
        ...historial,
      ],
      max_tokens: 600,
    });

    const respuesta = String(r.choices?.[0]?.message?.content || "").trim() ||
      "No pude preparar una respuesta. ¿Podés volver a escribirme?";
    historial.push({ role: "assistant", content: respuesta });
    while (historial.length > MAX_HISTORIAL) historial.shift();
    if (historial[0]?.role === "assistant") historial.shift();
    historialesPersonal.set(numero, historial);
    await enviar(numero, respuesta, phoneNumberId);
  } catch (err) {
    console.error("Error con Groq para asistencia personal:", err);
    historial.pop();
    historialesPersonal.set(numero, historial);
    await enviar(numero, "Tu asistente personal tuvo un problema técnico. Probá de nuevo más tarde; la atención comercial de NexoAI sigue por su flujo habitual.", phoneNumberId);
  }
}

async function procesar(m, phoneNumberId = ID_TELEFONO_PREDETERMINADO) {
  if (phoneNumberId && phoneNumberId !== WHATSAPP_PHONE_NUMBER_ID && phoneNumberId !== PERSONAL_WHATSAPP_PHONE_NUMBER_ID) {
    console.error("Mensaje ignorado: phone_number_id no configurado para esta aplicación");
    return;
  }
  if (modoSoloPersonal && phoneNumberId !== PERSONAL_WHATSAPP_PHONE_NUMBER_ID) {
    console.error("Mensaje ignorado: el modo solo personal exige el ID de teléfono personal configurado");
    return;
  }
  if (vistos.has(m.id)) return;
  vistos.add(m.id);
  if (vistos.size > 1000) vistos.clear();

  const numero = m.from;

  // Si el dueño le respondio a este cliente desde la app, el bot se queda callado un rato
  if (estaPausado(numero)) {
    console.log(`Conversacion con ${numero} en pausa (respondio una persona): el bot no contesta`);
    registrarEnPlanilla({ numero, texto: textoDe(m), respuesta: "", estado: "Bot en pausa (respondió una persona)" });
    return;
  }

  if (m.type !== "text") {
    const avisoTexto = "Por ahora solo puedo leer mensajes de texto. ¿Me escribís tu consulta?";
    registrarEnPlanilla({ numero, texto: textoDe(m), respuesta: avisoTexto, estado: "Mensaje que no es texto" });
    await enviar(numero, avisoTexto, phoneNumberId);
    return;
  }

  // Si se configura el ID de Meta del número personal, se enruta por el número empresarial receptor.
  // El modo antiguo por remitente queda como compatibilidad hasta configurar coexistencia.
  const numeroNormalizado = String(numero || "").replace(/\D/g, "");
  const esNumeroPersonal = PERSONAL_WHATSAPP_PHONE_NUMBER_ID
    ? phoneNumberId === PERSONAL_WHATSAPP_PHONE_NUMBER_ID
    : Boolean(numeroPersonal && numeroNormalizado === numeroPersonal);
  if (esNumeroPersonal) {
    await procesarAsistentePersonal(numero, m.text.body, phoneNumberId);
    return;
  }

  const historial = historiales.get(numero) || [];
  historial.push({ role: "user", content: m.text.body });

  let respuesta;
  try {
    const r = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system: instrucciones,
      messages: historial,
    });
    respuesta = r.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  } catch (err) {
    historial.pop();
    historiales.set(numero, historial);
    console.error("Error con Claude:", err);
    registrarEnPlanilla({ numero, texto: textoDe(m), respuesta: "(error técnico: se envió una disculpa)", estado: "Error con Claude" });
    await enviar(numero, "Disculpá, tuve un problema técnico. ¿Podés escribirme de nuevo en un rato?");
    return;
  }

  // Si el cliente confirmo un pedido, el modelo agrega una linea "[[PEDIDO]] resumen".
  // Se la saca del mensaje al cliente y se le avisa al dueño.
  const { texto, pedido, derivar } = separarMarcas(respuesta);
  respuesta = texto;
  if (pedido) {
    avisarPedido(numero, pedido).catch((err) => console.error("Error avisando el pedido:", err));
  }
  if (derivar) {
    avisarDerivacion(numero, derivar).catch((err) => console.error("Error avisando la derivacion:", err));
  }

  if (!respuesta) respuesta = "Disculpá, no pude armar una respuesta. ¿Me lo repetís?";

  historial.push({ role: "assistant", content: respuesta });
  while (historial.length > MAX_HISTORIAL || historial[0]?.role !== "user") {
    historial.shift();
  }
  historiales.set(numero, historial);

  registrarEnPlanilla({
    numero,
    texto: textoDe(m),
    respuesta,
    estado: pedido ? `Pedido confirmado: ${pedido}` : derivar ? `Derivado a una persona: ${derivar}` : "Respondido",
  });

  await enviar(numero, respuesta, phoneNumberId);
}

function pausarConversacion(cliente) {
  pausados.set(cliente, Date.now() + PAUSA_MS);
  console.log(`Respondio una persona desde la app: bot en pausa con ${cliente} por ${PAUSA_MS / 3600000} h`);
}

function estaPausado(cliente) {
  const hasta = pausados.get(cliente);
  if (!hasta) return false;
  if (Date.now() > hasta) {
    pausados.delete(cliente);
    return false;
  }
  return true;
}

// Meta avisa con "smb_message_echoes" cada mensaje que sale desde la app de WhatsApp Business.
// El campo "to" es el numero del cliente.
function manejarEco(eco) {
  const cliente = eco?.to;
  if (!cliente) return;
  // Se espera un momento: si fue un mensaje del propio bot, su id ya quedo registrado y se ignora
  setTimeout(() => {
    if (eco.id && enviadosPorBot.has(eco.id)) return;
    pausarConversacion(cliente);
  }, 3000);
}

// El modelo agrega lineas internas al final de su respuesta: [[PEDIDO]] ... o [[DERIVAR]] ...
// Se las saca siempre del mensaje al cliente (incluso si vienen mal escritas o en medio del texto).
const MARCA_PEDIDO = /\[\[PEDIDO\]\][ \t]*([^\n]*)/i;
const MARCA_DERIVAR = /\[\[DERIVAR\]\][ \t]*([^\n]*)/i;
const MARCA_SUELTA = /\[\[[A-Z_]+\]\]/gi;

function separarMarcas(respuesta) {
  let texto = respuesta;
  const sacar = (re) => {
    const m = texto.match(re);
    if (!m) return null;
    texto = texto.replace(re, "");
    return m[1].trim() || "(sin detalle)";
  };
  const pedido = sacar(MARCA_PEDIDO);
  const derivar = sacar(MARCA_DERIVAR);
  texto = texto.replace(MARCA_SUELTA, "").replace(/\n{3,}/g, "\n\n").trim();
  return { texto, pedido, derivar };
}

// Para no avisar muchas veces por la misma conversacion
const derivaciones = new Map();
const ESPERA_ENTRE_AVISOS_MS = 30 * 60 * 1000;

async function avisarDerivacion(numeroCliente, motivo) {
  if (!OWNER_WHATSAPP_NUMBER) {
    console.error("Cliente derivado pero falta OWNER_WHATSAPP_NUMBER. Motivo:", motivo);
    return;
  }
  const ultimo = derivaciones.get(numeroCliente) || 0;
  if (Date.now() - ultimo < ESPERA_ENTRE_AVISOS_MS) return;
  derivaciones.set(numeroCliente, Date.now());
  const aviso =
    `🙋 Un cliente quiere hablar con una persona\n\nMotivo: ${motivo}\n\n` +
    `Cliente: +${numeroCliente}\nEscribirle: https://wa.me/${numeroCliente}`;
  await enviar(OWNER_WHATSAPP_NUMBER, aviso);
  console.log("Aviso de derivacion enviado al dueño");
}

async function avisarPedido(numeroCliente, resumen) {
  if (!OWNER_WHATSAPP_NUMBER) {
    console.error("Pedido confirmado pero falta OWNER_WHATSAPP_NUMBER. Resumen:", resumen);
    return;
  }
  const aviso =
    `🛒 Nuevo pedido por WhatsApp\n\n${resumen}\n\n` +
    `Cliente: +${numeroCliente}\nEscribirle: https://wa.me/${numeroCliente}`;
  await enviar(OWNER_WHATSAPP_NUMBER, aviso);
  console.log("Aviso de pedido enviado al dueño");
}

// Meta puede rechazar numeros argentinos segun el formato (549... / 54... / 54 + area + 15 + numero).
// Se prueba el formato original y, solo si Meta responde 131030, las otras variantes.
function variantesNumero(numero) {
  const lista = [numero];
  if (/^549\d{10}$/.test(numero)) {
    const resto = numero.slice(3); // codigo de area + abonado (10 digitos)
    lista.push("54" + resto);
    for (const largoArea of [3, 2, 4]) {
      lista.push("54" + resto.slice(0, largoArea) + "15" + resto.slice(largoArea));
    }
  }
  return lista;
}

async function enviarA(destino, texto, phoneNumberId = ID_TELEFONO_PREDETERMINADO) {
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: destino,
      type: "text",
      text: { body: texto },
    }),
  });
}

async function enviar(numero, texto, phoneNumberId = ID_TELEFONO_PREDETERMINADO) {
  for (const destino of variantesNumero(numero)) {
    const r = await enviarA(destino, texto, phoneNumberId);
    if (r.ok) {
      const datos = await r.json().catch(() => null);
      const idEnviado = datos?.messages?.[0]?.id;
      if (idEnviado) {
        enviadosPorBot.add(idEnviado);
        if (enviadosPorBot.size > 2000) enviadosPorBot.clear();
      }
      console.log(`Mensaje enviado a ${destino}${destino !== numero ? ` (formato alternativo; Meta lo recibio como ${numero})` : ""}`);
      return true;
    }
    const cuerpo = await r.text();
    console.error(`Error enviando a WhatsApp (destino ${destino}):`, r.status, cuerpo);
    if (!cuerpo.includes("131030")) return false; // otro error: no tiene sentido probar otros formatos
  }
  return false;
}

app.listen(PORT, () => console.log(`NexoAI WhatsApp escuchando en el puerto ${PORT}`));