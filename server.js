import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  SALUDO,
  MENU,
  MENU_REPETIDO,
  NOMBRES,
  detectarNegocio,
  esComandoMenu,
  directiva,
} from "./menu.js";

const {
  PORT = 3000,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_VERIFY_TOKEN,
  META_APP_SECRET,
  ANTHROPIC_API_KEY,
  CLAUDE_MODEL = "claude-sonnet-5-5",
  WHATSAPP_API_VERSION = "v21.0",
  // Numero del dueño que recibe el aviso de cada pedido confirmado (formato 549 + area + numero, sin + ni 15)
  OWNER_WHATSAPP_NUMBER,
  // Horas que el bot se queda callado con un cliente cuando el dueño le responde desde la app (coexistencia)
  PAUSA_HORAS = "8",
  // Planilla de Google donde se registran las conversaciones (Apps Script). Opcional.
  WEBHOOK_PLANILLA_URL,
  PLANILLA_CLAVE,
  // Direccion publica del servicio: de ahi WhatsApp baja las fotos de las prendas
  PUBLIC_BASE_URL = "https://nexoai-whatsapp.onrender.com",
} = process.env;

const requeridas = [
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "META_APP_SECRET",
  "ANTHROPIC_API_KEY",
];
const faltan = requeridas.filter((k) => !process.env[k]);
if (faltan.length) {
  console.error("Faltan variables de entorno:", faltan.join(", "));
  process.exit(1);
}

const instrucciones = fs.readFileSync(
  new URL("./instrucciones-negocio.md", import.meta.url),
  "utf-8"
);
const claude = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Fotos de las prendas (carpeta fotos/): el modelo pide una con la marca [[FOTO]] clave
const carpetaFotos = fileURLToPath(new URL("./fotos/", import.meta.url));
let fotosDisponibles = new Set();
try {
  fotosDisponibles = new Set(
    fs
      .readdirSync(carpetaFotos)
      .filter((f) => f.endsWith(".jpg"))
      .map((f) => path.basename(f, ".jpg"))
  );
} catch {
  console.log("No hay carpeta de fotos: el bot responde solo con texto");
}
const MAX_FOTOS = 3;

// Memoria corta de cada conversacion (se borra si el servidor se reinicia)
const MAX_HISTORIAL = 10;
const historiales = new Map();
const vistos = new Set();

// Menu inicial: numero del cliente -> { negocio: "florencia" | "mayra" | null, esperando, ultimo }
// Pasadas ESTADO_HORAS sin escribir, vuelve a salir el saludo con el menu.
const estados = new Map();
const ESTADO_MS = 12 * 60 * 60 * 1000;

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

app.get("/", (_req, res) => res.send("NexoAI WhatsApp activo"));
app.use("/fotos", express.static(carpetaFotos, { maxAge: "7d" }));

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

  const mensajes = cambios.flatMap((c) => c.value?.messages || []);
  // Mensajes que el dueño escribe desde la app de WhatsApp Business (coexistencia)
  const ecos = cambios
    .filter((c) => c.field === "smb_message_echoes")
    .flatMap((c) => c.value?.message_echoes || []);

  // Meta avisa despues del envio si cada mensaje se entrego, se leyo o fallo (y por que)
  for (const c of cambios) {
    for (const s of c.value?.statuses || []) {
      if (s.status === "failed") {
        console.error(`WhatsApp NO pudo entregar a ${s.recipient_id}:`, JSON.stringify(s.errors || s));
      } else {
        console.log(`Entrega a ${s.recipient_id}: ${s.status}`);
      }
    }
  }

  console.log("Mensajes recibidos:", mensajes.length);
  for (const m of mensajes) {
    procesar(m).catch((err) => console.error("Error procesando mensaje:", err));
  }
  if (ecos.length) console.log("Mensajes enviados desde la app:", ecos.length);
  for (const eco of ecos) manejarEco(eco);
});

// ---- Ordenes del dueño (inicio)
// El dueño le escribe al bot desde OWNER_WHATSAPP_NUMBER, por ejemplo:
//   "Decile al cliente que estoy viajando y apenas llegue le confirmo"
//   "Decile al 3873123456 que estoy en una reunion, ya le escribo"
// El bot redacta el mensaje en nombre del dueño y se lo manda al cliente.
// Sin numero, va al ultimo cliente por el que se le aviso al dueño (pedido o derivacion).
const COMANDO_DUENO = /^\s*(?:dec[ií]le|dile|avis[aá]le|transmit[ií]le|respond[eé]le|contest[aá]le|escrib[ií]le|mand[aá]le)\b/i;
// WhatsApp solo deja escribir libremente dentro de las 24 h del ultimo mensaje del cliente
const VENTANA_MS = 23 * 60 * 60 * 1000;
const ultimoContacto = new Map(); // ultimos 10 digitos del cliente -> ms de su ultimo mensaje
let ultimoAviso = null; // { numero, ts } del ultimo cliente por el que se aviso al dueño

const soloDigitos = (s) => String(s || "").replace(/\D/g, "");
const claveNumero = (s) => soloDigitos(s).slice(-10);

