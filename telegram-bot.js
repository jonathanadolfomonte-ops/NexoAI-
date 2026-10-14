/**
 * NexoAI Asistente Personal para Telegram — entorno aislado.
 * Este archivo no importa ni modifica la integración de WhatsApp/Meta.
 *
 * Variables obligatorias:
 *   TELEGRAM_BOT_TOKEN
 *   GROQ_API_KEY
 *   TELEGRAM_ALLOWED_CHAT_ID (recomendado/obligatorio para uso privado)
 * Variable opcional:
 *   GROQ_MODEL (por defecto openai/gpt-oss-20b)
 */
import OpenAI from "openai";
import express from "express";

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiKey = process.env.GROQ_API_KEY;
const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

if (!token || !apiKey) {
  console.error("Faltan TELEGRAM_BOT_TOKEN o GROQ_API_KEY. Configuralas como variables secretas.");
  process.exit(1);
}

const groq = new OpenAI({
  apiKey,
  baseURL: "https://api.groq.com/openai/v1",
});
const api = `https://api.telegram.org/bot${token}`;
const histories = new Map();
const MAX_TURNS = 12;

const systemPrompt = `Sos NexoAI, un asistente personal en español rioplatense.
Respondé con calidez, claridad y practicidad. Sé directo, amable y honesto.
No afirmes que realizaste acciones fuera del chat si no tenés herramientas para hacerlas.
No pidas contraseñas, claves API ni códigos de verificación. Tratá los mensajes como privados.
Si no sabés algo, decilo y ayudá a encontrar una forma segura de resolverlo.`;

async function telegram(method, body = {}) {
  const response = await fetch(`${api}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram API error en ${method}: ${data.description || response.status}`);
  }
  return data.result;
}

async function sendMessage(chatId, text) {
  // Telegram limita los mensajes a 4096 caracteres; dividir con margen.
  const chunks = text.match(/[\s\S]{1,3900}/g) || ["No pude generar una respuesta."];
  for (const chunk of chunks) {
    await telegram("sendMessage", { chat_id: chatId, text: chunk });
  }
}

async function answerWithGroq(chatId, text) {
  const history = histories.get(String(chatId)) || [];
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: text },
  ];
  const response = await groq.chat.completions.create({
    model,
    messages,
    temperature: 0.6,
    max_completion_tokens: 1024,
    reasoning_effort: "low",
    include_reasoning: false,
  });
  const answer = response.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Groq no devolvió texto visible.");
  const nextHistory = [
    ...history,
    { role: "user", content: text },
    { role: "assistant", content: answer },
  ].slice(-MAX_TURNS);
  histories.set(String(chatId), nextHistory);
  return answer;
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message?.chat || typeof message.text !== "string") return;
  if (message.chat.type !== "private") return;

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  // Nunca registrar mensajes, tokens ni contenido privado.
  if (!allowedChatId) {
    console.log("Falta TELEGRAM_ALLOWED_CHAT_ID. Se detectó un chat privado; configurá el ID autorizado en Render.");
    return;
  }
  if (chatId !== String(allowedChatId).trim()) {
    console.log("Mensaje ignorado de un chat no autorizado.");
    return;
  }

  if (text === "/start") {
    await sendMessage(chatId, "¡Hola! Soy tu NexoAI personal. Ya estoy conectado a Telegram. Escribime y conversamos. Usá /reset para borrar el contexto de esta conversación.");
    return;
  }
  if (text === "/reset") {
    histories.delete(chatId);
    await sendMessage(chatId, "Listo, borré el contexto de esta conversación en memoria.");
    return;
  }

  try {
    await telegram("sendChatAction", { chat_id: chatId, action: "typing" });
    const answer = await answerWithGroq(chatId, text);
    await sendMessage(chatId, answer);
  } catch (error) {
    console.error("Error procesando mensaje:", error?.message || "error desconocido");
    await sendMessage(chatId, "Tuve un problema momentáneo al responder. Probá de nuevo en un ratito.");
  }
}

const app = express();
app.get("/", (_req, res) => res.status(200).send("NexoAI Telegram personal está activo."));
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => console.log("Health server listo en puerto", port));

let offset = 0;
console.log("NexoAI Telegram personal iniciado. Modelo:", model);
console.log("Privacidad:", allowedChatId ? "chat autorizado configurado" : "pendiente de configurar TELEGRAM_ALLOWED_CHAT_ID");

while (true) {
  try {
    const updates = await telegram("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message"],
    });
    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      await handleUpdate(update);
    }
  } catch (error) {
    console.error("Error de conexión con Telegram:", error?.message || "error desconocido");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
