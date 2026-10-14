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
 * Ejecución:
 *   npm install
 *   GROQ_API_KEY="tu_clave" node test-groq.js
 *
 * En Windows PowerShell:
 *   $env:GROQ_API_KEY="tu_clave"; node test-groq.js
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
        role: "system",
        content: "Respondé en español rioplatense, con una frase breve y clara.",
      },
      {
        role: "user",
        content: "Respondé exactamente: Prueba de Groq exitosa.",
      },
    ],
    temperature: 0,
    max_tokens: 40,
  });

  const answer = response.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    console.error("Groq respondió, pero no devolvió texto. Revisá el modelo y la respuesta de la API.");
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
