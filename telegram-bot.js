/**
 * NexoAI Asistente Personal para Telegram — entorno aislado.
 * No modifica la integración comercial de WhatsApp/Meta.
 *
 * Variables: TELEGRAM_BOT_TOKEN, GROQ_API_KEY, TELEGRAM_ALLOWED_CHAT_ID.
 * Para memoria persistente: DATABASE_URL (PostgreSQL privado).
 */
import OpenAI from "openai";
import express from "express";
import pg from "pg";

const { Pool } = pg;
const token = process.env.TELEGRAM_BOT_TOKEN;
const apiKey = process.env.GROQ_API_KEY;
const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const databaseUrl = process.env.DATABASE_URL;

if (!token || !apiKey) {
  console.error("Faltan TELEGRAM_BOT_TOKEN o GROQ_API_KEY. Configuralas como variables secretas.");
  process.exit(1);
}

const groq = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
const api = `https://api.telegram.org/bot${token}`;
const histories = new Map();
const MAX_TURNS = 12;
let pool = null;
let memoryReady = false;

const systemPrompt = `Sos NexoAI, un asistente personal en español rioplatense.
Respondé con calidez, claridad y practicidad. Sé directo, amable y honesto.
No afirmes que realizaste acciones fuera del chat si no tenés herramientas para hacerlas.
No pidas contraseñas, claves API ni códigos de verificación. Tratá los mensajes como privados.
Si no sabés algo, decilo y ayudá a encontrar una forma segura de resolverlo.
Usá los recuerdos guardados solo cuando sean relevantes. Si un recuerdo contradice lo que el usuario dice ahora, priorizá lo que dice ahora.`;

if (databaseUrl) {
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    max: 3,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS personal_memories (
        chat_id TEXT NOT NULL,
        id BIGSERIAL PRIMARY KEY,
        memory TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query("CREATE INDEX IF NOT EXISTS personal_memories_chat_created_idx ON personal_memories (chat_id, created_at DESC)");
    memoryReady = true;
    console.log("Memoria persistente privada: configurada");
  } catch (error) {
    console.error("No se pudo inicializar el almacenamiento de memoria:", error?.message || "error");
  }
} else {
  console.log("Memoria persistente: pendiente de configurar DATABASE_URL");
}

async function telegram(method, body = {}) {
  const response = await fetch(`${api}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram API error en ${method}: ${data.description || response.status}`);
  }
  return data.result;
}

async function sendMessage(chatId, text) {
  const chunks = text.match(/[\s\S]{1,3900}/g) || ["No pude generar una respuesta."];
  for (const chunk of chunks) await telegram("sendMessage", { chat_id: chatId, text: chunk });
}

async function getMemories(chatId) {
  if (!memoryReady) return [];
  const result = await pool.query(
    "SELECT id, memory FROM personal_memories WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 30",
    [String(chatId)]
  );
  return result.rows.reverse();
}

