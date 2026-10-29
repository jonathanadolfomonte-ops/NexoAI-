// Menu inicial: el cliente elige entre los negocios del cliente (clientes/<CLIENTE>/negocio.json).
// Si hay un solo negocio no hay menu: el bot saluda y sigue directo.
// Las funciones son puras (sin red ni estado) para poder probarlas solas.
import { config } from "./config.js";

export const NEGOCIOS = config.negocios;
export const UNICO = NEGOCIOS.length === 1;
export const NOMBRES = Object.fromEntries(NEGOCIOS.map((n) => [n.id, n.nombre]));

// Primer mensaje (el saludo de siempre) y segundo mensaje (las opciones)
export const SALUDO = config.saludo;

const EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
const OPCIONES = NEGOCIOS.map(
  (n, i) => `${EMOJIS[i]} ${n.nombre}${n.descripcion ? ` (${n.descripcion})` : ""}`
).join("\n");
const NUMEROS = NEGOCIOS.map((_, i) => `el *${i + 1}*`);
const LISTA_NUMEROS =
  NUMEROS.length === 1 ? NUMEROS[0] : `${NUMEROS.slice(0, -1).join(", ")} o ${NUMEROS[NUMEROS.length - 1]}`;
const RESPONDE = `Respondé con ${LISTA_NUMEROS}.`;

export const MENU = `¿Qué te interesa?\n\n${OPCIONES}\n\n${RESPONDE}`;
export const MENU_REPETIDO = `Para ayudarte mejor, elegí una opción:\n\n${OPCIONES}\n\n${RESPONDE}`;

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([1-9])\uFE0F?\u20E3/g, "$1") // 1️⃣, 2️⃣... escritos como emoji
    .trim();
}

const PALABRAS = NEGOCIOS.map((n) => new RegExp(`\\b(${n.palabras})\\b`));

// Devuelve { negocio, soloOpcion }.
// - Un numero solo ("1", "2"...) cuenta solo si el menu esta esperando una respuesta
//   (si no, un "2" podria ser una cantidad dentro de un pedido).
// - Tambien se entiende por palabras: "ropa", "quiero pan", "Moda Florencia"...
// - Si nombra varios negocios o ninguno, devuelve negocio null (se vuelve a preguntar).
export function detectarNegocio(texto, esperandoOpcion) {
  const t = normalizar(texto);
  if (esperandoOpcion) {
    const m = /^(opcion\s*)?([1-9])[\s.!)]*$/.exec(t);
    const n = m && NEGOCIOS[Number(m[2]) - 1];
    if (n) return { negocio: n.id, soloOpcion: true };
  }
  const coinciden = NEGOCIOS.filter((_, i) => PALABRAS[i].test(t));
  if (coinciden.length === 1) return { negocio: coinciden[0].id, soloOpcion: false };
  return { negocio: null, soloOpcion: false };
}

// Para volver al menu una vez elegido un negocio (solo palabras sueltas, nunca numeros)
export function esComandoMenu(texto) {
  return /^(menu|opciones|cambiar|volver|inicio|otro negocio)[\s.!]*$/.test(normalizar(texto));
}

// Se agrega a las instrucciones del bot segun el negocio que eligio el cliente
export function directiva(negocio) {
  const propio = NOMBRES[negocio];
  if (!propio) return "";
  if (UNICO) {
    return `\n\n## Saludo\nNo vuelvas a saludar ni a presentarte: el saludo lo manda el sistema.`;
  }
  const otros = NEGOCIOS.filter((n) => n.id !== negocio).map((n) => n.nombre);
  const otro = otros.length === 1 ? otros[0] : `${otros.slice(0, -1).join(", ")} o ${otros[otros.length - 1]}`;
  return (
    `\n\n## Negocio elegido por el cliente\n` +
    `El cliente ya eligió ${propio} en el menú inicial. En esta conversación hablá solo de ${propio}: ` +
    `no ofrezcas ni menciones ${otro}. No vuelvas a saludar ni a presentarte (el saludo y el menú los manda el sistema). ` +
    `Si el cliente pregunta por ${otro} o quiere cambiar, decile que escriba la palabra "menú" para elegir de nuevo.`
  );
}
