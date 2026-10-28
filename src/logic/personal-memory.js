// Helpers aislados para la memoria personal de Lindsy.
// No se conecta al servidor ni a PostgreSQL todavía.
export function conversationKey(sender) {
  const normalized = String(sender ?? "").replace(/\D/g, "");
  if (!normalized) throw new Error("El remitente no es válido");
  return `whatsapp:${normalized}`;
}

export function trimConversationHistory(history, maxPairs = 10) {
  if (!Array.isArray(history)) return [];
  const limit = Math.max(1, Math.floor(Number(maxPairs) || 1)) * 2;
  const valid = history.filter(
    (turn) =>
      turn &&
      (turn.role === "user" || turn.role === "assistant") &&
      typeof turn.content === "string" &&
      turn.content.trim().length > 0
  );
  const bounded = valid.slice(-limit);
  if (bounded[0]?.role === "assistant") bounded.shift();
  return bounded;
}

export function normalizeIncomingAudio(message) {
  if (!message || typeof message !== "object") {
    return { ok: false, reason: "invalid_message" };
  }
  if (message.type !== "audio") {
    return { ok: false, reason: "not_audio" };
  }
  const mediaId = message.audio?.id;
  if (typeof mediaId !== "string" || !mediaId.trim()) {
    return { ok: false, reason: "missing_media_id" };
  }
  return {
    ok: true,
    mediaId: mediaId.trim(),
    mimeType: typeof message.audio?.mime_type === "string"
      ? message.audio.mime_type
      : null,
    messageId: typeof message.id === "string" ? message.id : null
  };
}

export function isDuplicateWebhookMessage(messageId, seenIds) {
  return Boolean(
    typeof messageId === "string" &&
    messageId.length > 0 &&
    seenIds instanceof Set &&
    seenIds.has(messageId)
  );
}
