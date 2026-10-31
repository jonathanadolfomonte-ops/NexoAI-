// Respuestas de voz de Lindsy: texto -> audio (OpenAI TTS, formato opus) -> nota de voz de WhatsApp.
// Se activa solo si existe OPENAI_API_KEY; si algo falla, el que llama manda el texto normal.
const { OPENAI_API_KEY, OPENAI_TTS_MODEL = "tts-1", OPENAI_TTS_VOICE = "nova" } = process.env;
const MAX_CARACTERES = 700;

export const vozActiva = () => Boolean(OPENAI_API_KEY);

// Deja el texto lindo para leerlo en voz alta.
export function textoParaVoz(texto) {
  return String(texto || "")
    .replace(/https?:\/\/\S+/g, "el enlace que te dejo por escrito")
    .replace(/[*_~`#>]/g, "")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CARACTERES);
}

export async function sintetizar(texto) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_TTS_MODEL, voice: OPENAI_TTS_VOICE, input: texto, response_format: "opus" }),
  });
  if (!r.ok) throw new Error(`OpenAI TTS ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error("audio vacío");
  return buf;
}

// Sube el audio a WhatsApp y lo manda como nota de voz. Devuelve true si WhatsApp lo aceptó.
export async function enviarNotaDeVoz({ numero, texto, phoneNumberId, token, apiVersion }) {
  if (!vozActiva()) return false;
  const hablado = textoParaVoz(texto);
  if (!hablado) return false;
  const audio = await sintetizar(hablado);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "audio/ogg");
  form.append("file", new Blob([audio], { type: "audio/ogg" }), "lindsy.ogg");
  const base = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;
  const up = await fetch(`${base}/media`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!up.ok) throw new Error(`subida de audio ${up.status}`);
  const { id } = await up.json();
  if (!id) throw new Error("WhatsApp no devolvió id de audio");
  const env = await fetch(`${base}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: numero, type: "audio", audio: { id } }),
  });
  if (!env.ok) throw new Error(`envío de audio ${env.status}`);
  return true;
}
