// Preload exclusivo de pruebas: intercepta las salidas externas del servidor.
import fs from "node:fs";

const logPath = process.env.TEST_OUTBOUND_LOG;
if (!logPath) throw new Error("TEST_OUTBOUND_LOG es obligatorio para bloquear las salidas externas.");

function record(entry) {
  fs.appendFileSync(logPath, JSON.stringify({ at: Date.now(), ...entry }) + "\n", "utf8");
}
function bodyAsJson(body) {
  if (typeof body !== "string") return null;
  try { return JSON.parse(body); } catch { return { unparsed: true }; }
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  const method = String(init.method || input?.method || "GET").toUpperCase();
  const body = bodyAsJson(init.body);

  if (url.startsWith("https://api.groq.com/openai/v1/")) {
    record({ kind: "groq", url, method, body });
    if (process.env.TEST_GROQ_MODE === "error") {
      return new Response(JSON.stringify({
        error: { message: "Fallo Groq simulado", type: "invalid_request_error", code: "test_error" }
      }), { status: 400, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "chatcmpl-test", object: "chat.completion", created: 0, model: "test-model",
      choices: [{ index: 0, message: { role: "assistant", content: "RESPUESTA_GROQ_SIMULADA" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (url.startsWith("https://api.anthropic.com/")) {
    record({ kind: "claude", url, method, body });
    if (process.env.TEST_CLAUDE_MODE === "error") {
      return new Response(JSON.stringify({
        type: "error", error: { type: "api_error", message: "Fallo Claude simulado" }
      }), { status: 500, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "test-model",
      content: [{ type: "text", text: "RESPUESTA_CLAUDE_SIMULADA" }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (url.startsWith("https://graph.facebook.com/")) {
    const existing = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).length
      : 0;
    record({ kind: "whatsapp", url, method, body });
    return new Response(JSON.stringify({
      messaging_product: "whatsapp", contacts: [], messages: [{ id: "wamid.TEST_" + (existing + 1) }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  record({ kind: "BLOCKED_UNEXPECTED_URL", url, method });
  throw new Error("Prueba aislada bloqueó una solicitud externa no autorizada: " + url);
};
