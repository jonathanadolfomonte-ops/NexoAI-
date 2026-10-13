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
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4.1-mini",
  OWNER_WHATSAPP_NUMBER,
  CLAUDE_MODEL = "claude-sonnet-5-5",
  WHATSAPP_API_VERSION = "v21.0",
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
// OpenAI es opcional para no interrumpir el servicio comercial si aún no está configurado.
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const numeroPropietario = String(OWNER_WHATSAPP_NUMBER || "").replace(/\\D/g, "");

// Memoria corta de cada conversacion (se borra si el servidor se reinicia)
const MAX_HISTORIAL = 10;
const historiales = new Map();
// Historial separado para la asistencia personal del propietario.
const historialesOpenAI = new Map();
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

  // Solo el número personal configurado usa OpenAI; los clientes siguen con Claude.
  const numeroNormalizado = String(numero || "").replace(/\\D/g, "");
  if (numeroPropietario && numeroNormalizado === numeroPropietario) {
    await procesarPersonalOpenAI(numero, m.text.body);
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

  if (!respuesta) respuesta = "Disculpá, no pude armar una respuesta. ¿Me lo repetís?";

  historial.push({ role: "assistant", content: respuesta });
  while (historial.length > MAX_HISTORIAL || historial[0]?.role !== "user") {
    historial.shift();
  }
  historiales.set(numero, historial);

  await enviar(numero, respuesta);
}

async function procesarPersonalOpenAI(numero, texto) {
  if (!openai) {
    await enviar(
      numero,
      "La asistencia personal con OpenAI todavía no está activada. Falta configurar su clave de API en el servidor; el servicio habitual de NexoAI sigue funcionando."
    );
    return;
  }

  const historial = historialesOpenAI.get(numero) || [];
  historial.push({ role: "user", content: texto });

  try {
    const r = await openai.responses.create({
      model: OPENAI_MODEL,
      instructions:
        "Sos un asistente personal útil, claro y cercano que conversa en español rioplatense. Ayudá al propietario con sus consultas y proyectos. No afirmes que sos la sesión de ChatGPT ni que tenés acceso a sus recuerdos o conversaciones fuera de este chat de WhatsApp. Si no sabés algo, decilo con honestidad.",
      input: historial,
      max_output_tokens: 500,
    });

    const respuesta = (r.output_text || "").trim() ||
      "No pude preparar una respuesta. ¿Podés volver a escribirme?";
    historial.push({ role: "assistant", content: respuesta });
    while (historial.length > MAX_HISTORIAL) historial.shift();
    if (historial[0]?.role === "assistant") historial.shift();
    historialesOpenAI.set(numero, historial);
    await enviar(numero, respuesta);
  } catch (err) {
    console.error("Error con OpenAI para asistencia personal:", err);
    historial.pop();
    historialesOpenAI.set(numero, historial);
    await enviar(
      numero,
      "La asistencia personal está teniendo un problema técnico. El servicio habitual de NexoAI para clientes sigue separado. Probá de nuevo más tarde."
    );
  }
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
