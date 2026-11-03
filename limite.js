// Limite de mensajes por numero (solo para desconocidos; el dueno queda exento).
const porNumero = new Map();
let global = { desde: Date.now(), n: 0, avisado: false };

export function limitePorNumero(numero, { max = 10, maxGlobal = 60, ventanaMs = 60 * 60 * 1000 } = {}) {
  const ahora = Date.now();
  if (ahora - global.desde > ventanaMs) global = { desde: ahora, n: 0, avisado: false };
  for (const [k, v] of porNumero) if (ahora - v.desde > ventanaMs) porNumero.delete(k);

  let e = porNumero.get(numero);
  if (!e) { e = { desde: ahora, n: 0, avisado: false }; porNumero.set(numero, e); }
  e.n++; global.n++;

  if (e.n > max) {
    const avisar = !e.avisado; e.avisado = true;
    return { permitido: false, avisar, motivo: "numero" };
  }
  if (global.n > maxGlobal) {
    const avisar = !e.avisado; e.avisado = true;
    return { permitido: false, avisar, motivo: "global" };
  }
  return { permitido: true, avisar: false };
}
