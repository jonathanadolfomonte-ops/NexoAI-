// Arnés aislado de integración para pruebas con proveedores y envío simulados.
// No se importa desde server.js y nunca realiza solicitudes de red.
import { routeMessage } from "../logic/nexoai-core.js";

export async function simulateIncomingMessage({ sender, text, personalNumber, groq, claude, send }) {
  const route = routeMessage(sender, personalNumber);
  if (route === "personal") {
    if (!groq) {
      await send(sender, "El asistente personal todavía no está activado. Falta configurar GROQ_API_KEY. La atención habitual de NexoAI permanece separada.");
      return { route, provider: null, status: "personal-disabled" };
    }
    try {
      const response = String((await groq.respond(text)) ?? "").trim();
      await send(sender, response || "No pude preparar una respuesta. ¿Podés volver a escribirme?");
      return { route, provider: "groq", status: "ok" };
    } catch {
      await send(sender, "Tu asistente personal tuvo un problema técnico. Probá de nuevo más tarde; la atención comercial de NexoAI sigue por su flujo habitual.");
      return { route, provider: "groq", status: "provider-error" };
    }
  }
  try {
    const response = String((await claude.respond(text)) ?? "").trim();
    await send(sender, response || "Disculpá, no pude armar una respuesta. ¿Me lo repetís?");
    return { route, provider: "claude", status: "ok" };
  } catch {
    await send(sender, "Disculpá, tuve un problema técnico. ¿Podés escribirme de nuevo en un rato?");
    return { route, provider: "claude", status: "provider-error" };
  }
}
