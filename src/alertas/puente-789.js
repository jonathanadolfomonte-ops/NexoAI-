import crypto from "node:crypto";

const CATEGORIAS = new Set([
  "emergencia_medica",
  "peligro_fisico",
  "violencia",
  "otra_urgencia_grave",
]);

function compararSecretos(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function limpiarDetalle(valor) {
  return String(valor || "")
    .replace(/[\\r\\n\\t]+/g, " ")
    .replace(/[\\u0000-\\u001F\\u007F]/g, "")
    .trim()
    .slice(0, 280);
}

/**
 * Crea un handler aislado para POST /api/alertas/emergencia.
 * No lee secretos globales: toda configuración se inyecta explícitamente.
 * Por defecto trabaja en simulación; nunca envía mensajes reales por defecto.
 */
export function crearPuenteAlertas({
  tokenServicio,
  metaToken,
  phoneNumberId789,
  destinatario,
  versionApi = "v21.0",
  habilitarEnvioReal = false,
  fetchImpl = globalThis.fetch,
  ahora = () => Date.now(),
  ttlDedupeMs = 24 * 60 * 60 * 1000,
} = {}) {
  const eventos = new Map();

  return async function manejarAlerta(req, res) {
    const auth = req.headers?.authorization || "";
    const match = /^Bearer\\s+(.+)$/i.exec(String(auth));
    if (!match || !compararSecretos(match[1], tokenServicio)) {
      return res.status(401).json({ error: "No autorizado." });
    }

    const eventId = String(req.body?.event_id || "").trim();
    const categoria = String(req.body?.categoria || "").trim();
    const detalle = limpiarDetalle(req.body?.detalle);

    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(eventId)) {
      return res.status(400).json({ error: "event_id inválido." });
    }
    if (!CATEGORIAS.has(categoria)) {
      return res.status(400).json({ error: "Categoría de emergencia inválida." });
    }

    const ahoraMs = ahora();
    for (const [id, marca] of eventos) {
      if (ahoraMs - marca >= ttlDedupeMs) eventos.delete(id);
    }
    if (eventos.has(eventId)) {
      return res.status(200).json({ ok: true, duplicada: true, event_id: eventId });
    }

    if (!habilitarEnvioReal) {
      eventos.set(eventId, ahoraMs);
      return res.status(202).json({
        ok: true,
        modo: "simulacion",
        event_id: eventId,
        destino_configurado: Boolean(destinatario),
        emisor_configurado: Boolean(phoneNumberId789),
      });
    }

    if (!tokenServicio || !metaToken || !phoneNumberId789 || !/^\\d{8,24}$/.test(String(destinatario || ""))) {
      return res.status(503).json({ error: "Configuración de envío incompleta." });
    }
    if (typeof fetchImpl !== "function") {
      return res.status(503).json({ error: "Cliente HTTP no disponible." });
    }

    const texto = [
      "🚨 ALERTA URGENTE DE LINDSY",
      "Se detectó una posible emergencia que requiere tu atención.",
      "Tipo: " + categoria.replace(/_/g, " "),
      detalle ? "Detalle: " + detalle : "",
    ].filter(Boolean).join("\\n");

    let respuesta;
    try {
      respuesta = await fetchImpl(
        `https://graph.facebook.com/${versionApi}/${phoneNumberId789}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${metaToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: String(destinatario),
            type: "text",
            text: { body: texto },
          }),
        },
      );
    } catch {
      return res.status(502).json({ error: "No se pudo conectar con WhatsApp." });
    }

    if (!respuesta?.ok) {
      return res.status(502).json({ error: "WhatsApp rechazó el envío." });
    }

    eventos.set(eventId, ahoraMs);
    return res.status(200).json({ ok: true, enviado: true, event_id: eventId });
  };
}
