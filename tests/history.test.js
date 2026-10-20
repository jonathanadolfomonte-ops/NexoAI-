import test from "node:test";
import assert from "node:assert/strict";
import { appendTurn, serializeByKey } from "../src/logic/nexoai-core.js";

test("mantiene separados los historiales al operar sobre arreglos distintos", () => {
  const personal = appendTurn([], "hola", "¡Hola!");
  const comercial = appendTurn([], "precio", "Te ayudo con el precio.");
  assert.deepEqual(personal.map((x) => x.content), ["hola", "¡Hola!"]);
  assert.deepEqual(comercial.map((x) => x.content), ["precio", "Te ayudo con el precio."]);
});

test("limita el historial sin dejar una respuesta assistant al principio", () => {
  let history = [];
  for (let i = 1; i <= 4; i++) {
    history = appendTurn(history, `pregunta ${i}`, `respuesta ${i}`, 2);
  }
  assert.equal(history.length, 4);
  assert.deepEqual(history.map((x) => x.content), [
    "pregunta 3", "respuesta 3", "pregunta 4", "respuesta 4"
  ]);
  assert.equal(history[0].role, "user");
});

test("serializa operaciones de la misma conversación en orden", async () => {
  const order = [];
  const first = serializeByKey("numero-ficticio", async () => {
    order.push("inicio-1");
    await Promise.resolve();
    order.push("fin-1");
  });
  const second = serializeByKey("numero-ficticio", async () => {
    order.push("inicio-2");
    order.push("fin-2");
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ["inicio-1", "fin-1", "inicio-2", "fin-2"]);
});

test("un fallo de una operación no bloquea la siguiente", async () => {
  await assert.rejects(
    serializeByKey("clave-error", async () => { throw new Error("fallo simulado"); }),
    /fallo simulado/
  );
  assert.equal(await serializeByKey("clave-error", async () => "ok"), "ok");
});
