import test from "node:test";
import assert from "node:assert/strict";
import { interpretarClasificacion, clasificarEmergencia } from "../audio-emergencias.js";

test("acepta una emergencia explícita con confianza alta", () => {
  const r = interpretarClasificacion('{"emergency":true,"confidence":0.97,"reason":"Accidente en curso con una persona herida."}');
  assert.equal(r.emergencia, true);
  assert.equal(r.confianza, 0.97);
});

test("no alerta con confianza por debajo del umbral", () => {
  const r = interpretarClasificacion({ emergency: true, confidence: 0.84, reason: "Dudoso" });
  assert.equal(r.emergencia, false);
});

test("no alerta ante una transcripción inválida", () => {
  const r = interpretarClasificacion("esto no es json");
  assert.equal(r.emergencia, false);
  assert.equal(r.confianza, 0);
});

test("usa Groq y clasifica el resultado de forma conservadora", async () => {
  let llamada;
  const groq = {
    chat: {
      completions: {
        create: async (args) => {
          llamada = args;
          return { choices: [{ message: { content: '{"emergency":false,"confidence":0.99,"reason":"Situación cotidiana."}' } }] };
        },
      },
    },
  };
  const r = await clasificarEmergencia("Mañana paso a buscar los papeles.", groq, "modelo-test");
  assert.equal(r.emergencia, false);
  assert.equal(llamada.model, "modelo-test");
  assert.equal(llamada.response_format.type, "json_object");
});

test("falla cerrada si Groq devuelve una respuesta vacía", async () => {
  const groq = { chat: { completions: { create: async () => ({ choices: [] }) } } };
  const r = await clasificarEmergencia("Necesito ayuda", groq, "modelo-test");
  assert.equal(r.emergencia, false);
});
