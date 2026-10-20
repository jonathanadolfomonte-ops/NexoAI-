// Lógica pura aislada para pruebas. Este módulo NO está conectado a server.js.
 // Integrarlo al servidor requiere una revisión y autorización separadas.
export function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function routeMessage(sender, personalNumber) {
  const personal = normalizePhone(personalNumber);
  const normalizedSender = normalizePhone(sender);
  return personal && normalizedSender === personal ? "personal" : "comercial";
}

// Añade un turno y limita el historial a un máximo de pares user/assistant.
// Evita dejar un mensaje assistant huérfano al recortar.
export function appendTurn(history, userText, assistantText, maxPairs = 5) {
  const next = [...history, { role: "user", content: String(userText) }];
  if (assistantText !== undefined && assistantText !== null) {
    next.push({ role: "assistant", content: String(assistantText) });
  }

  const safeMaxPairs = Math.max(1, Math.floor(Number(maxPairs) || 1);
  while (next.length > safeMaxPairs * 2) next.shift();
  if (next[0]?.role === "assistant") next.shift();
  return next;
}

export function shouldIgnoreEcho(echoId, sentIds) {
  return Boolean(echoId) && sentIds instanceof Set && sentIds.has(echoId);
}

// Devuelve true si la pausa sigue vigente; no modifica mapas ni relojes globales.
export function isPaused(untilTimestamp, nowTimestamp = Date.now()) {
  return Number.isFinite(untilTimestamp) && untilTimestamp > nowTimestamp;
}

// Extrae texto de una respuesta compatible con el formato de chat completions.
export function extractGroqText(response) {
  const content = response?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

// Serializa operaciones por clave sin bloquear conversaciones de otras claves.
// La promesa rechazada no deja bloqueada la siguiente operación.
const queues = new Map();
export function serializeByKey(key, operation) {
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.finally(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  queues.set(key, tail);
  return current;
}
