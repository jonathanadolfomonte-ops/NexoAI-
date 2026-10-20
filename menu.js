// Menu inicial: el cliente elige entre Moda Florencia (1) y Kiosco Mayra (2).
// Las funciones son puras (sin red ni estado) para poder probarlas solas.

export const NOMBRES = { florencia: "Moda Florencia", mayra: "Kiosco Mayra" };

// Primer mensaje (el saludo de siempre) y segundo mensaje (las opciones)
export const SALUDO =
  "¡Hola! Soy NexoAI, el asistente virtual de Moda Florencia y Kiosco Mayra. ¿En qué te puedo ayudar?";

const OPCIONES =
  "1️⃣ Moda Florencia (ropa y calzado de niños)\n" +
  "2️⃣ Kiosco Mayra (almacén, bebidas, golosinas, verduras, panificados y pollería)";

export const MENU = `¿Qué te interesa?\n\n${OPCIONES}\n\nRespondé con el *1* o el *2*.`;
export const MENU_REPETIDO = `Para ayudarte mejor, elegí una opción:\n\n${OPCIONES}\n\nRespondé con el *1* o el *2*.`;

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([12])\uFE0F?\u20E3/g, "$1") // 1️⃣ y 2️⃣ escritos como emoji
    .trim();
}

const RE_FLORENCIA =
  /\b(moda|florencia|ropa|ropita|calzados?|zapatillas?|zapatos?|botas?|ojotas?|sandalias?|remeras?|pantalon(es)?|camperas?|buzos?|vestidos?|conjuntos?|talles?|nenes?|nenas?|ninos?|ninas?|bebes?)\b/;
const RE_MAYRA =
  /\b(kiosco|kiosko|mayra|almacen|mercaderia|bebidas?|gaseosas?|coca|cervezas?|jugos?|sodas?|golosinas?|chocolates?|alfajor(es)?|verduras?|panificados?|pan|panes|facturas?|pollo|polleria|arroz|fideos|harina|aceite|azucar|yerba)\b/;

// Devuelve { negocio, soloOpcion }.
// - "1" o "2" solos cuentan solo si el menu esta esperando una respuesta
//   (si no, un "2" podria ser una cantidad dentro de un pedido).
// - Tambien se entiende por palabras: "ropa", "quiero pan", "Moda Florencia"...
// - Si nombra los dos negocios o ninguno, devuelve negocio null (se vuelve a preguntar).
export function detectarNegocio(texto, esperandoOpcion) {
  const t = normalizar(texto);
  if (esperandoOpcion) {
    if (/^(opcion\s*)?1[\s.!)]*$/.test(t)) return { negocio: "florencia", soloOpcion: true };
    if (/^(opcion\s*)?2[\s.!)]*$/.test(t)) return { negocio: "mayra", soloOpcion: true };
  }
  const f = RE_FLORENCIA.test(t);
  const m = RE_MAYRA.test(t);
  if (f && !m) return { negocio: "florencia", soloOpcion: false };
  if (m && !f) return { negocio: "mayra", soloOpcion: false };
  return { negocio: null, soloOpcion: false };
}

// Para volver al menu una vez elegido un negocio (solo palabras sueltas, nunca numeros)
export function esComandoMenu(texto) {
  return /^(menu|opciones|cambiar|volver|inicio|otro negocio)[\s.!]*$/.test(normalizar(texto));
}

// Se agrega a las instrucciones del bot segun el negocio que eligio el cliente
export function directiva(negocio) {
  const propio = NOMBRES[negocio];
  const otro = NOMBRES[negocio === "florencia" ? "mayra" : "florencia"];
  if (!propio) return "";
  return (
    `\n\n## Negocio elegido por el cliente\n` +
    `El cliente ya eligió ${propio} en el menú inicial. En esta conversación hablá solo de ${propio}: ` +
    `no ofrezcas ni menciones ${otro}. No vuelvas a saludar ni a presentarte (el saludo y el menú los manda el sistema). ` +
    `Si el cliente pregunta por ${otro} o quiere cambiar, decile que escriba la palabra "menú" para elegir de nuevo.`
  );
}
