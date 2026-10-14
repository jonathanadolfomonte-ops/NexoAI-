/**
 * Prueba aislada de conexión con Groq.
 *
 * No importa server.js, Express, Anthropic ni Meta/WhatsApp.
 * No modifica ni inicia el bot comercial.
 *
 * Requisitos: Node.js 20+ y la dependencia "openai" instalada.
 * Variables:
 *   GROQ_API_KEY   (obligatoria; guardarla como variable de entorno, nunca en el código)
 *   GROQ_MODEL     (opcional; por defecto openai/gpt-oss-20b)
 *
 * Nunca pegues la clave en GitHub, mensajes ni capturas.
 */

import OpenAI from "openai";

const apiKey = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

if (!apiKey) {
  console.error("Falta GROQ_API_KEY. Configurala como variable de entorno; no la escribas en este archivo.");
  process.exit(1);
}

const groq = new OpenAI({
  apiKey,
  baseURL: "https://api.groq.com/openai/v1",
});

try {
  const response = await groq.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: "Respondé exactamente: Prueba de Groq exitosa.",
      },
    ],
    temperature: 0,
    max_completion_tokens: 1024,
    reasoning_effort: "low",
    include_reasoning: false,
  });

  const choice = response.choices?.[0];
  const answer = typeof choice?.message?.content === "string"
    ? choice.message.content.trim()
    : "";

  if (!answer) {
    console.error("Groq aceptó la solicitud, pero no devolvió texto visible.");
    console.error("Modelo informado:", response.model || model);
    console.error("Motivo de finalización:", choice?.finish_reason || "no informado");
    console.error("Tokens de salida:", response.usage?.completion_tokens ?? "no informados");
    console.error("La clave API no se muestra.");
    process.exit(2);
  }

  console.log("CONEXIÓN CON GROQ: OK");
  console.log("Modelo:", response.model || model);
  console.log("Respuesta:", answer);
} catch (error) {
  console.error("FALLÓ LA PRUEBA DE GROQ.");
  console.error("Tipo:", error?.name || "Error");
  console.error("Mensaje:", error?.message || "Error sin detalle");
  console.error("No se muestra la clave API.");
  process.exit(1);
}
