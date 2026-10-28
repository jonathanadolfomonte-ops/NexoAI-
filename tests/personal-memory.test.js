import test from "node:test";
import assert from "node:assert/strict";
import {
  conversationKey,
  trimConversationHistory,
  normalizeIncomingAudio,
  isDuplicateWebhookMessage
} from "../src/logic/personal-memory.js";

test("crea claves normalizadas y separadas por remitente", () => {
  assert.equal(conversationKey("+54 9 3873-123456"), "whatsapp:5493873123456");
  assert.notEqual(conversationKey("5491111111111"), conversationKey("5492222222222"));
  assert.throws(() => conversationKey(""), /remitente/);
});

test("limita el historial y evita empezar con respuesta huérfana", () => {
  const history = [
    { role: "user", content: "uno" },
    { role: "assistant", content: "respuesta uno" },
    { role: "user", content: "dos" },
    { role: "assistant", content: "respuesta dos" },
    { role: "user", content: "tres" },
    { role: "assistant", content: "respuesta tres" }
  ];
  assert.deepEqual(trimConversationHistory(history, 2), [
    { role: "user", content: "dos" },
    { role: "assistant", content: "respuesta dos" },
    { role: "user", content: "tres" },
    { role: "assistant", content: "respuesta tres" }
  ]);
});

test("descarta turnos inválidos y contenido vacío", () => {
  assert.deepEqual(trimConversationHistory([
    null,
    { role: "system", content: "no permitido" },
    { role: "user", content: "   " },
    { role: "user", content: "hola" }
  ]), [{ role: "user", content: "hola" }]);
});

test("acepta audio con identificador de media de Meta", () => {
  assert.deepEqual(normalizeIncomingAudio({
    id: "wamid.test",
    type: "audio",
    audio: { id: "media-123", mime_type: "audio/ogg" }
  }), {
    ok: true,
    mediaId: "media-123",
    mimeType: "audio/ogg",
    messageId: "wamid.test"
  });
});

test("rechaza audio sin media id y mensajes que no son audio", () => {
  assert.deepEqual(normalizeIncomingAudio({ type: "audio", audio: {} }), {
    ok: false, reason: "missing_media_id"
  });
  assert.deepEqual(normalizeIncomingAudio({ type: "text" }), {
    ok: false, reason: "not_audio"
  });
  assert.deepEqual(normalizeIncomingAudio(null), {
    ok: false, reason: "invalid_message"
  });
});

test("detecta webhooks repetidos solo con IDs conocidos", () => {
  const seen = new Set(["wamid.known"]);
  assert.equal(isDuplicateWebhookMessage("wamid.known", seen), true);
  assert.equal(isDuplicateWebhookMessage("wamid.new", seen), false);
  assert.equal(isDuplicateWebhookMessage("", seen), false);
});
