import test from "node:test";
import assert from "node:assert/strict";
import { crearPuenteAlertas } from "../src/alertas/puente-789.js";

function peticion({ auth = "Bearer servicio-secreto-de-prueba", body = {} } = {}) {
  return { headers: { authorization: auth }, body };
}
function respuesta() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.payload = data; return this; },
  };
}
const evento = { event_id: "evento_emergencia_0001", categoria: "emergencia_medica", detalle: "Prueba simulada" };

test("rechaza solicitudes sin token válido", async () => {
  const handler = crearPuenteAlertas({ tokenServicio: "servicio-secreto-de-prueba" });
  const res = respuesta();
  await handler(peticion({ auth: "Bearer incorrecto", body: evento }), res);
  assert.equal(res.statusCode, 401);
});

test("valida identificador y categoría", async () => {
  const handler = crearPuenteAlertas({ tokenServicio: "servicio-secreto-de-prueba" });
  const res1 = respuesta();
  await handler(peticion({ body: { ...evento, event_id: "corto" } }), res1);
  assert.equal(res1.statusCode, 400);
  const res2 = respuesta();
  await handler(peticion({ body: { ...evento, categoria: "cotidiano" } }), res2);
  assert.equal(res2.statusCode, 400);
});

test("por defecto simula y no hace llamadas externas", async () => {
  let llamadas = 0;
  const handler = crearPuenteAlertas({
    tokenServicio: "servicio-secreto-de-prueba",
    fetchImpl: async () => { llamadas++; throw new Error("No debe ejecutarse"); },
  });
  const res = respuesta();
  await handler(peticion({ body: evento }), res);
  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.modo, "simulacion");
  assert.equal(llamadas, 0);
});

test("envía solo al destino fijo configurado y usa el ID emisor 789", async () => {
  let llamada;
  const handler = crearPuenteAlertas({
    tokenServicio: "servicio-secreto-de-prueba",
    metaToken: "token-meta-falso",
    phoneNumberId789: "1234567890123456",
    destinatario: "5493870000000",
    habilitarEnvioReal: true,
    fetchImpl: async (url, options) => {
      llamada = { url, options };
      return { ok: true, json: async () => ({}) };
    },
  });
  const res = respuesta();
  await handler(peticion({ body: evento }), res);
  assert.equal(res.statusCode, 200);
  assert.match(llamada.url, /1234567890123456\\/messages$/);
  const body = JSON.parse(llamada.options.body);
  assert.equal(body.to, "5493870000000");
  assert.equal(body.type, "text");
  assert.match(body.text.body, /ALERTA URGENTE/);
});

test("no permite cambiar el destinatario desde el cuerpo", async () => {
  let destino;
  const handler = crearPuenteAlertas({
    tokenServicio: "servicio-secreto-de-prueba",
    metaToken: "token-meta-falso",
    phoneNumberId789: "1234567890123456",
    destinatario: "5493870000000",
    habilitarEnvioReal: true,
    fetchImpl: async (_url, options) => {
      destino = JSON.parse(options.body).to;
      return { ok: true };
    },
  });
  const res = respuesta();
  await handler(peticion({ body: { ...evento, to: "5491111111111" } }), res);
  assert.equal(destino, "5493870000000");
});

test("evita duplicar un mismo event_id", async () => {
  let llamadas = 0;
  const handler = crearPuenteAlertas({
    tokenServicio: "servicio-secreto-de-prueba",
    metaToken: "token-meta-falso",
    phoneNumberId789: "1234567890123456",
    destinatario: "5493870000000",
    habilitarEnvioReal: true,
    fetchImpl: async () => { llamadas++; return { ok: true }; },
  });
  const res1 = respuesta();
  const res2 = respuesta();
  await handler(peticion({ body: evento }), res1);
  await handler(peticion({ body: evento }), res2);
  assert.equal(llamadas, 1);
  assert.equal(res2.payload.duplicada, true);
});

test("si Meta falla, permite reintentar el mismo evento", async () => {
  let llamadas = 0;
  const handler = crearPuenteAlertas({
    tokenServicio: "servicio-secreto-de-prueba",
    metaToken: "token-meta-falso",
    phoneNumberId789: "1234567890123456",
    destinatario: "5493870000000",
    habilitarEnvioReal: true,
    fetchImpl: async () => (++llamadas === 1 ? { ok: false } : { ok: true }),
  });
  const res1 = respuesta();
  const res2 = respuesta();
  await handler(peticion({ body: evento }), res1);
  await handler(peticion({ body: evento }), res2);
  assert.equal(res1.statusCode, 502);
  assert.equal(res2.statusCode, 200);
  assert.equal(llamadas, 2);
});
