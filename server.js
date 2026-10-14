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
  CLAUDE_MODEL = "claude-sonnet-5-5",
  WHATSAPP_API_VERSION = "v21.0",
  // Numero del dueño que recibe el aviso de cada pedido confirmado (formato 549 + area + numero, sin + ni 15)
  OWNER_WHATSAPP_NUMBER,
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
// El asistente personal usa Groq solo si se configura su clave; no afecta el flujo comercial.
const groq = GROQ_API_KEY
  ? new OpenAI({ apiKey: GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" })
  : null;
const numeroPersonal = String(PERSONAL_WHATSAPP_NUMBER || "").replace(/\D/g, "");

// Memoria corta de cada conversacion (se borra si el servidor se reinicia)
const MAX_HISTORIAL = 10;
const historiales = new Map();
// Memoria independiente para el asistente personal.
const historialesPersonal = new Map();
const vistos = new Set();

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/", (_req, res) => res.send("NexoAI WhatsApp activo"));

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

  const mensajes = (req.body.entry || [])
    .flatMap((e) => e.changes || [])
    .flatMap((c) => c.value?.messages || []);

  console.log("Mensajes recibidos:", mensajes.length);
  for (const m of mensajes) {
    procesar(m).catch((err) => console.error("Error procesando mensaje:", err));
  }
});

async function procesar(m) {
  if (vistos.has(m.id)) return;
  vistos.add(m.id);
  if (vistos.size > 1000) vistos.clear();

  const numero = m.from;

  if (m.type !== "text") {
    await enviar(numero, "Por ahora solo puedo leer mensajes de texto. ¿Me escribís tu consulta?");
    return;
  }

  // Solo el número personal configurado usa Groq; los clientes siguen usando Claude.
  const numeroNormalizado = String(numero || "").replace(/\D/g, "");
  if (numeroPersonal && numeroNormalizado === numeroPersonal) {
    await procesarAsistentePersonal(numero, m.text.body);
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

  await enviar(numero, respuesta);
}

// Asistente personal separado: si Groq falla, nunca deriva el mensaje a Claude.
async function procesarAsistentePersonal(numero, texto) {
  if (!groq) {
    await enviar(
      numero,
      "Tu asistente personal todavía no está activado. Falta configurar GROQ_API_KEY en Render. La atención habitual de NexoAI para clientes sigue funcionando con normalidad."
    );
    return;
  }

  const historial = historialesPersonal.get(numero) || [];
  historial.push({ role: "user", content: texto });

  try {
    const r = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: "Sos un asistente personal útil, claro, cálido y directo que conversa en español rioplatense. Ayudá al propietario con consultas, ideas y proyectos. Respondé siempre con sinceridad y de forma práctica: ofrecé pasos concretos, ejemplos y, cuando corresponda, opciones para elegir. No afirmes ser una persona ni afirmes tener acceso directo a recursos externos; indicá siempre tus limitaciones técnicas. Mantené la confidencialidad: no compartas claves, datos personales ni información sensible. Si el pedido requiere acciones fuera del chat (llamadas, envíos reales), informá claramente que no podés ejecutarlas y ofrecé instrucciones para que el propietario lo haga. Preferí respuestas breves y accionables, y preguntá aclaraciones cuando la consulta sea ambigua.",
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
    await enviar(numero, respuesta);
  } catch (err) {
    console.error("Error con Groq para asistencia personal:", err);
    historial.pop();
    historialesPersonal.set(numero, historial);
    await enviar(
      numero,
      "Tu asistente personal tuvo un problema técnico y no pudo responder. Probá de nuevo más tarde. La atención de clientes de NexoAI sigue separada y funcionando con Claude."
    );
  }
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

async function enviarA(destino, texto) {
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
      type: "text",
      text: { body: texto },
    }),
  });
}

async function enviar(numero, texto) {
  for (const destino of variantesNumero(numero)) {
    const r = await enviarA(destino, texto);
    if (r.ok) {
      console.log(`Mensaje enviado a ${destino}${destino !== numero ? ` (formato alternativo; Meta lo recibio como ${numero})` : ""}`);
      return;
    }
    const cuerpo = await r.text();
    console.error(`Error enviando a WhatsApp (destino ${destino}):`, r.status, cuerpo);
    if (!cuerpo.includes("131030")) return; // otro error: no tiene sentido probar otros formatos
  }
}

app.listen(PORT, () => console.log(`NexoAI WhatsApp escuchando en el puerto ${PORT}`));
