// Configuracion por cliente: cada negocio vive en clientes/<CLIENTE>/negocio.json
// El cliente activo se elige con la variable de entorno CLIENTE (por defecto: moda-florencia).
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const CLIENTE = process.env.CLIENTE || "moda-florencia";
if (!/^[a-z0-9][a-z0-9_-]*$/.test(CLIENTE)) {
  throw new Error(`CLIENTE invalido: "${CLIENTE}" (usar minusculas, numeros, guion)`);
}
export const carpetaCliente = fileURLToPath(new URL(`./clientes/${CLIENTE}/`, import.meta.url));

function leer() {
  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(carpetaCliente + "negocio.json", "utf-8"));
  } catch (err) {
    throw new Error(`No pude leer clientes/${CLIENTE}/negocio.json: ${err.message}`);
  }
  if (!datos.saludo || !Array.isArray(datos.negocios) || datos.negocios.length < 1 || datos.negocios.length > 9) {
    throw new Error(`clientes/${CLIENTE}/negocio.json: faltan "saludo" o "negocios" (1 a 9)`);
  }
  const ids = new Set();
  for (const n of datos.negocios) {
    if (!n.id || !n.nombre || !n.palabras) {
      throw new Error(`clientes/${CLIENTE}/negocio.json: cada negocio necesita id, nombre y palabras`);
    }
    if (ids.has(n.id)) throw new Error(`clientes/${CLIENTE}/negocio.json: id repetido "${n.id}"`);
    ids.add(n.id);
    new RegExp(n.palabras); // falla aca si la expresion esta mal escrita
  }
  return datos;
}

export const config = leer();
