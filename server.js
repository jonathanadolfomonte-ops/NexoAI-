import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const {
  PORT = 3000,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_VERIFY_TOKEN,
  META_APP_SECRET,
  ANTHROPIC_API_KEY,
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

// Memoria corta de cada conversacion (se borra si el servidor se reinicia)
const MAX_HISTORIAL = 10;
const historiales = new Map();
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

async function enviar(numero, texto) {
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: numero,
      type: "text",
      text: { body: texto },
    }),
  });
  if (!r.ok) {
    console.error("Error enviando a WhatsApp:", r.status, await r.text());
  }
}

app.listen(PORT, () => console.log(`NexoAI WhatsApp escuchando en el puerto ${PORT}`));