function esDelDueno(numero) {
  if (!OWNER_WHATSAPP_NUMBER) return false;
  const a = claveNumero(numero);
  return a.length === 10 && a === claveNumero(OWNER_WHATSAPP_NUMBER);
}

function anotarContacto(numero) {
  if (ultimoContacto.size > 2000) ultimoContacto.clear();
  ultimoContacto.set(claveNumero(numero), Date.now());
}

// Saca de la orden el numero del cliente (si lo escribio) y deja solo lo que hay que transmitir
function leerOrden(texto) {
  const antes = texto.split(/\bque\b|:/i)[0].slice(0, 120);
  const hallado = antes.match(/\+?\d[\d\s().-]{8,}\d/);
  if (!hallado) return { destino: null, invalido: /\d{5,}/.test(antes), instruccion: texto.trim() };
  const instruccion = texto.replace(hallado[0], " ").replace(/\s{2,}/g, " ").trim();
  let d = soloDigitos(hallado[0]);
  if (d.length === 10) d = "549" + d; // codigo de area + abonado
  else if (d.length === 12 && d.startsWith("54")) d = "549" + d.slice(2);
  else if (d.length === 11 && d.startsWith("9")) d = "54" + d;
  const valido = d.length === 13 && d.startsWith("549");
  return { destino: valido ? d : null, invalido: !valido, instruccion };
}

async function redactarMensajeDelDueno(instruccion) {
  const r = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system:
      "Sos el asistente de WhatsApp de un negocio. La persona dueña del negocio te pide que le transmitas un mensaje a un cliente. " +
      "Redactá el mensaje tal como le va a llegar al cliente, escrito en primera persona como si lo escribiera el dueño (por ejemplo: \"estoy viajando\", \"te confirmo\"), " +
      "en español rioplatense, amable y breve (1 a 3 oraciones). Usá solo lo que dijo el dueño: no agregues hechos, horarios, precios, promesas ni disculpas que no dijo. " +
      "No pongas saludo con nombre, comillas ni encabezados. Si el pedido no es un mensaje para un cliente, respondé exactamente: NO_APLICA. Devolvé solo el mensaje.",
    messages: [{ role: "user", content: instruccion }],
  });
  const texto = r.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (texto === "NO_APLICA") return "";
  return separarMarcas(texto).texto;
}

async function manejarOrdenDelDueno(dueno, texto) {
  const { destino: escrito, invalido, instruccion } = leerOrden(texto);
  if (invalido) {
    await enviar(dueno, "No entendí el número del cliente. Escribilo con código de área, por ejemplo: Decile al 3873123456 que ...");
    return;
  }
  const reciente = ultimoAviso && Date.now() - ultimoAviso.ts < 24 * 60 * 60 * 1000 ? ultimoAviso.numero : null;
  const destino = escrito || reciente;
  if (!destino) {
    await enviar(dueno, "No sé a qué cliente mandárselo: no hay ningún aviso reciente. Escribí el número, por ejemplo: Decile al 3873123456 que ...");
    return;
  }
  const ultimo = ultimoContacto.get(claveNumero(destino));
  if (ultimo && Date.now() - ultimo > VENTANA_MS) {
    await enviar(dueno, `Ese cliente escribió hace más de 24 horas y WhatsApp no me deja mandarle mensajes. Escribile vos: https://wa.me/${destino}`);
    return;
  }
  let mensaje = "";
  try {
    mensaje = await redactarMensajeDelDueno(instruccion);
  } catch (err) {
    console.error("Error redactando el mensaje del dueño:", err);
  }
  if (!mensaje) {
    await enviar(dueno, "No pude armar el mensaje para el cliente. Probá de nuevo, por ejemplo: Decile al cliente que estoy viajando y apenas llegue le confirmo.");
    return;
  }
  const completo = `💬 Mensaje de la persona del local:\n${mensaje}`;
  const ok = await enviar(destino, completo);
  if (!ok) {
    await enviar(dueno, `WhatsApp no me dejó mandar el mensaje (puede que hayan pasado más de 24 horas desde que el cliente escribió). Escribile vos: https://wa.me/${destino}`);
    return;
  }
  // Para que el bot sepa lo que dijo el dueño si el cliente responde
  const h = historiales.get(destino);
  if (h?.length) {
    if (h[h.length - 1].role === "assistant") h[h.length - 1].content += `\n\n${completo}`;
    else h.push({ role: "assistant", content: completo });
  }
  registrarEnPlanilla({
    numero: destino,
    texto: `(orden del dueño) ${instruccion}`,
    respuesta: completo,
    estado: "Mensaje del dueño transmitido",
  });
  await enviar(dueno, `✅ Le mandé a +${destino}:\n\n${completo}`);
}
// ---- Ordenes del dueño (fin)

