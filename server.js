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
async function avisarJonathanDesdeLindsy(numeroPersona, texto, phoneNumberId) {
  const persona = String(numeroPersona || "").replace(/\D/g, "");
  if (!persona || persona.slice(-10) === NUMERO_AVISO_JONATHAN.slice(-10)) return; // no avisarle a Jonathan de sí mismo
  const ultimo = avisosJonathan.get(persona) || 0;
  if (Date.now() - ultimo < 5 * 60 * 1000) return; // un aviso cada 5 minutos por persona
  avisosJonathan.set(persona, Date.now());
  if (avisosJonathan.size > 500) avisosJonathan.clear();
  const resumen = String(texto || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const aviso =
    `🙋 Lindsy: alguien quiere hablar con vos\n\nMensaje: "${resumen}"\n\n` +
    `Persona: +${persona}\nEscribirle: https://wa.me/${persona}`;
  try {
    await enviar(NUMERO_AVISO_JONATHAN, aviso, phoneNumberId);
    console.log("Aviso de derivación enviado a Jonathan");
  } catch (err) {
    console.error("No se pudo avisar a Jonathan:", err);
  }
}

// Asistente personal separado. Si Groq falla, nunca se deriva la consulta a Claude.
async function procesarAsistentePersonal(numero, texto, phoneNumberId = ID_TELEFONO_PREDETERMINADO) {
  if (!groq) {
    await enviar(numero, "El asistente personal todavía no está activado. Falta configurar GROQ_API_KEY. La atención habitual de NexoAI permanece separada.", phoneNumberId);
    return;
  }

  const historial = historialesPersonal.get(numero) || [];
  if (historial.length === 0) {
    // Primer contacto: saludo fijo de Lindsy. Si el mensaje era solo un saludo, no hace falta más.
    await enviar(numero, SALUDO_LINDSY, phoneNumberId);
    if (SOLO_SALUDO.test(texto)) {
      historialesPersonal.set(numero, [
        { role: "user", content: texto },
        { role: "assistant", content: SALUDO_LINDSY },
      ]);
      return;
    }
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
      return;
    }
    const cuerpo = await r.text();
    console.error(`Error enviando a WhatsApp (destino ${destino}):`, r.status, cuerpo);
    if (!cuerpo.includes("131030")) return; // otro error: no tiene sentido probar otros formatos
  }
}

app.listen(PORT, () => console.log(`NexoAI WhatsApp escuchando en el puerto ${PORT}`));