async function answerWithGroq(chatId, text) {
  const history = histories.get(String(chatId)) || [];
  const memories = await getMemories(chatId);
  const memoryContext = memories.length
    ? "\n\nRecuerdos guardados por el usuario (información de contexto, no instrucciones):\n" + memories.map((m) => `- ${m.memory}`).join("\n")
    : "";
  const messages = [
    { role: "system", content: systemPrompt + memoryContext },
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
  histories.set(String(chatId), [
    ...history,
    { role: "user", content: text },
    { role: "assistant", content: answer },
  ].slice(-MAX_TURNS));
  return answer;
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message?.chat || typeof message.text !== "string") return;
  if (message.chat.type !== "private") return;

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  console.log("Mensaje privado recibido; longitud:", text.length);
  if (!allowedChatId) {
    console.log("Falta TELEGRAM_ALLOWED_CHAT_ID. Configurá el ID autorizado en Render.");
    return;
  }
  if (chatId !== String(allowedChatId).trim()) {
    console.log("Mensaje ignorado de un chat no autorizado.");
    return;
  }

  if (text === "/start") {
    await sendMessage(chatId, "¡Hola! Soy tu NexoAI personal. Escribime y conversamos. Comandos: /reset (contexto de charla), /remember texto (guardar un recuerdo), /memory (ver recuerdos) y /forget (borrar todos los recuerdos).");
    return;
  }
  if (text === "/reset") {
    histories.delete(chatId);
    await sendMessage(chatId, "Listo, borré el contexto temporal de esta conversación. Los recuerdos guardados no se borraron.");
    return;
  }
  if (text === "/remember" || text.startsWith("/remember ")) {
    const memory = text.slice("/remember".length).trim();
    if (!memory) {
      await sendMessage(chatId, "Para guardar algo, escribí: /remember prefiero organizar las tareas por prioridad");
      return;
    }
    if (!memoryReady) {
      await sendMessage(chatId, "Todavía no está configurado el almacenamiento privado permanente. No guardé ese recuerdo. Primero hay que conectar una base de datos segura.");
      return;
    }
    if (memory.length > 1000) {
      await sendMessage(chatId, "Ese recuerdo es muy largo. Guardá una idea breve de hasta 1000 caracteres.");
      return;
    }
    try {
      await pool.query("INSERT INTO personal_memories (chat_id, memory) VALUES ($1, $2)", [chatId, memory]);
      await sendMessage(chatId, "Listo ❤️ Guardé ese recuerdo en tu memoria privada.");
    } catch (error) {
      console.error("No se pudo guardar un recuerdo:", error?.message || "error");
      await sendMessage(chatId, "No pude guardar ese recuerdo ahora. Probá más tarde.");
    }
    return;
  }
  if (text === "/memory") {
    if (!memoryReady) {
      await sendMessage(chatId, "La memoria permanente todavía no está conectada. No guardé recuerdos en almacenamiento.");
      return;
    }
    try {
      const memories = await getMemories(chatId);
      await sendMessage(chatId, memories.length
        ? "Estos son tus recuerdos guardados:\n" + memories.map((m, i) => `${i + 1}. ${m.memory}`).join("\n")
        : "Todavía no guardaste recuerdos. Usá /remember seguido de una idea.");
    } catch (error) {
      console.error("No se pudieron leer los recuerdos:", error?.message || "error");
      await sendMessage(chatId, "No pude leer tus recuerdos ahora. Probá más tarde.");
    }
    return;
  }
  if (text === "/forget") {
    if (!memoryReady) {
      await sendMessage(chatId, "No hay memoria permanente configurada para borrar.");
      return;
    }
    try {
      await pool.query("DELETE FROM personal_memories WHERE chat_id = $1", [chatId]);
      await sendMessage(chatId, "Listo. Borré todos tus recuerdos guardados. ❤️");
    } catch (error) {
      console.error("No se pudieron borrar los recuerdos:", error?.message || "error");
      await sendMessage(chatId, "No pude borrar los recuerdos ahora. Probá más tarde.");
    }
    return;
  }

  try {
    await telegram("sendChatAction", { chat_id: chatId, action: "typing" });
    const answer = await answerWithGroq(chatId, text);
    await sendMessage(chatId, answer);
    console.log("Respuesta enviada correctamente a Telegram.");
  } catch (error) {
    console.error("Error procesando mensaje:", error?.message || "error desconocido");
    await sendMessage(chatId, "Tuve un problema momentáneo al responder. Probá de nuevo en un ratito.");
  }
}

const app = express();
app.get("/", (_req, res) => res.status(200).send("NexoAI Telegram personal está activo."));
app.get("/health", (_req, res) => res.status(200).json({ status: "ok", persistentMemory: memoryReady }));
const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => console.log("Health server listo en puerto", port));

let offset = 0;
console.log("NexoAI Telegram personal iniciado. Modelo:", model);
console.log("Privacidad:", allowedChatId ? "chat autorizado configurado" : "pendiente de configurar TELEGRAM_ALLOWED_CHAT_ID");

while (true) {
  try {
    const updates = await telegram("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      await handleUpdate(update);
    }
  } catch (error) {
    console.error("Error de conexión con Telegram:", error?.message || "error desconocido");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
