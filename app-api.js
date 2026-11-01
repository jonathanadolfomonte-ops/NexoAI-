import crypto from "node:crypto";
import { manejarAgenda } from "./agenda.js";

// Acceso de la app Lindsy ProMax (Android) al cerebro de Lindsy.
// Protegido con LINDSY_APP_TOKEN (clave larga que solo tienen el servidor y la app).
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();

export function tokenValido(cabecera, esperado) {
  if (!esperado) return false;
  const m = /^Bearer\s+(.+)$/i.exec(String(cabecera || ""));
  if (!m) return false;
  return crypto.timingSafeEqual(hash(m[1]), hash(esperado));
}

export function registrarApiApp(app, { groq, modelo, instrucciones }) {
  const TOKEN = process.env.LINDSY_APP_TOKEN;
  const historial = [];
  const MAX = 10;
  let ventana = { inicio: Date.now(), n: 0 };

  const autorizar = (req, res) => {
    if (!TOKEN || TOKEN.length < 24) { res.status(503).json({ error: "La app todavía no está habilitada en el servidor." }); return false; }
    if (Date.now() - ventana.inicio > 60000) ventana = { inicio: Date.now(), n: 0 };
    if (++ventana.n > 60) { res.status(429).json({ error: "Demasiados pedidos, esperá un minuto." }); return false; }
    if (!tokenValido(req.headers.authorization, TOKEN)) { res.status(401).json({ error: "Clave incorrecta." }); return false; }
    return true;
  };

  app.get("/api/lindsy/ping", (req, res) => {
    if (!autorizar(req, res)) return;
    res.json({ ok: true });
  });

  app.post("/api/lindsy", async (req, res) => {
    if (!autorizar(req, res)) return;
    const texto = String(req.body?.texto || "").trim().slice(0, 1000);
    if (!texto) return res.status(400).json({ error: "Falta el texto." });
    try {
      const agenda = manejarAgenda(texto);
      if (agenda) return res.json({ respuesta: agenda.replace(/[*_]/g, "").replace(/[\u2705\u{1F300}-\u{1FAFF}]/gu, "").trim() });
      if (!groq) return res.json({ respuesta: "Todavía no tengo mi cerebro activado en el servidor." });
      historial.push({ role: "user", content: texto });
      while (historial.length > MAX) historial.shift();
      const r = await groq.chat.completions.create({
        model: modelo,
        messages: [
          { role: "system", content: String(instrucciones()) + "\n\nEstás hablando por voz con Jonathan en la app Lindsy ProMax. Respondé corto (1 a 3 frases), natural, sin markdown, sin listas y sin emojis." },
          ...historial,
        ],
        max_tokens: 400,
      });
      const respuesta = String(r.choices?.[0]?.message?.content || "").trim() || "No pude pensar una respuesta. ¿Me lo repetís?";
      historial.push({ role: "assistant", content: respuesta });
      while (historial.length > MAX) historial.shift();
      res.json({ respuesta });
    } catch (err) {
      console.error("Error en /api/lindsy:", err.message);
      historial.pop();
      res.status(500).json({ error: "Tuve un problema técnico. Probá de nuevo." });
    }
  });
}
