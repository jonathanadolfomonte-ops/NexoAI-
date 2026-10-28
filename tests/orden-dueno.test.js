import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Ejecuta la función real leerOrden extraída de server.js, sin arrancar Express,
// sin tokens de Meta y sin enviar mensajes reales.
const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const start = source.indexOf("function leerOrden(texto) {");
const end = source.indexOf("// Numero del dueño tal como se lo muestra al cliente:", start);
assert.notEqual(start, -1, "server.js debe contener leerOrden");
assert.notEqual(end, -1, "debe existir el límite de la función leerOrden");
const functionSource = source.slice(start, end);
const context = {
  COMANDO_DUENO: /^\s*(?:dec[ií]le|dile|avis[aá]le|transmit[ií]le|respond[eé]le|contest[aá]le|escrib[ií]le|mand[aá]le)\b/i,
  soloDigitos: (s) => String(s || "").replace(/\D/g, ""),
};
vm.runInNewContext(functionSource + "\nthis.leerOrden = leerOrden;", context);
const leerOrden = context.leerOrden;

test("reconoce el número cuando está después de 'al'", () => {
  const r = leerOrden("Decile al 3873123456 que estoy en una reunión");
  assert.equal(r.destino, "5493873123456");
  assert.equal(r.invalido, false);
  assert.match(r.instruccion, /estoy en una reunión/i);
});

test("reconoce el número aunque esté más adelante en la frase", () => {
  const r = leerOrden("Avisale que estoy viajando al número 3873123456 y luego le escribo");
  assert.equal(r.destino, "5493873123456");
  assert.equal(r.invalido, false);
  assert.match(r.instruccion, /estoy viajando/i);
  assert.doesNotMatch(r.instruccion, /3873123456/);
});

test("normaliza un número argentino con prefijo 54", () => {
  const r = leerOrden("Mandale al +54 3873 123456 que te llamo luego");
  assert.equal(r.destino, "5493873123456");
  assert.equal(r.invalido, false);
});

test("rechaza un número corto o mal formado", () => {
  const r = leerOrden("Decile al 12345 que ya llegué");
  assert.equal(r.destino, null);
  assert.equal(r.invalido, true);
});

test("permite una orden sin número cuando se usará el último contacto avisado", () => {
  const r = leerOrden("Decile que estoy en una reunión y apenas termine le escribo");
  assert.equal(r.destino, null);
  assert.equal(r.invalido, false);
  assert.match(r.instruccion, /estoy en una reunión/i);
});

test("rechaza una secuencia larga de dígitos aunque aparezca después de 'que'", () => {
  const r = leerOrden("Decile que mi código de referencia es 123456 y que luego te llamo");
  assert.equal(r.destino, null);
  assert.equal(r.invalido, true);
});

test("no inventa un destino cuando la instrucción contiene una fecha", () => {
  const r = leerOrden("Decile que la fecha del turno es 2026-10-28");
  assert.equal(r.destino, null);
  assert.equal(r.invalido, true);
});

test("limpia el comando y conserva el mensaje cuando no se indica número", () => {
  const r = leerOrden("Avisale que ya estoy llegando");
  assert.equal(r.destino, null);
  assert.equal(r.invalido, false);
  assert.match(r.instruccion, /ya estoy llegando/i);
});