async function procesar(m) {
  if (vistos.has(m.id)) return;
  vistos.add(m.id);
  if (vistos.size > 1000) vistos.clear();

  const numero = m.from;

  // Ordenes del dueño ("decile al cliente que ..."): solo desde OWNER_WHATSAPP_NUMBER
  if (m.type === "text" && esDelDueno(numero) && COMANDO_DUENO.test(m.text.body)) {
    await manejarOrdenDelDueno(numero, m.text.body).catch((err) =>
      console.error("Error con la orden del dueño:", err)
    );
    return;
  }
  if (!esDelDueno(numero)) anotarContacto(numero);

  // Si el dueño le respondio a este cliente desde la app, el bot se queda callado un rato
  if (estaPausado(numero)) {
    console.log(`Conversacion con ${numero} en pausa (respondio una persona): el bot no contesta`);
    registrarEnPlanilla({ numero, texto: textoDe(m), respuesta: "", estado: "Bot en pausa (respondió una persona)" });
    return;
  }

  if (m.type !== "text") {
    const avisoTexto = "Por ahora solo puedo leer mensajes de texto. ¿Me escribís tu consulta?";
    registrarEnPlanilla({ numero, texto: textoDe(m), respuesta: avisoTexto, estado: "Mensaje que no es texto" });
    await enviar(numero, avisoTexto);
    return;
  }

  // ---- Menu inicial: saludo + opciones, y despues el bot sigue con el negocio elegido
  let estado = estados.get(numero);
  if (estado && Date.now() - estado.ultimo > ESTADO_MS) {
    estados.delete(numero);
    historiales.delete(numero);
    estado = undefined;
  }
  const esNuevo = !estado;
  if (!estado) {
    if (estados.size > 2000) estados.clear();
    estado = { negocio: null, esperando: false, ultimo: Date.now() };
    estados.set(numero, estado);
  }
  estado.ultimo = Date.now();

  let textoParaClaude = m.text.body;

  if (estado.negocio && esComandoMenu(m.text.body)) {
    estado.negocio = null;
    estado.esperando = true;
    historiales.delete(numero);
    await mostrarMenu(numero, m, [MENU]);
    return;
  }

  if (!estado.negocio) {
    const { negocio, soloOpcion } = detectarNegocio(m.text.body, estado.esperando);
    if (!negocio) {
      estado.esperando = true;
      await mostrarMenu(numero, m, esNuevo ? [SALUDO, MENU] : [MENU_REPETIDO]);
      return;
    }
    estado.negocio = negocio;
    estado.esperando = false;
    // Si solo escribio "1" o "2", el bot recibe una frase clara en vez del numero
    if (soloOpcion) textoParaClaude = `Quiero consultar por ${NOMBRES[negocio]}.`;
  }
  // ---- Fin del menu inicial

  const historial = historiales.get(numero) || [];
  historial.push({ role: "user", content: textoParaClaude });

  let respuesta;
  try {
    const r = await claude.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system: instrucciones + directiva(estado.negocio),
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
  const { texto, pedido, derivar, fotos } = separarMarcas(respuesta);
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

  await enviar(numero, respuesta);
  for (const clave of fotos) {
    await enviarFoto(numero, clave);
  }
}

// Manda uno o mas mensajes seguidos (por ejemplo, el saludo y despues las opciones)
async function mostrarMenu(numero, m, mensajes) {
  registrarEnPlanilla({
    numero,
    texto: textoDe(m),
    respuesta: mensajes.join("\n\n"),
    estado: "Menú de opciones",
  });
  for (const texto of mensajes) {
    await enviar(numero, texto);
  }
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
const MARCA_FOTO = /\[\[FOTO\]\][ \t]*([a-z0-9-]+)/gi;
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
  // Fotos pedidas: solo se aceptan las que existen en la carpeta fotos/
  const fotos = [];
  texto = texto.replace(MARCA_FOTO, (_m, clave) => {
    const k = clave.toLowerCase();
    if (fotosDisponibles.has(k) && !fotos.includes(k)) fotos.push(k);
    return "";
  });
  texto = texto.replace(MARCA_SUELTA, "").replace(/\n{3,}/g, "\n\n").trim();
  return { texto, pedido, derivar, fotos: fotos.slice(0, MAX_FOTOS) };
}

// Para no avisar muchas veces por la misma conversacion
const derivaciones = new Map();
const ESPERA_ENTRE_AVISOS_MS = 30 * 60 * 1000;

async function avisarDerivacion(numeroCliente, motivo) {
  if (!OWNER_WHATSAPP_NUMBER) {
    console.error("Cliente derivado pero falta OWNER_WHATSAPP_NUMBER. Motivo:", motivo);
    return;
  }
  ultimoAviso = { numero: numeroCliente, ts: Date.now() };
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
  ultimoAviso = { numero: numeroCliente, ts: Date.now() };
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

async function enviarA(destino, contenido) {
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: destino,
      ...contenido,
    }),
  });
}

async function enviarContenido(numero, contenido) {
  for (const destino of variantesNumero(numero)) {
    const r = await enviarA(destino, contenido);
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

async function enviar(numero, texto) {
  return enviarContenido(numero, { type: "text", text: { body: texto } });
}

async function enviarFoto(numero, clave) {
  return enviarContenido(numero, {
    type: "image",
    image: { link: `${PUBLIC_BASE_URL}/fotos/${clave}.jpg` },
  });
}

app.listen(PORT, () => console.log(`NexoAI WhatsApp escuchando en el puerto ${PORT}`));
